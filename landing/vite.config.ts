import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api is proxied to the FastAPI control plane so the page works
// without CORS setup. BR_API_URL moves the proxy (e.g. when :8000 is taken);
// VITE_API_URL makes the browser call a backend directly instead.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.BR_API_URL ?? "http://127.0.0.1:8000" },
  },
});
