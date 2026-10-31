import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The backend's /v1 API (REST + SSE) is proxied so the browser sees one origin.
const api = process.env.TOWER_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/v1": { target: api, changeOrigin: true } } },
  preview: { proxy: { "/v1": { target: api, changeOrigin: true } } },
});
