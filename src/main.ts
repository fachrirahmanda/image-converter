import './style.css';
import { FORMATS, ICO_MAX, formatBytes, type OutFormat } from './formats';
import { ACCEPT, decodeFile, isImageFile, type Decoded } from './decode';
import { computeSize, fitWithin, renderToImageData, thumbnail, type Rect, type ResizeMode, type ResizeOptions } from './resize';
import { openCropper } from './crop';
import { saveToHistory } from './history';
import { encode, POOL_SIZE } from './pool';

interface Result { blob: Blob; url: string; name: string; width: number; height: number; format: OutFormat }

interface Item {
  file: File;
  card: HTMLElement;
  decoding?: Promise<Decoded>;
  decoded?: Decoded;
  /** Crop area in source pixels, or null for the whole image. */
  crop: Rect | null;
  result?: Result;
  /** One history entry per added file; re-converting updates it instead of adding another. */
  historyId: string;
  addedAt: number;
  /** Bumped on every run so stale results from a superseded run are discarded. */
  version: number;
  removed: boolean;
}

interface Settings {
  format: OutFormat;
  quality: number;
  lossless: boolean;
  effort: number;
  background: string;
  resize: ResizeOptions;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

const els = {
  drop: $('#drop'),
  input: $<HTMLInputElement>('#file-input'),
  list: $('#list'),
  format: $('#format'),
  formatNote: $('#format-note'),
  quality: $<HTMLInputElement>('#quality'),
  qualityVal: $('#quality-val'),
  lossless: $<HTMLInputElement>('#lossless'),
  effort: $('#effort'),
  bg: $<HTMLInputElement>('#bg'),
  resizeMode: $('#resize-mode'),
  percent: $<HTMLInputElement>('#percent'),
  percentVal: $('#percent-val'),
  width: $<HTMLInputElement>('#width'),
  height: $<HTMLInputElement>('#height'),
  keepAspect: $<HTMLInputElement>('#keep-aspect'),
  maxSide: $<HTMLInputElement>('#max-side'),
  convert: $<HTMLButtonElement>('#convert'),
  zip: $<HTMLButtonElement>('#zip'),
  clear: $<HTMLButtonElement>('#clear'),
  summary: $('#summary'),
  toolbar: $('#toolbar'),
  template: $<HTMLTemplateElement>('#card-template'),
};

const items: Item[] = [];
let dirty = false;

// ---------- settings ----------

function num(input: HTMLInputElement): number | null {
  const n = Number(input.value);
  return input.value.trim() && n > 0 ? n : null;
}

/** Value of the checked radio in a segmented control. */
function radio(name: string) {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)!.value;
}

function readSettings(): Settings {
  return {
    format: radio('format') as OutFormat,
    quality: Number(els.quality.value),
    lossless: els.lossless.checked,
    effort: Number(radio('effort')),
    background: els.bg.value,
    resize: {
      mode: radio('resize') as ResizeMode,
      percent: Number(els.percent.value),
      width: num(els.width),
      height: num(els.height),
      keepAspect: els.keepAspect.checked,
      maxSide: num(els.maxSide),
    },
  };
}

function setVisible(name: string, visible: boolean) {
  document.querySelectorAll<HTMLElement>(`[data-show="${name}"]`).forEach((el) => (el.hidden = !visible));
}

function updateControls() {
  const f = FORMATS[radio('format') as OutFormat];
  setVisible('quality', f.lossy && !(f.losslessOption && els.lossless.checked));
  setVisible('lossless', f.losslessOption);
  setVisible('effort', f.effort);
  setVisible('bg', !f.alpha);
  els.formatNote.textContent = f.note ?? '';
  els.qualityVal.textContent = els.quality.value;
  els.percentVal.textContent = `${els.percent.value}%`;
  // Values set from code don't fire input events, so refresh the design system's range fill.
  for (const r of [els.quality, els.percent]) window.DS?.syncRange(r);
  const mode = radio('resize');
  for (const m of ['percent', 'dimensions', 'maxside']) setVisible(m, mode === m);
}

function markDirty() {
  updateControls();
  if (!items.length) return;
  dirty = true;
  els.convert.classList.add('pulse');
  els.convert.textContent = 'Apply new settings';
}

