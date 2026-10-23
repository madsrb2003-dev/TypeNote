import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { pdfRecognitionPlugin } from './scripts/recognition/plugin.mjs';

export default defineConfig({
  plugins: [react(), pdfRecognitionPlugin()],
  optimizeDeps: { include: ['verovio/wasm', 'verovio/esm'] },
  server: {
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.typenote-imports/**', '**/.typenote-tools/**'] },
    watch: { ignored: ['**/.typenote-imports/**', '**/.typenote-tools/**', '**/test-results/**'] },
  },
  test: { include: ['src/**/*.test.ts'] },
});
