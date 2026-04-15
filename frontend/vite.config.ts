import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** В Docker dev укажите VITE_PROXY_TARGET=http://backend:3000 */
const proxyTarget = process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/rooms": { target: proxyTarget, changeOrigin: true },
      "/health": { target: proxyTarget, changeOrigin: true },
      "/socket.io": { target: proxyTarget, changeOrigin: true, ws: true }
    }
  }
});
