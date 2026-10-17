export interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Short label of the detected input type, e.g. "HEIC". */
  type: string;
  close(): void;
}

export const ACCEPT = [
  'image/*', '.jpg', '.jpeg', '.jfif', '.png', '.webp', '.avif', '.gif', '.bmp', '.ico',
  '.svg', '.heic', '.heif', '.tif', '.tiff',
].join(',');

const KNOWN_EXT = /\.(jpe?g|jfif|png|webp|avif|gif|bmp|ico|svg|heic|heif|tiff?)$/i;

export function isImageFile(file: File) {
  return file.type.startsWith('image/') || KNOWN_EXT.test(file.name);
}

function extOf(file: File) {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

export async function decodeFile(file: File): Promise<Decoded> {
  const ext = extOf(file);
  const type = (file.type.split('/')[1]?.replace('svg+xml', 'svg').replace('x-icon', 'ico') || ext || 'image').toUpperCase();

  if (/^hei[cf]$/.test(ext) || /hei[cf]/.test(file.type)) {
    // Safari decodes HEIC natively; other browsers need the WASM decoder.
    try {
      return fromBitmap(await createImageBitmap(file), 'HEIC');
    } catch {
      const { default: heic2any } = await import('heic2any');
      const out = await heic2any({ blob: file, toType: 'image/png' });
      return fromBitmap(await createImageBitmap(Array.isArray(out) ? out[0] : out), 'HEIC');
    }
  }

  if (/^tiff?$/.test(ext) || file.type === 'image/tiff') {
    const { default: UTIF } = await import('utif2');
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    // Pick the largest page (TIFFs often carry a thumbnail as an extra page).
    let best = ifds[0];
    let bestArea = 0;
    for (const ifd of ifds) {
      const w = Number((ifd.t256 as number[] | undefined)?.[0] ?? 0);
      const h = Number((ifd.t257 as number[] | undefined)?.[0] ?? 0);
      if (w * h > bestArea) { best = ifd; bestArea = w * h; }
    }
    UTIF.decodeImage(buf, best);
    const rgba = UTIF.toRGBA8(best);
    const w = best.width as number;
    const h = best.height as number;
    const data = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, w * h * 4), w, h);
    return fromBitmap(await createImageBitmap(data), 'TIFF');
  }

  if (ext === 'svg' || file.type === 'image/svg+xml') return fromImageElement(file, 'SVG');

  try {
    return fromBitmap(await createImageBitmap(file), type);
  } catch {
    return fromImageElement(file, type);
  }
}

function fromBitmap(bmp: ImageBitmap, type: string): Decoded {
  return { source: bmp, width: bmp.width, height: bmp.height, type, close: () => bmp.close() };
}

/**
 * Fallback via <img>. For SVG we keep the element itself as the source so the vector
 * is rasterized directly at the target resolution (crisp when enlarging).
 */
async function fromImageElement(file: File, type: string): Promise<Decoded> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`Unsupported or corrupt ${type} file`);
  }
  // SVGs without intrinsic size report 0 in some browsers.
  const width = img.naturalWidth || 1024;
  const height = img.naturalHeight || Math.round((width * 3) / 4);
  return { source: img, width, height, type, close: () => URL.revokeObjectURL(url) };
}
