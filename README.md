# Image Converter

Convert, compress, resize and crop images entirely in the browser. Files are never uploaded.

**Live:** https://image-converter-7ru.pages.dev

## Features

- **Input:** JPEG, PNG, WebP, AVIF, HEIC/HEIF, TIFF, GIF (first frame), BMP, SVG, ICO
- **Output:** WebP, AVIF, JPEG, PNG, TIFF, BMP, ICO
- **Compression:** quality slider, lossless mode (WebP/AVIF), encoder effort (Fast / Balanced / Max)
- **Resize:** scale by percentage, limit longest side, or exact width/height with aspect lock
- **Crop:** per-image crop editor with aspect-ratio presets
- **Batch:** drag & drop, paste, download all as ZIP
- **History:** processed images saved locally (IndexedDB) for re-download
- Light / dark / system theme

Encoding runs in Web Workers using WebAssembly codecs from [jSquash](https://github.com/jamsinclair/jSquash) (MozJPEG, OxiPNG, libwebp, libavif).

## Development

```bash
npm install
npm run dev       # local dev server
npm run build     # type check + production build into dist/
```

## Deploy

Hosted on Cloudflare Pages (project `image-converter`):

```bash
npx wrangler login
npm run deploy
```

## Project structure

| File | Purpose |
| --- | --- |
| `src/main.ts` | UI, file queue, conversion flow |
| `src/encode.worker.ts` | Encoders (runs in a worker pool, see `src/pool.ts`) |
| `src/decode.ts` | Decoding of all input formats |
| `src/resize.ts` | Size calculation and high-quality downscaling |
| `src/crop.ts` | Crop editor |
| `src/history.ts` | Local history (IndexedDB) and its panel |
| `src/formats.ts` | Output format definitions |
