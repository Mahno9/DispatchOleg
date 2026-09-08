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
import { assetUsage } from '../repos/assets.js';

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

export const MIME_MAP: Record<string, MimeMeta> = {
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
// First line of defence only: a regexp over text misses XML-entity encoding
// (&#106;avascript:), which the SVG parser happily decodes — the header set in
// ASSET_HEADERS below is what actually closes that hole.
const SVG_DANGER_RE = /<script[\s>]|\bon[a-z]+\s*=|javascript:|<foreignObject|data:text\/html/i;

export function svgLooksDangerous(text: string): boolean {
  return SVG_DANGER_RE.test(text);
}

/**
 * Заголовки отдачи /assets-store/. Загруженный SVG живёт на том же origin, что
 * и админка, и по прямой ссылке открывается как документ — тогда его скрипт
 * дотянулся бы до admin-cookie. `sandbox` без allow-scripts/allow-same-origin
 * плюс `default-src 'none'` снимают это независимо от того, что пропустил
 * svgLooksDangerous. Для картинок, звука и шрифтов заголовок безразличен:
 * подресурс не документ, CSP к нему не применяется.
 */
export const ASSET_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'X-Content-Type-Options': 'nosniff',
};

/**
 * Сигнатуры («магические байты») принимаемых форматов: заявленный клиентом
 * mimetype ничем не подтверждён, и без этой проверки под видом image/png
 * сохраняется что угодно. Ключи — те же, что в MIME_MAP.
 */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/bmp': (b) => b[0] === 0x42 && b[1] === 0x4d,
  'image/x-icon': (b) => b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0,
  'image/gif': (b) => /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')),
  // Текстовый формат, сигнатуры нет: хватает того, что это похоже на XML с <svg.
  'image/svg+xml': (b) => /<svg[\s>]/i.test(b.subarray(0, 4096).toString('utf8')),
  // ID3-тег либо кадровая синхронизация MPEG audio.
  'audio/mpeg': (b) =>
    b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0),
  'audio/ogg': (b) => b.subarray(0, 4).toString('latin1') === 'OggS',
  'audio/wav': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WAVE',
  // EBML — общий контейнер webm/matroska.
  'audio/webm': (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  'audio/mp4': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  'audio/flac': (b) => b.subarray(0, 4).toString('latin1') === 'fLaC',
};
SIGNATURES['image/vnd.microsoft.icon'] = SIGNATURES['image/x-icon']!;
SIGNATURES['audio/webm;codecs=opus'] = SIGNATURES['audio/webm']!;
SIGNATURES['audio/x-flac'] = SIGNATURES['audio/flac']!;

/**
 * Совпадает ли содержимое буфера с заявленным типом. Для типа без сигнатуры
 * ответ положительный — проверка ужесточает приём, а не сужает его; что
 * сигнатура есть у каждого типа из MIME_MAP, стережёт тест.
 */
export function contentMatchesMime(mime: string, buf: Buffer): boolean {
  const check = SIGNATURES[mime];
  return check ? check(buf) : true;
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
    setHeaders: (res) => {
      for (const [name, value] of Object.entries(ASSET_HEADERS)) res.setHeader(name, value);
    },
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

      // Тип приходит со слов клиента: без сверки с содержимым под видом
      // image/png сохраняется и отдаётся что угодно.
      if (!contentMatchesMime(mime, buf)) {
        rejected.push(`${part.filename} (content does not match ${mime})`);
        continue;
      }

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

  // Кто ссылается на ассет — админка спрашивает перед удалением, чтобы показать
  // список вместо голого «удалить файл?» (ср. /api/admin/dialogues/:id/usage).
  app.get<{ Params: { id: string } }>(
    '/api/admin/assets/:id/usage',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const db = getDb();
      const row = db.prepare('SELECT id, ext FROM assets WHERE id = ?').get(req.params.id) as
        Pick<AssetRow, 'id' | 'ext'> | undefined;
      if (!row) return reply.code(404).send({ error: 'asset not found' });
      return assetUsage(db, `/assets-store/${row.id}.${row.ext}`);
    },
  );

  // DELETE /api/admin/assets/:id
  app.delete<{ Params: { id: string } }>(
    '/api/admin/assets/:id',
    { preHandler: app.requireAdmin },
    async (req) => {
      const db = getDb();
      const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id) as
        AssetRow | undefined;

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
