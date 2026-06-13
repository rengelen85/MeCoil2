// vite.config.js
import { svelte } from 'file:///C:/Users/tamar/Code%20repos/MeCoil/client/node_modules/@sveltejs/vite-plugin-svelte/src/index.js';
import { defineConfig } from 'file:///C:/Users/tamar/Code%20repos/MeCoil/client/node_modules/vite/dist/node/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var __vite_injected_original_import_meta_url =
  'file:///C:/Users/tamar/Code%20repos/MeCoil/client/vite.config.js';
var __dirname = path.dirname(
  fileURLToPath(__vite_injected_original_import_meta_url),
);
var CERT_PATH = path.resolve(__dirname, '../certs/cert.pem');
var KEY_PATH = path.resolve(__dirname, '../certs/key.pem');
var hasCerts = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);
var wsTarget = hasCerts ? 'wss://localhost:3000' : 'ws://localhost:3000';
var vite_config_default = defineConfig({
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

export { vite_config_default as default };
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFx0YW1hclxcXFxDb2RlIHJlcG9zXFxcXE1lQ29pbFxcXFxjbGllbnRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXHRhbWFyXFxcXENvZGUgcmVwb3NcXFxcTWVDb2lsXFxcXGNsaWVudFxcXFx2aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvdGFtYXIvQ29kZSUyMHJlcG9zL01lQ29pbC9jbGllbnQvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBzdmVsdGUgfSBmcm9tICdAc3ZlbHRlanMvdml0ZS1wbHVnaW4tc3ZlbHRlJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICd1cmwnO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5cbmNvbnN0IF9fZGlybmFtZSA9IHBhdGguZGlybmFtZShmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCkpO1xuY29uc3QgQ0VSVF9QQVRIID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL2NlcnRzL2NlcnQucGVtJyk7XG5jb25zdCBLRVlfUEFUSCA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9jZXJ0cy9rZXkucGVtJyk7XG5cbi8vIE1pcnJvciB0aGUgc2VydmVyJ3MgYXV0by1kZXRlY3Rpb246IHVzZSBIVFRQUyB3aGVuIGNlcnRzIGFyZSBwcmVzZW50LlxuY29uc3QgaGFzQ2VydHMgPSBmcy5leGlzdHNTeW5jKENFUlRfUEFUSCkgJiYgZnMuZXhpc3RzU3luYyhLRVlfUEFUSCk7XG5jb25zdCB3c1RhcmdldCA9IGhhc0NlcnRzID8gJ3dzczovL2xvY2FsaG9zdDozMDAwJyA6ICd3czovL2xvY2FsaG9zdDozMDAwJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3N2ZWx0ZSgpXSxcbiAgc2VydmVyOiB7XG4gICAgaG9zdDogdHJ1ZSxcbiAgICBodHRwczogaGFzQ2VydHNcbiAgICAgID8geyBjZXJ0OiBmcy5yZWFkRmlsZVN5bmMoQ0VSVF9QQVRIKSwga2V5OiBmcy5yZWFkRmlsZVN5bmMoS0VZX1BBVEgpIH1cbiAgICAgIDogZmFsc2UsXG4gICAgcHJveHk6IHtcbiAgICAgICcvd3MnOiB7XG4gICAgICAgIHRhcmdldDogd3NUYXJnZXQsXG4gICAgICAgIHdzOiB0cnVlLFxuICAgICAgICBzZWN1cmU6IGZhbHNlLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICRzaGFyZWQ6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9zaGFyZWQnKSxcbiAgICB9LFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXFULFNBQVMsY0FBYztBQUM1VSxPQUFPLFFBQVE7QUFDZixPQUFPLFVBQVU7QUFDakIsU0FBUyxxQkFBcUI7QUFDOUIsU0FBUyxvQkFBb0I7QUFKb0ssSUFBTSwyQ0FBMkM7QUFNbFAsSUFBTSxZQUFZLEtBQUssUUFBUSxjQUFjLHdDQUFlLENBQUM7QUFDN0QsSUFBTSxZQUFZLEtBQUssUUFBUSxXQUFXLG1CQUFtQjtBQUM3RCxJQUFNLFdBQVcsS0FBSyxRQUFRLFdBQVcsa0JBQWtCO0FBRzNELElBQU0sV0FBVyxHQUFHLFdBQVcsU0FBUyxLQUFLLEdBQUcsV0FBVyxRQUFRO0FBQ25FLElBQU0sV0FBVyxXQUFXLHlCQUF5QjtBQUVyRCxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsT0FBTyxDQUFDO0FBQUEsRUFDbEIsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sT0FBTyxXQUNILEVBQUUsTUFBTSxHQUFHLGFBQWEsU0FBUyxHQUFHLEtBQUssR0FBRyxhQUFhLFFBQVEsRUFBRSxJQUNuRTtBQUFBLElBQ0osT0FBTztBQUFBLE1BQ0wsT0FBTztBQUFBLFFBQ0wsUUFBUTtBQUFBLFFBQ1IsSUFBSTtBQUFBLFFBQ0osUUFBUTtBQUFBLE1BQ1Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsU0FBUyxLQUFLLFFBQVEsV0FBVyxXQUFXO0FBQUEsSUFDOUM7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
