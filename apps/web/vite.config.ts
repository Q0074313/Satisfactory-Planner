import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Spieldaten liegen außerhalb des App-Ordners (data/gamedata).
    fs: { allow: ['../..'] },
    // Optionaler Server (npm run dev:server) für Konten und Freigaben
    proxy: { '/api': { target: process.env.SATIS_API ?? 'http://localhost:8080', changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
