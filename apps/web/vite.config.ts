import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Не 5173: на Windows с WSL/Hyper-V этот порт часто попадает в зарезервированный диапазон.
    port: 3100,
    strictPort: true,
    // В разработке запросы к API идут через Vite, чтобы не возиться с CORS.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
