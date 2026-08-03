import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { paths } from '../config.js';
import { getDb } from '../db/connection.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// MIME → kind + ext mapping
// ---------------------------------------------------------------------------

type AssetKind = 'image' | 'audio' | 'gif';

interface MimeMeta {
  kind: AssetKind;
  ext: string;
  transcode?: true; // convert via ffmpeg before storing
  sanitize?: true; // scan decoded text for embedded scripts before storing
}

const MIME_MAP: Record<string, MimeMeta> = {
  'image/png': { kind: 'image', ext: 'png' },
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'image/bmp': { kind: 'image', ext: 'bmp' },
  'image/x-icon': { kind: 'image', ext: 'ico' },
  'image/vnd.microsoft.icon': { kind: 'image', ext: 'ico' },
  'image/gif': { kind: 'gif', ext: 'gif' },
  'image/svg+xml': { kind: 'image', ext: 'svg', sanitize: true },
  'audio/mpeg': { kind: 'audio', ext: 'mp3' },
  'audio/ogg': { kind: 'audio', ext: 'ogg' },
  'audio/wav': { kind: 'audio', ext: 'wav' },
  'audio/webm': { kind: 'audio', ext: 'webm' },
  'audio/webm;codecs=opus': { kind: 'audio', ext: 'webm' },
  'audio/mp4': { kind: 'audio', ext: 'm4a' },
  'audio/flac': { kind: 'audio', ext: 'flac', transcode: true },
  'audio/x-flac': { kind: 'audio', ext: 'flac', transcode: true },
};

// SVGs are live XML documents once served from /assets-store/, so any
// script-bearing SVG must be rejected outright rather than stored/stripped.
const SVG_DANGER_RE = /<script[\s>]|\bon[a-z]+\s*=|javascript:|<foreignObject|data:text\/html/i;

export function svgLooksDangerous(text: string): boolean {
  return SVG_DANGER_RE.test(text);
}

async function transcodeToOgg(buf: Buffer, srcExt: string): Promise<Buffer> {
  const tmpIn = path.join(os.tmpdir(), `do-in-${nanoid(8)}.${srcExt}`);
  const tmpOut = path.join(os.tmpdir(), `do-out-${nanoid(8)}.ogg`);
  try {
    fs.writeFileSync(tmpIn, buf);
    await execFileAsync('ffmpeg', [
      '-i',
      tmpIn,
      '-vn', // drop any embedded artwork
      '-codec:a',
      'libvorbis',
      '-q:a',
      '5', // VBR quality ~160 kbps
      '-y',
      tmpOut,
    ]);
    return fs.readFileSync(tmpOut);
  } finally {
    try {
      fs.unlinkSync(tmpIn);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(tmpOut);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Row / DTO types
// ---------------------------------------------------------------------------

interface AssetRow {
  id: string;
  kind: AssetKind;
  mime: string;
  ext: string;
  original_name: string;
  size_bytes: number;
  created_at: number;
}

interface AssetDto {
  id: string;
  url: string;
  kind: AssetKind;
  originalName: string;
  sizeBytes: number;
}

function rowToDto(row: AssetRow): AssetDto {
  return {
    id: row.id,
    url: `/assets-store/${row.id}.${row.ext}`,
    kind: row.kind,
    originalName: row.original_name,
    sizeBytes: row.size_bytes,
  };
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function assetsRoutes(app: FastifyInstance) {
  // Static serving for uploaded assets.
  // /assets-store/ prefix avoids clashing with Vite's bundled /assets/ chunks.
  await app.register(fastifyStatic, {
    root: paths.assets(),
    prefix: '/assets-store/',
    decorateReply: false,
    maxAge: '30d',
  });

  // POST /api/admin/assets — multipart upload, one or more files
  app.post('/api/admin/assets', { preHandler: app.requireAdmin }, async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: 'expected multipart/form-data' });
    }

    const assetsDir = paths.assets();
    fs.mkdirSync(assetsDir, { recursive: true });

    const accepted: AssetDto[] = [];
    const rejected: string[] = [];
    const db = getDb();

    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;

      const mime = part.mimetype;
      const meta = MIME_MAP[mime];

      if (!meta) {
        rejected.push(part.filename);
        await part.toBuffer(); // drain disallowed part
        continue;
      }

      let buf = await part.toBuffer();
      let storedMime = mime;
      let storedMeta = meta;

      if (meta.sanitize && svgLooksDangerous(buf.toString('utf8'))) {
        rejected.push(`${part.filename} (unsafe SVG content)`);
        continue;
      }

      if (meta.transcode) {
        try {
          buf = await transcodeToOgg(buf, meta.ext);
          storedMeta = { kind: 'audio', ext: 'ogg' };
          storedMime = 'audio/ogg';
        } catch {
          rejected.push(`${part.filename} (ffmpeg unavailable)`);
          continue;
        }
      }

      const id = nanoid(10);
      const dest = path.join(assetsDir, `${id}.${storedMeta.ext}`);
      fs.writeFileSync(dest, buf);

      db.prepare(
        `INSERT INTO assets (id, kind, mime, ext, original_name, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, storedMeta.kind, storedMime, storedMeta.ext, part.filename, buf.length, Date.now());

      accepted.push(rowToDto(db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow));
    }

    return { accepted, rejected };
  });

  // GET /api/admin/assets — list all assets
  app.get('/api/admin/assets', { preHandler: app.requireAdmin }, async () => {
    const rows = getDb()
      .prepare('SELECT * FROM assets ORDER BY created_at DESC')
      .all() as AssetRow[];
    return rows.map(rowToDto);
  });

  // DELETE /api/admin/assets/:id
  app.delete<{ Params: { id: string } }>(
    '/api/admin/assets/:id',
    { preHandler: app.requireAdmin },
    async (req) => {
      const db = getDb();
      const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id) as
        | AssetRow
        | undefined;

      if (row) {
        db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
        try {
          fs.unlinkSync(path.join(paths.assets(), `${row.id}.${row.ext}`));
        } catch {
          // ignore fs errors (file may already be gone)
        }
      }

      return { ok: true };
    },
  );
}
