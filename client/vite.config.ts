import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@shared": path.resolve(__dirname, "../shared/src/index.ts") },
  },
  server: {
    fs: { allow: [".."] },
    proxy: { "/api": "http://localhost:3001" },
  },
});
