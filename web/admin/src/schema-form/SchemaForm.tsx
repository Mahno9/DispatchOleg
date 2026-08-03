import { useRef, useState } from 'react';
import { api } from '../api';
import { IMAGE_ACCEPT } from '../asset-accept';
import { CurveEditor } from './CurveEditor';
import { DrawModal } from './DrawModal';
import { AssetPickerModal } from './AssetPickerModal';
import { LiveNumberInput } from './LiveNumberInput';
import { OpacitySlider } from './OpacitySlider';
import { ImageCropField, type Crop } from './ImageCropField';
import { GridPaintField } from './GridPaintField';
import { MazePreviewField } from './MazePreviewField';
import { BgPreviewBox } from './BgPreviewBox';
import type { Asset } from '../api';
import { Segmented } from '../ui/Segmented';

// ---------------------------------------------------------------------------
// WAV encoder — used to re-encode trimmed mic recordings
// ---------------------------------------------------------------------------

function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const nCh = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const ab = new ArrayBuffer(44 + buf.length * nCh * 2);
  const v = new DataView(ab);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, ab.byteLength - 8, true);
  str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, buf.length * nCh * 2, true);
  let o = 44;
  for (let i = 0; i < buf.length; i++) {
    for (let ch = 0; ch < nCh; ch++) {
      const s = Math.max(-1, Math.min(1, buf.getChannelData(ch)[i] ?? 0));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
    }
  }
  return ab;
}

// ---------------------------------------------------------------------------
// JSON-Schema (draft-07) subset + x-type extensions
// ---------------------------------------------------------------------------

export interface Schema {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: (string | number)[];
  'x-enumLabels'?: Record<string, string>;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  'x-type'?: string;
  'x-bg-preview'?: boolean;
  /** grid-paint: upper bound for both grid sides (default 16). */
  'x-max-size'?: number;
}

type Json = unknown;

interface FieldProps {
  schema: Schema;
  value: Json;
  onChange: (next: Json) => void;
  /** Label rendered next to/above the control. */
  label?: string | undefined;
}

// ---------------------------------------------------------------------------
// Default-value helper — produces a sensible blank value for a schema
// ---------------------------------------------------------------------------

function defaultFor(schema: Schema): Json {
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case 'object': {
      const obj: Record<string, Json> = {};
      if (schema.properties) {
        for (const [key, sub] of Object.entries(schema.properties)) {
          obj[key] = defaultFor(sub);
        }
      }
      return obj;
    }
    case 'array':
      return [];
    case 'boolean':
      return false;
    case 'integer':
    case 'number':
      return schema.minimum ?? 0;
    case 'string':
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Asset upload widget (image / gif / audio)
// ---------------------------------------------------------------------------

interface AssetWidgetProps {
  kind: 'image' | 'gif' | 'audio';
  value: string;
  onChange: (url: string) => void;
  hidePreview?: boolean;
}

function micUnavailableMessage(): string | null {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return 'Микрофон доступен только на HTTPS или localhost';
  }
  if (typeof MediaRecorder === 'undefined') return 'Запись с микрофона не поддерживается этим браузером';
  return null;
}

function micErrorMessage(e: unknown): string {
  const unavailable = micUnavailableMessage();
  if (unavailable) return unavailable;
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return 'Доступ к микрофону запрещён';
    if (e.name === 'NotFoundError') return 'Микрофон не найден';
  }
  return 'Нет доступа к микрофону';
}

