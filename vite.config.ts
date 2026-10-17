import { defineConfig } from 'vite';

export default defineConfig({
  // jSquash codecs load their .wasm via import.meta.url; pre-bundling breaks those paths.
  optimizeDeps: {
    exclude: ['@jsquash/avif', '@jsquash/jpeg', '@jsquash/webp', '@jsquash/oxipng'],
  },
  worker: { format: 'es' },
  // heic2any/AVIF chunks are large but only lazy-loaded when those formats are used.
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
