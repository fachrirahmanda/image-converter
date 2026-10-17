import { FORMATS, formatBytes, type OutFormat } from './formats';

/** One processed image, kept in IndexedDB so it survives reloads. Nothing leaves the device. */
export interface HistoryEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
  sourceName: string;
  sourceSize: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceType: string;
  name: string;
  format: OutFormat;
  width: number;
  height: number;
  cropped: boolean;
  blob: Blob;
  /** Small data-URL preview. */
  thumb: string;
}

const MAX_ENTRIES = 200;
const MAX_BYTES = 500 * 1024 ** 2;
const ENABLED_KEY = 'history-enabled';

// ---------- storage ----------

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('image-converter', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('history', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction('history', mode).objectStore('history');
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function list(): Promise<HistoryEntry[]> {
  const all = await tx<HistoryEntry[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function historyEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Insert or replace an entry, then evict the oldest beyond the count/size limits. */
export async function saveToHistory(entry: HistoryEntry) {
  if (!historyEnabled()) return;
  try {
    await tx('readwrite', (s) => s.put(entry));
    const all = await list();
    let bytes = 0;
    for (const [i, e] of all.entries()) {
      bytes += e.blob.size;
      if (i >= MAX_ENTRIES || bytes > MAX_BYTES) await tx('readwrite', (s) => s.delete(e.id));
    }
    render();
  } catch (err) {
    // Storage unavailable (private mode, quota): history is a convenience, never block conversion.
    console.warn('History not saved:', err);
  }
}

// ---------- UI (right-hand panel) ----------

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

const listEl = $('#history-list');
const empty = $('#history-empty');
const usage = $('#history-usage');
const enabled = $<HTMLInputElement>('#history-enabled');
const clearBtn = $<HTMLButtonElement>('#history-clear');
const template = $<HTMLTemplateElement>('#history-item-template');

enabled.checked = historyEnabled();
enabled.addEventListener('change', () => {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled.checked));
  } catch {}
});

clearBtn.addEventListener('click', async () => {
  if (!confirm('Delete all images from history? This cannot be undone.')) return;
  await tx('readwrite', (s) => s.clear());
  render();
});

async function render() {
  let entries: HistoryEntry[] = [];
  try {
    entries = await list();
  } catch {
    $('p', empty).textContent = 'History unavailable';
    $('.hint', empty).textContent = 'This browser is blocking site storage.';
  }
  listEl.replaceChildren();
  empty.hidden = entries.length > 0;
  clearBtn.hidden = entries.length === 0;
  const bytes = entries.reduce((n, e) => n + e.blob.size, 0);
  usage.textContent = entries.length ? `${entries.length} image${entries.length === 1 ? '' : 's'} · ${formatBytes(bytes)}` : '';

  let lastDay = '';
  for (const e of entries) {
    const day = dayLabel(e.updatedAt);
    if (day !== lastDay) {
      const h = document.createElement('li');
      h.className = 'history-day';
      h.textContent = day;
      listEl.append(h);
      lastDay = day;
    }
    listEl.append(row(e));
  }
}

function row(e: HistoryEntry): HTMLElement {
  const li = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
  $<HTMLImageElement>('img', li).src = e.thumb;
  $('.name', li).textContent = e.name;
  const time = new Date(e.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('.detail', li).textContent = `${FORMATS[e.format].label} · ${formatBytes(e.blob.size)} ·`;
  const saved = 1 - e.blob.size / e.sourceSize;
  const saving = $('.saving', li);
  saving.textContent = `${saved >= 0 ? '−' : '+'}${Math.abs(Math.round(saved * 100))}%`;
  saving.className = `saving ${saved >= 0 ? 'good' : 'bad'}`;
  li.title =
    `${e.sourceName} (${e.sourceType}, ${formatBytes(e.sourceSize)}, ${e.sourceWidth}×${e.sourceHeight})
→ ` +
    `${e.name} (${FORMATS[e.format].label}, ${formatBytes(e.blob.size)}, ${e.width}×${e.height}${e.cropped ? ', cropped' : ''})
${time}`;

  $('.download', li).addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(e.blob);
    a.download = e.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  });
  $('.delete', li).addEventListener('click', async () => {
    await tx('readwrite', (s) => s.delete(e.id));
    render();
  });
  return li;
}

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

render();
