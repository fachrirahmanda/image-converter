export type OutFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff' | 'bmp' | 'ico';

export interface FormatInfo {
  label: string;
  ext: string;
  mime: string;
  /** Has a quality slider. */
  lossy: boolean;
  /** Offers a lossless toggle (WebP / AVIF). */
  losslessOption: boolean;
  /** Supports transparency; if false, alpha is flattened onto a background color. */
  alpha: boolean;
  /** Has an encoder effort setting. */
  effort: boolean;
  defaultQuality: number;
  note?: string;
}

export const FORMATS: Record<OutFormat, FormatInfo> = {
  jpeg: { label: 'JPEG', ext: 'jpg', mime: 'image/jpeg', lossy: true, losslessOption: false, alpha: false, effort: false, defaultQuality: 80, note: 'MozJPEG encoder — best for photos.' },
  png: { label: 'PNG', ext: 'png', mime: 'image/png', lossy: false, losslessOption: false, alpha: true, effort: true, defaultQuality: 100, note: 'Lossless, optimized with OxiPNG.' },
  webp: { label: 'WebP', ext: 'webp', mime: 'image/webp', lossy: true, losslessOption: true, alpha: true, effort: true, defaultQuality: 80, note: 'Great all-rounder, supported everywhere.' },
  avif: { label: 'AVIF', ext: 'avif', mime: 'image/avif', lossy: true, losslessOption: true, alpha: true, effort: true, defaultQuality: 60, note: 'Smallest files. Encoding is slower, especially at "Max" effort.' },
  tiff: { label: 'TIFF', ext: 'tiff', mime: 'image/tiff', lossy: false, losslessOption: false, alpha: true, effort: false, defaultQuality: 100, note: 'Uncompressed — files will be large.' },
  bmp: { label: 'BMP', ext: 'bmp', mime: 'image/bmp', lossy: false, losslessOption: false, alpha: false, effort: false, defaultQuality: 100, note: 'Uncompressed 24-bit bitmap.' },
  ico: { label: 'ICO', ext: 'ico', mime: 'image/x-icon', lossy: false, losslessOption: false, alpha: true, effort: true, defaultQuality: 100, note: 'Icons are limited to 256×256; larger images are scaled down.' },
};

export const ICO_MAX = 256;

export interface EncodeRequest {
  id?: number;
  format: OutFormat;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  quality: number;
  lossless: boolean;
  /** 0 = fast, 1 = balanced, 2 = max */
  effort: number;
}

export type EncodeResponse = { id: number; buffer: ArrayBuffer } | { id: number; error: string };

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}
