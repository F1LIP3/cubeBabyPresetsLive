import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-capacitor',
      apply: 'build',
      closeBundle() {
        // Copy capacitor.js to build output
        const src = path.resolve(__dirname, 'node_modules/@capacitor/core/dist/capacitor.js');
        const dest = path.resolve(__dirname, 'dist/renderer/capacitor.js');
        fs.copyFileSync(src, dest);
      },
    },
  ],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});