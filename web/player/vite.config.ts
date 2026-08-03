import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = `http://localhost:${process.env.PORT ?? 8080}`;

// No PWA/offline layer here: the terminal is played next to the server on a
// laptop with a webcam, not in the field.
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': backend,
      '/assets-store': backend,
      '/minigames': backend,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
