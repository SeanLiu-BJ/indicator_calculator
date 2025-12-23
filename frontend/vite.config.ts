import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = process.env.INDICATOR_PORT || "8000";
const uiHost = process.env.INDICATOR_UI_HOST || "127.0.0.1";
const uiPort = Number(process.env.INDICATOR_UI_PORT || "5173");

export default defineConfig({
  plugins: [react()],
  server: {
    host: uiHost,
    port: uiPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
