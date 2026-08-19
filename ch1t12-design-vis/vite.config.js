import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const buildId = process.env.SONG_BUILD_ID || Date.now().toString(36);

export default defineConfig({
  base: "./",
  plugins: [vue()],
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8650",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
