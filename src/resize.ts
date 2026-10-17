export type ResizeMode = 'none' | 'percent' | 'dimensions' | 'maxside';

export interface ResizeOptions {
  mode: ResizeMode;
  percent: number;
  width: number | null;
  height: number | null;
  keepAspect: boolean;
  maxSide: number | null;
}

const MAX_DIM = 16384;

export interface Size { width: number; height: number }

/** A region of the source image, in source pixels. */
export interface Rect { x: number; y: number; w: number; h: number }

export function computeSize(w: number, h: number, o: ResizeOptions): Size {
  let tw = w;
  let th = h;
  switch (o.mode) {
    case 'percent':
      tw = (w * o.percent) / 100;
      th = (h * o.percent) / 100;
      break;
    case 'dimensions':
      if (o.keepAspect) {
        const s = o.width && o.height ? Math.min(o.width / w, o.height / h)
          : o.width ? o.width / w
          : o.height ? o.height / h
          : 1;
        tw = w * s;
        th = h * s;
      } else {
        tw = o.width || w;
        th = o.height || h;
      }
      break;
    case 'maxside':
      if (o.maxSide) {
        const s = Math.min(1, o.maxSide / Math.max(w, h));
        tw = w * s;
        th = h * s;
      }
      break;
  }
  return fitWithin(clampDim(tw), clampDim(th), MAX_DIM);
}

export function fitWithin(w: number, h: number, max: number): Size {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: clampDim(w * s), height: clampDim(h * s) };
}

function clampDim(n: number) {
  return Math.max(1, Math.round(n));
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

/**
 * Draw the `area` of the source at the target size and return its pixels. Large reductions are done in
 * successive halving steps, which avoids the aliasing of a single big downscale.
 * If `background` is given, transparency is flattened onto it.
 */
export function renderToImageData(
  src: CanvasImageSource, area: Rect, tw: number, th: number, background: string | null,
): ImageData {
  let cur: CanvasImageSource = src;
  let { x: cx, y: cy, w: cw, h: ch } = area;
  while (cw / 2 >= tw && ch / 2 >= th) {
    const nw = Math.floor(cw / 2);
    const nh = Math.floor(ch / 2);
    const step = canvas(nw, nh);
    step.ctx.drawImage(cur, cx, cy, cw, ch, 0, 0, nw, nh);
    cur = step.c;
    cx = cy = 0;
    cw = nw;
    ch = nh;
  }
  const out = canvas(tw, th);
  if (background) {
    out.ctx.fillStyle = background;
    out.ctx.fillRect(0, 0, tw, th);
  }
  // Uncropped SVG <img> sources are drawn without a source rect so they rasterize at the target size.
  const wholeImg = cur === src && src instanceof HTMLImageElement && cx === 0 && cy === 0
    && cw === (src.naturalWidth || cw) && ch === (src.naturalHeight || ch);
  if (wholeImg) out.ctx.drawImage(cur, 0, 0, tw, th);
  else out.ctx.drawImage(cur, cx, cy, cw, ch, 0, 0, tw, th);
  return out.ctx.getImageData(0, 0, tw, th);
}

export function thumbnail(src: CanvasImageSource, area: Rect, max = 160): string {
  const { width, height } = fitWithin(area.w, area.h, max);
  const img = renderToImageData(src, area, width, height, null);
  const { c, ctx } = canvas(width, height);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
