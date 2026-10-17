import type { EncodeRequest, EncodeResponse } from './formats';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<EncodeRequest & { id: number }>) => void) | null;
  postMessage(msg: EncodeResponse, transfer?: Transferable[]): void;
};

ctx.onmessage = async (e) => {
  const { id } = e.data;
  try {
    const buffer = await encode(e.data);
    ctx.postMessage({ id, buffer }, [buffer]);
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

async function encode({ format, width, height, buffer, quality, lossless, effort }: EncodeRequest): Promise<ArrayBuffer> {
  const img = new ImageData(new Uint8ClampedArray(buffer), width, height);
  switch (format) {
    case 'jpeg': {
      const { encode } = await import('@jsquash/jpeg');
      return encode(img, { quality });
    }
    case 'png':
      return encodePng(img, effort);
    case 'webp': {
      const { encode } = await import('@jsquash/webp');
      const method = [2, 4, 6][effort];
      return lossless
        ? encode(img, { lossless: 1, quality: [25, 75, 100][effort], method, exact: 1 })
        : encode(img, { quality, method });
    }
    case 'avif': {
      const { encode } = await import('@jsquash/avif');
      return encode(img, { quality: lossless ? 100 : quality, lossless, speed: [8, 6, 4][effort] });
    }
    case 'tiff': {
      const { default: UTIF } = await import('utif2');
      return UTIF.encodeImage(new Uint8Array(img.data.buffer), width, height);
    }
    case 'bmp':
      return encodeBmp(img);
    case 'ico':
      return encodeIco(img, await encodePng(img, effort));
  }
}

async function encodePng(img: ImageData, effort: number) {
  const { optimise } = await import('@jsquash/oxipng');
  return optimise(img, { level: [1, 2, 4][effort], interlace: false });
}

/** 24-bit bottom-up BMP. Alpha has already been flattened by the caller. */
function encodeBmp({ width: w, height: h, data }: ImageData): ArrayBuffer {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + rowSize * h;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint16(0, 0x4d42, true); // "BM"
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, rowSize * h, true);
  v.setInt32(38, 2835, true); // 72 DPI
  v.setInt32(42, 2835, true);
  const out = new Uint8Array(buf);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    const dst = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      out[dst + x * 3] = data[src + x * 4 + 2];
      out[dst + x * 3 + 1] = data[src + x * 4 + 1];
      out[dst + x * 3 + 2] = data[src + x * 4];
    }
  }
  return buf;
}

/** Single-image ICO wrapping a PNG payload (supported by all modern OSes and browsers). */
function encodeIco({ width, height }: ImageData, png: ArrayBuffer): ArrayBuffer {
  const buf = new ArrayBuffer(22 + png.byteLength);
  const v = new DataView(buf);
  v.setUint16(2, 1, true); // type: icon
  v.setUint16(4, 1, true); // image count
  v.setUint8(6, width >= 256 ? 0 : width);
  v.setUint8(7, height >= 256 ? 0 : height);
  v.setUint16(10, 1, true); // planes
  v.setUint16(12, 32, true); // bpp
  v.setUint32(14, png.byteLength, true);
  v.setUint32(18, 22, true);
  new Uint8Array(buf, 22).set(new Uint8Array(png));
  return buf;
}