els.format.addEventListener('change', () => {
  els.quality.value = String(FORMATS[radio('format') as OutFormat].defaultQuality);
  markDirty();
});
for (const el of [els.quality, els.lossless, els.effort, els.bg, els.resizeMode, els.percent, els.width, els.height, els.keepAspect, els.maxSide]) {
  el.addEventListener('input', markDirty);
}
document.querySelectorAll<HTMLButtonElement>('[data-max]').forEach((btn) =>
  btn.addEventListener('click', () => {
    els.maxSide.value = btn.dataset.max!;
    markDirty();
  }),
);

// ---------- file intake ----------

els.input.accept = ACCEPT;
els.input.addEventListener('change', () => {
  addFiles([...(els.input.files ?? [])]);
  els.input.value = '';
});

els.drop.addEventListener('click', () => els.input.click());
els.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.input.click(); }
});
for (const type of ['dragenter', 'dragover'] as const) {
  window.addEventListener(type, (e) => { e.preventDefault(); els.drop.classList.add('is-dragover'); });
}
for (const type of ['dragleave', 'drop'] as const) {
  window.addEventListener(type, (e) => {
    e.preventDefault();
    if (type === 'drop' || !(e as DragEvent).relatedTarget) els.drop.classList.remove('is-dragover');
  });
}
window.addEventListener('drop', (e) => addFiles([...(e.dataTransfer?.files ?? [])]));
window.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) addFiles(files);
});

function addFiles(files: File[]) {
  const added: Item[] = [];
  for (const file of files.filter(isImageFile)) {
    const card = els.template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const item: Item = { file, card, crop: null, historyId: crypto.randomUUID(), addedAt: Date.now(), version: 0, removed: false };
    $('.name', card).textContent = file.name;
    $('.name', card).title = file.name;
    $('.orig', card).textContent = formatBytes(file.size);
    $('.remove', card).addEventListener('click', () => removeItem(item));
    $('.crop', card).addEventListener('click', () => cropItem(item));
    els.list.append(card);
    items.push(item);
    added.push(item);
  }
  if (added.length) {
    updateToolbar();
    run(added);
  }
}

function removeItem(item: Item) {
  item.removed = true;
  item.card.remove();
  item.decoded?.close();
  if (item.result) URL.revokeObjectURL(item.result.url);
  items.splice(items.indexOf(item), 1);
  updateToolbar();
}

els.clear.addEventListener('click', () => [...items].forEach(removeItem));

async function cropItem(item: Item) {
  let d: Decoded;
  try {
    d = await decoded(item);
  } catch {
    return; // decode error is already shown on the card
  }
  const crop = await openCropper(d, item.crop);
  if (crop === undefined || item.removed) return;
  item.crop = crop;
  $('.crop', item.card).setAttribute('aria-pressed', String(crop !== null));
  $<HTMLImageElement>('.thumb img', item.card).src = thumbnail(d.source, area(item, d));
  await processItem(item, readSettings());
  updateToolbar();
}

function area(item: Item, d: Decoded): Rect {
  return item.crop ?? { x: 0, y: 0, w: d.width, h: d.height };
}

/** Decode once (shared by conversion and the crop editor) and fill in the card's source info. */
async function decoded(item: Item): Promise<Decoded> {
  if (item.decoded) return item.decoded;
  item.decoding ??= decodeFile(item.file).then((d) => {
    item.decoded = d;
    $<HTMLImageElement>('.thumb img', item.card).src = thumbnail(d.source, area(item, d));
    $('.orig', item.card).textContent = `${formatBytes(item.file.size)} · ${d.width}×${d.height} · ${d.type}`;
    return d;
  });
  return item.decoding;
}

// ---------- processing ----------

els.convert.addEventListener('click', () => {
  dirty = false;
  els.convert.classList.remove('pulse');
  els.convert.textContent = 'Convert again';
  run(items);
});

async function run(targets: Item[]) {
  const settings = readSettings();
  const queue = [...targets];
  updateToolbar();
  await Promise.all(
    Array.from({ length: Math.min(POOL_SIZE, queue.length) }, async () => {
      while (queue.length) await processItem(queue.shift()!, settings);
    }),
  );
  updateToolbar();
}

