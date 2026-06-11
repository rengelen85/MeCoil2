import { svelte } from '@sveltejs/vite-plugin-svelte';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERT_PATH = path.resolve(__dirname, '../certs/cert.pem');
const KEY_PATH = path.resolve(__dirname, '../certs/key.pem');

// Mirror the server's auto-detection: use HTTPS when certs are present.
const hasCerts = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);
const wsTarget = hasCerts ? 'wss://localhost:3000' : 'ws://localhost:3000';

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: true,
    https: hasCerts
      ? { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) }
      : false,
    proxy: {
      '/ws': {
        target: wsTarget,
        ws: true,
        secure: false,
      },
    },
  },
  resolve: {
    alias: {
      $shared: path.resolve(__dirname, '../shared'),
    },
  },
});
