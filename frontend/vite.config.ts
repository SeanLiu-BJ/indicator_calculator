import { defineConfig } from "vite";
import reactRefresh from "@vitejs/plugin-react-refresh";

const backendPort = process.env.INDICATOR_PORT || "8000";

export default defineConfig({
  plugins: [reactRefresh()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
