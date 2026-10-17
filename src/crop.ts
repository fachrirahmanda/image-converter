import type { Decoded } from './decode';
import type { Rect } from './resize';

/** Result of the editor: a crop rect, `null` for "no crop", or `undefined` if cancelled. */
export type CropResult = Rect | null | undefined;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const dialog = $<HTMLDialogElement>('#crop-dialog');
const stage = $('#crop-stage');
const canvas = $<HTMLCanvasElement>('#crop-canvas');
const box = $('#crop-box');
const sizeLabel = $('#crop-size');
const ratioButtons = document.querySelectorAll<HTMLButtonElement>('[data-ratio]');

interface State {
  W: number;
  H: number;
  /** Display pixels per source pixel. */
  scale: number;
  rect: Rect;
  ratio: number | null;
  resolve: (r: CropResult) => void;
}

interface Drag {
  mode: string;
  p0: { x: number; y: number };
  start: Rect;
}

let state: State | null = null;
let drag: Drag | null = null;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Smallest crop side, ~12 display px. */
const minSide = () => Math.max(1, 12 / state!.scale);

export function openCropper(d: Decoded, initial: Rect | null): Promise<CropResult> {
  return new Promise((resolve) => {
    const W = d.width;
    const H = d.height;
    const maxW = Math.min(960, window.innerWidth - 80);
    const maxH = window.innerHeight * 0.62;
    const scale = Math.min(maxW / W, maxH / H, 4);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(d.source, 0, 0, canvas.width, canvas.height);

    state = { W, H, scale, rect: initial ? { ...initial } : { x: 0, y: 0, w: W, h: H }, ratio: null, resolve };
    setRatio('free', false);
    render();
    dialog.showModal();
    box.focus();
  });
}

function finish(result: CropResult) {
  if (!state) return;
  const { resolve } = state;
  state = null;
  drag = null;
  if (dialog.open) dialog.close();
  resolve(result);
}

function render() {
  const { rect: r, scale: s } = state!;
  box.style.left = `${r.x * s}px`;
  box.style.top = `${r.y * s}px`;
  box.style.width = `${r.w * s}px`;
  box.style.height = `${r.h * s}px`;
  sizeLabel.textContent = `${Math.round(r.w)} × ${Math.round(r.h)} px`;
}

function setRatio(name: string, refit = true) {
  const st = state!;
  if (name === 'free') st.ratio = null;
  else if (name === 'original') st.ratio = st.W / st.H;
  else {
    const [a, b] = name.split(':').map(Number);
    st.ratio = a / b;
  }
  ratioButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ratio === name)));
  box.dataset.locked = String(st.ratio !== null);
  if (refit && st.ratio) {
    // Largest box of that ratio, centered on the current selection.
    const { W, H, ratio, rect } = st;
    const w = W / H > ratio ? H * ratio : W;
    const h = w / ratio;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    st.rect = { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h };
  }
  render();
}

/**
 * Rect grown from anchor (ax, ay) in direction (sx, sy) with the wanted size,
 * limited to the image bounds and to the locked ratio if any.
 */
function anchored(ax: number, ay: number, sx: number, sy: number, w: number, h: number): Rect {
  const { W, H, ratio } = state!;
  const maxW = sx > 0 ? W - ax : ax;
  const maxH = sy > 0 ? H - ay : ay;
  if (ratio) {
    w = Math.min(Math.max(w, h * ratio), maxW, maxH * ratio);
    h = w / ratio;
  } else {
    w = Math.min(w, maxW);
    h = Math.min(h, maxH);
  }
  return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
}

function toSource(e: PointerEvent) {
  const b = canvas.getBoundingClientRect();
  return { x: (e.clientX - b.left) / state!.scale, y: (e.clientY - b.top) / state!.scale };
}

function update(e: PointerEvent) {
  const st = state!;
  const { mode, p0, start } = drag!;
  const p = toSource(e);
  const dx = p.x - p0.x;
  const dy = p.y - p0.y;

  if (mode === 'move') {
    st.rect = { ...start, x: clamp(start.x + dx, 0, st.W - start.w), y: clamp(start.y + dy, 0, st.H - start.h) };
  } else if (mode === 'draw') {
    const a = { x: clamp(p0.x, 0, st.W), y: clamp(p0.y, 0, st.H) };
    const c = { x: clamp(p.x, 0, st.W), y: clamp(p.y, 0, st.H) };
    st.rect = anchored(a.x, a.y, c.x >= a.x ? 1 : -1, c.y >= a.y ? 1 : -1, Math.abs(c.x - a.x), Math.abs(c.y - a.y));
  } else {
    // Resize from a handle: n/s/e/w or a corner. The opposite side stays fixed.
    const hx = mode.includes('e') ? 1 : mode.includes('w') ? -1 : 0;
    const hy = mode.includes('s') ? 1 : mode.includes('n') ? -1 : 0;
    const sx = hx || 1;
    const sy = hy || 1;
    const ax = sx > 0 ? start.x : start.x + start.w;
    const ay = sy > 0 ? start.y : start.y + start.h;
    const min = minSide();
    st.rect = anchored(ax, ay, sx, sy, Math.max(min, start.w + hx * dx), Math.max(min, start.h + hy * dy));
  }
  render();
}

stage.addEventListener('pointerdown', (e) => {
  if (!state || e.button !== 0) return;
  const t = e.target as HTMLElement;
  drag = { mode: t.dataset.h ?? (t === box ? 'move' : 'draw'), p0: toSource(e), start: { ...state.rect } };
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
});
stage.addEventListener('pointermove', (e) => {
  if (state && drag) update(e);
});
const endDrag = () => {
  if (!state || !drag) return;
  // A click (or tiny drag) on the image should not collapse the selection.
  const min = minSide();
  if (drag.mode === 'draw' && (state.rect.w < min || state.rect.h < min)) {
    state.rect = drag.start;
    render();
  }
  drag = null;
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

box.addEventListener('keydown', (e) => {
  if (!state) return;
  const step = (e.shiftKey ? 10 : 1) / state.scale;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!delta) return;
  e.preventDefault();
  const r = state.rect;
  state.rect = { ...r, x: clamp(r.x + delta[0], 0, state.W - r.w), y: clamp(r.y + delta[1], 0, state.H - r.h) };
  render();
});

ratioButtons.forEach((b) => b.addEventListener('click', () => state && setRatio(b.dataset.ratio!)));

$('#crop-reset').addEventListener('click', () => {
  if (!state) return;
  state.rect = { x: 0, y: 0, w: state.W, h: state.H };
  setRatio('free');
});
$('#crop-cancel').addEventListener('click', () => finish(undefined));
$('#crop-apply').addEventListener('click', () => {
  if (!state) return;
  const { W, H, rect: r } = state;
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = clamp(Math.round(r.w), 1, W - x);
  const h = clamp(Math.round(r.h), 1, H - y);
  finish(x === 0 && y === 0 && w === W && h === H ? null : { x, y, w, h });
});
// Esc or any other close counts as cancel.
dialog.addEventListener('close', () => finish(undefined));
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) finish(undefined); // backdrop click
});