async function processItem(item: Item, s: Settings) {
  if (item.removed) return;
  const version = ++item.version;
  const card = item.card;
  const fmt = FORMATS[s.format];
  card.dataset.state = 'working';
  $('.out', card).textContent = 'Converting…';

  try {
    const d = await decoded(item);
    const src = area(item, d);
    let { width, height } = computeSize(src.w, src.h, s.resize);
    if (s.format === 'ico') ({ width, height } = fitWithin(width, height, ICO_MAX));

    const pixels = renderToImageData(d.source, src, width, height, fmt.alpha ? null : s.background);
    const buffer = await encode({
      format: s.format, width, height, buffer: pixels.data.buffer as ArrayBuffer,
      quality: s.quality, lossless: s.lossless, effort: s.effort,
    });
    if (item.removed || version !== item.version) return;

    if (item.result) URL.revokeObjectURL(item.result.url);
    const blob = new Blob([buffer], { type: fmt.mime });
    const name = `${item.file.name.replace(/\.[^.]+$/, '') || 'image'}.${fmt.ext}`;
    item.result = { blob, url: URL.createObjectURL(blob), name, width, height, format: s.format };

    const saved = 1 - blob.size / item.file.size;
    const badge = $('.badge', card);
    badge.textContent = `${saved >= 0 ? '−' : '+'}${Math.abs(Math.round(saved * 100))}%`;
    badge.className = `badge ${saved >= 0 ? 'badge-success' : 'badge-danger'}`;
    $('.out', card).textContent = `${formatBytes(blob.size)} · ${width}×${height} · ${fmt.label}`;
    const dl = $<HTMLAnchorElement>('.download', card);
    dl.href = item.result.url;
    dl.download = name;
    card.dataset.state = 'done';
    saveToHistory({
      id: item.historyId,
      createdAt: item.addedAt,
      updatedAt: Date.now(),
      sourceName: item.file.name,
      sourceSize: item.file.size,
      sourceWidth: d.width,
      sourceHeight: d.height,
      sourceType: d.type,
      name,
      format: s.format,
      width,
      height,
      cropped: item.crop !== null,
      blob,
      thumb: $<HTMLImageElement>('.thumb img', card).src,
    });
  } catch (err) {
    if (version !== item.version) return;
    console.error(err);
    card.dataset.state = 'error';
    $('.out', card).textContent = err instanceof Error ? err.message : 'Failed to convert';
  }
  updateToolbar();
}

// ---------- toolbar ----------

function updateToolbar() {
  els.toolbar.hidden = items.length === 0;
  const done = items.filter((i) => i.result && i.card.dataset.state === 'done');
  const busy = items.some((i) => i.card.dataset.state === 'working');
  els.zip.disabled = busy || done.length === 0;
  els.convert.disabled = busy;
  if (!dirty) els.convert.textContent = busy ? 'Working…' : 'Convert again';

  const before = done.reduce((n, i) => n + i.file.size, 0);
  const after = done.reduce((n, i) => n + i.result!.blob.size, 0);
  const pct = before ? Math.round((1 - after / before) * 100) : 0;
  els.summary.textContent = done.length
    ? `${done.length}/${items.length} done · ${formatBytes(before)} → ${formatBytes(after)} (${pct >= 0 ? '−' : '+'}${Math.abs(pct)}%)`
    : `${items.length} file${items.length === 1 ? '' : 's'}`;
}

els.zip.addEventListener('click', async () => {
  const done = items.filter((i) => i.result);
  if (!done.length) return;
  els.zip.disabled = true;
  $('.label', els.zip).textContent = 'Zipping…';
  try {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const used = new Set<string>();
    for (const { result } of done) {
      let name = result!.name;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = result!.name.replace(/(\.[^.]+)$/, `-${n}$1`);
      used.add(name.toLowerCase());
      zip.file(name, result!.blob); // images are already compressed; STORE is the default
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'converted-images.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } finally {
    $('.label', els.zip).textContent = 'Download all';
    updateToolbar();
  }
});

updateControls();
updateToolbar();