export function AssetUploadWidget({ kind, value, onChange, hidePreview = false }: AssetWidgetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<'idle' | 'init' | 'rec'>('idle');
  const [drawing, setDrawing] = useState(false);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const uploadSeqRef = useRef(0);

  // existing assets that match this field's type (images & gifs are interchangeable)
  const pickKinds: Asset['kind'][] = kind === 'audio' ? ['audio'] : ['image', 'gif'];

  const accept = kind === 'audio' ? 'audio/*' : IMAGE_ACCEPT;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const seq = ++uploadSeqRef.current;
    setBusy(true);
    setError(null);
    try {
      const asset = await api.uploadAsset(file);
      if (seq === uploadSeqRef.current) onChange(asset.url);
    } catch (e) {
      if (seq === uploadSeqRef.current) setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      if (seq === uploadSeqRef.current) setBusy(false);
    }
  }

  async function startRecording() {
    if (recorderRef.current) return;
    setError(null);
    const unavailable = micUnavailableMessage();
    if (unavailable) {
      setError(unavailable);
      return;
    }
    setRecording('init');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording('idle');
        const mime = recorder.mimeType || 'audio/webm';
        const rawBlob = new Blob(chunksRef.current, { type: mime });
        void (async () => {
          let file: File;
          try {
            const ctx = new AudioContext();
            const decoded = await ctx.decodeAudioData(await rawBlob.arrayBuffer());
            void ctx.close();
            const ch0 = decoded.getChannelData(0);
            let trimSample = 0;
            for (let i = 0; i < ch0.length; i++) {
              if (Math.abs(ch0[i] ?? 0) > 0.01) { trimSample = i; break; }
            }
            let trimmed = decoded;
            if (trimSample > 0) {
              const offline = new OfflineAudioContext(decoded.numberOfChannels, decoded.length - trimSample, decoded.sampleRate);
              const src = offline.createBufferSource();
              src.buffer = decoded;
              src.connect(offline.destination);
              src.start(0, trimSample / decoded.sampleRate);
              trimmed = await offline.startRendering();
            }
            file = new File([encodeWav(trimmed)], 'mic-recording.wav', { type: 'audio/wav' });
          } catch {
            const ext = mime.includes('ogg') ? 'ogg' : 'webm';
            file = new File([rawBlob], `mic-recording.${ext}`, { type: mime });
          }
          void handleFile(file);
        })();
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording('rec');
    } catch (e) {
      setError(micErrorMessage(e));
      setRecording('idle');
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
  }

  return (
    <div className='sf-asset'>
      <div className='sf-asset-row'>
        <input
          ref={fileRef}
          type='file'
          accept={accept}
          hidden
          onChange={(e) => void handleFile(e.target.files?.[0] ?? undefined)}
        />
        <button
          type='button'
          className='sf-pick-btn'
          title='Загрузить файл с устройства'
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          Файл
        </button>
        <button
          type='button'
          className='sf-pick-btn'
          title='Выбрать из уже загруженных ассетов'
          onClick={() => setPicking(true)}
          disabled={busy}
        >
          Ассеты
        </button>
        {kind === 'audio' && (
          <button
            type='button'
            className={`sf-icon-btn${recording === 'rec' ? ' sf-icon-btn--active' : ''}`}
            title={
              recording === 'init'
                ? 'Инициализация микрофона…'
                : recording === 'rec'
                  ? 'Идёт запись — отпустите, чтобы остановить'
                  : 'Записать с микрофона (удерживайте)'
            }
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); void startRecording(); }}
            onPointerUp={stopRecording}
            onPointerLeave={stopRecording}
            onPointerCancel={stopRecording}
            disabled={busy || recording === 'init'}
          >
            🎙
          </button>
        )}
        {(kind === 'image' || kind === 'gif') && (
          <button
            type='button'
            className='sf-icon-btn'
            title='Нарисовать изображение'
            onClick={() => setDrawing(true)}
            disabled={busy}
          >
            🖌
          </button>
        )}
        {value && (
          <button
            type='button'
            className='sf-icon-btn'
            title='Очистить'
            onClick={() => onChange('')}
            disabled={busy}
          >
            🗑
          </button>
        )}
      </div>
      {busy && <span className='sf-asset-hint'>Загрузка…</span>}
      {error && <span className='sf-asset-error'>{error}</span>}
      {!hidePreview && value && kind === 'audio' && (
        <audio className='sf-asset-preview' controls src={value} />
      )}
      {!hidePreview && value && kind !== 'audio' && (
        <img className='sf-asset-preview-img' src={value} alt='' />
      )}
      {drawing && (
        <DrawModal
          onClose={() => setDrawing(false)}
          onDone={(file) => { setDrawing(false); void handleFile(file); }}
        />
      )}
      {picking && (
        <AssetPickerModal
          kinds={pickKinds}
          onPick={(url) => { setPicking(false); onChange(url); }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-audio widget — list of weighted sound assets
// ---------------------------------------------------------------------------

export type WeightedAudio = { url: string; weight: number; volume: number };

function clampVolume(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(200, n)) : 100;
}

export function normalizeAudio(val: unknown): WeightedAudio[] {
  if (!val) return [];
  if (typeof val === 'string') return val ? [{ url: val, weight: 1, volume: 100 }] : [];
  if (Array.isArray(val)) {
    return val
      .filter((v): v is Partial<WeightedAudio> & { url: string } => !!v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string')
      .map((v) => ({ url: v.url, weight: Math.max(1, Number(v.weight) || 1), volume: clampVolume(v.volume) }));
  }
  return [];
}

export function MultiAudioWidget({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const items = normalizeAudio(value);
  return (
    <div className='sf-multi-audio'>
      {items.map((item, i) => (
        <div key={i} className='sf-multi-audio-entry'>
          {i > 0 && <hr className='sf-multi-audio-sep' />}
          <div className='sf-multi-audio-header'>
            <AssetUploadWidget
              kind='audio'
              value={item.url}
              onChange={(url) => onChange(items.map((x, j) => j === i ? { ...x, url } : x))}
              hidePreview
            />
            <button
              type='button'
              className='sf-icon-btn sf-multi-audio-delete'
              title='Удалить этот вариант'
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
          <div className='sf-multi-audio-player-row'>
            {item.url && (
              <audio className='sf-multi-audio-player' controls src={item.url} />
            )}
            <label className='sf-multi-audio-weight'>
              <span>Вес</span>
              <input
                type='number'
                min={1}
                value={item.weight}
                onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, weight: Math.max(1, Number(e.target.value) || 1) } : x))}
              />
            </label>
            <label className='sf-multi-audio-weight'>
              <span>Громкость (%)</span>
              <input
                type='number'
                min={0}
                max={200}
                value={item.volume}
                onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, volume: clampVolume(e.target.value) } : x))}
              />
            </label>
          </div>
        </div>
      ))}
      <button type='button' className='sf-pick-btn' onClick={() => onChange([...items, { url: '', weight: 1, volume: 100 }])}>
        + Добавить звук
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color field — native swatch + raw CSS-string text input
// ---------------------------------------------------------------------------

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isHex = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className='sf-color'>
      <input
        type='color'
        value={isHex ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        title='Выбрать цвет'
      />
      <input
        type='text'
        className='sf-color-text'
        value={value}
        placeholder='#rrggbb или CSS-цвет'
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field dispatcher — picks a control based on type / x-type / enum
// ---------------------------------------------------------------------------

function Field({ schema, value, onChange, label }: FieldProps) {
  const title = label ?? schema.title;

  // enum → radio group (≤3 options) or select
  if (schema.enum) {
    const current = value === undefined ? schema.default : value;
    const enumLabels = schema['x-enumLabels'] ?? {};
    const pick = (raw: string) => onChange(schema.enum?.find((o) => String(o) === raw) ?? raw);
    if (schema.enum.length <= 3) {
      return (
        <div className='sf-field'>
          {title && <span className='sf-label'>{title}</span>}
          <Segmented
            options={schema.enum.map((opt) => ({
              value: String(opt),
              label: enumLabels[String(opt)] ?? String(opt),
            }))}
            value={String(current ?? '')}
            onChange={pick}
          />
        </div>
      );
    }
    return (
      <label className='sf-field'>
        {title && <span className='sf-label'>{title}</span>}
        <select
          value={String(current ?? '')}
          onChange={(e) => pick(e.target.value)}
        >
          {schema.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {enumLabels[String(opt)] ?? String(opt)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // x-type asset widgets
  const xType = schema['x-type'];
  if (xType === 'asset:audio') {
    return (
      <div className='sf-field sf-field--full'>
        {title && <span className='sf-label'>{title}</span>}
        <MultiAudioWidget value={value} onChange={onChange} />
      </div>
    );
  }
  if (xType === 'asset:image' || xType === 'asset:gif') {
    const kind = xType === 'asset:gif' ? 'gif' : 'image';
    return (
      <div className='sf-field sf-field--full'>
        {title && <span className='sf-label'>{title}</span>}
        <AssetUploadWidget
          kind={kind}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      </div>
    );
  }

  // x-type opacity → range slider + schematic preview
  if (xType === 'opacity') {
    return (
      <div className='sf-field sf-field--full'>
        {title && <span className='sf-label'>{title}</span>}
        <OpacitySlider schema={schema} value={value} onChange={onChange} />
      </div>
    );
  }

  // x-type color → swatch + text
  if (xType === 'color') {
    return (
      <label className='sf-field'>
        {title && <span className='sf-label'>{title}</span>}
        <ColorField value={typeof value === 'string' ? value : ''} onChange={onChange} />
      </label>
    );
  }

  // x-type curve → graphical curve editor
  if (xType === 'curve') {
    return (
      <div className='sf-field sf-field--full'>
        {title && <span className='sf-label'>{title}</span>}
        <CurveEditor schema={schema} value={value === undefined ? schema.default : value} onChange={onChange} />
      </div>
    );
  }

  // x-type grid-paint → paintable cell grid + auto-partition preview
  if (xType === 'grid-paint') {
    return (
      <div className='sf-field sf-field--full'>
        {title && <span className='sf-label'>{title}</span>}
        <GridPaintField schema={schema} value={value === undefined ? schema.default : value} onChange={onChange} />
      </div>
    );
  }

  // x-type maze-preview → normal object fields + canvas preview of the result
  if (xType === 'maze-preview') {
    return (
      <div className='sf-field--full'>
        <ObjectField schema={schema} value={value} onChange={onChange} label={title} />
        <MazePreviewField value={value} onChange={onChange} />
      </div>
    );
  }

  switch (schema.type) {
    case 'object':
      return <ObjectField schema={schema} value={value} onChange={onChange} label={title} />;

    case 'array':
      return <ArrayField schema={schema} value={value} onChange={onChange} label={title} />;

    case 'boolean':
      return (
        <label className='sf-field sf-field-check'>
          <input
            type='checkbox'
            checked={value === undefined ? Boolean(schema.default) : Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {title && <span className='sf-label'>{title}</span>}
        </label>
      );

    case 'integer':
    case 'number': {
      return (
        <label className='sf-field'>
          {title && <span className='sf-label'>{title}</span>}
          <LiveNumberInput
            value={typeof value === 'number' ? value : undefined}
            fallback={typeof schema.default === 'number' ? schema.default : undefined}
            integer={schema.type === 'integer'}
            min={schema.minimum}
            max={schema.maximum}
            onCommit={onChange}
          />
        </label>
      );
    }

    case 'string':
    default:
      // string + unknown x-type → plain text input
      return (
        <label className='sf-field'>
          {title && <span className='sf-label'>{title}</span>}
          <input
            type='text'
            value={typeof value === 'string' ? value : value === undefined ? String(schema.default ?? '') : String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
  }
}

// ---------------------------------------------------------------------------
// Object field → fieldset of properties
// ---------------------------------------------------------------------------

function ObjectField({ schema, value, onChange, label }: FieldProps) {
  const obj = (value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {}) as Record<string, Json>;

  // ref keeps latest obj so async handleFile closures don't overwrite sibling keys with stale data
  const objRef = useRef(obj);
  objRef.current = obj;

  const props = schema.properties ?? {};

  function setKey(key: string, next: Json) {
    onChange({ ...objRef.current, [key]: next });
  }

  const bgPreview = schema['x-bg-preview'] && typeof obj.backgroundImage === 'string' && obj.backgroundImage
    ? (() => {
        const url = obj.backgroundImage as string;
        const fit = (obj.backgroundFit as string | undefined) ?? 'cover';
        const scale = (obj.backgroundScale as number | undefined) ?? 1;
        const offset = (obj.backgroundOffset as { x?: number; y?: number } | undefined) ?? {};
        const off = { x: offset.x ?? 0, y: offset.y ?? 0 };
        const handleOffset = (o: { x: number; y: number }) => setKey('backgroundOffset', o);
        return (
          <div key='__bg-preview' className='sf-field--full sf-bg-preview'>
            <div className='sf-bg-preview-row'>
              <BgPreviewBox url={url} fit={fit} scale={scale} offset={off} onOffsetChange={handleOffset} width={120} height={213} label='Мобильный' />
              <BgPreviewBox url={url} fit={fit} scale={scale} offset={off} onOffsetChange={handleOffset} width={300} height={170} label='Десктопный' />
            </div>
          </div>
        );
      })()
    : null;

  const fields: JSX.Element[] = [];
  for (const [key, sub] of Object.entries(props)) {
    if (sub['x-type'] === 'image-crop') {
      // crop widget needs the sibling image URL → render it here, not in Field()
      fields.push(
        <ImageCropField
          key={key}
          imageUrl={typeof obj.image === 'string' ? obj.image : undefined}
          value={obj[key] as Crop | undefined}
          onChange={(next) => setKey(key, next as Json)}
        />
      );
      continue;
    }
    fields.push(
      <Field
        key={key}
        schema={sub}
        value={obj[key]}
        onChange={(next) => setKey(key, next)}
        label={sub.title ?? key}
      />
    );
    if (key === 'backgroundScale' && bgPreview) fields.push(bgPreview);
  }

  // Root object (no label) → plain grid; named groups → collapsible <details>.
  // ponytail: native <details>, swap for an animated panel only if design demands transitions.
  if (!label) {
    return <div className='sf-grid'>{fields}</div>;
  }
  return (
    <details className='sf-group sf-field--full' open>
      <summary className='sf-group-summary'>{label}</summary>
      <div className='sf-grid'>{fields}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Array field → repeatable rows
// ---------------------------------------------------------------------------

function ArrayField({ schema, value, onChange, label }: FieldProps) {
  const items = Array.isArray(value) ? (value as Json[]) : [];
  const itemSchema = schema.items ?? { type: 'string' };

  function setItem(index: number, next: Json) {
    const copy = items.slice();
    copy[index] = next;
    onChange(copy);
  }

  function addItem() {
    onChange([...items, defaultFor(itemSchema)]);
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function itemLabel(index: number): string {
    return label === 'Уровни' ? `Уровень ${index + 1}` : `Элемент ${index + 1}`;
  }

  const body = (
    <div className='sf-array'>
      {items.map((item, index) => {
        const field = (
          <Field
            schema={itemSchema}
            value={item}
            onChange={(next) => setItem(index, next)}
          />
        );
        const remove = (
          <button
            type='button'
            className='sf-array-remove'
            title='Удалить'
            onClick={(e) => {
              e.preventDefault();
              removeItem(index);
            }}
          >
            ✕
          </button>
        );
        return itemSchema.type === 'object' ? (
          <details className='sf-array-row sf-array-row--details' key={index} open>
            <summary className='sf-array-row-summary'>
              <span>{itemLabel(index)}</span>
              {remove}
            </summary>
            <div className='sf-array-item'>{field}</div>
          </details>
        ) : (
          <div className='sf-array-row' key={index}>
            <div className='sf-array-item'>{field}</div>
            {remove}
          </div>
        );
      })}
      <button type='button' className='sf-array-add' onClick={addItem}>
        + Добавить
      </button>
    </div>
  );

  // Unlabeled array (e.g. an array item's own list) → plain; named block → collapsible.
  if (!label) return <div className='sf-field--full'>{body}</div>;
  return (
    <details className='sf-group sf-field--full' open>
      <summary className='sf-group-summary'>
        {label} <span className='sf-count'>({items.length})</span>
      </summary>
      {body}
    </details>
  );
}

// ---------------------------------------------------------------------------
// Public component — controlled form over the whole config object
// ---------------------------------------------------------------------------

export interface SchemaFormProps {
  schema: Schema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  return (
    <div className='schema-form'>
      <ObjectField
        schema={schema}
        value={value}
        onChange={(next) => onChange((next ?? {}) as Record<string, unknown>)}
      />
    </div>
  );
}
