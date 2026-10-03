/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // En modo "mock" (tests de UI en navegador) servimos los fixtures de e2e.
  publicDir: mode === "mock" ? "e2e/public" : false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "chrome120",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
