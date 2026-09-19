import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";
import pkg from "./package.json" with { type: "json" };

const repoName = "grid-calc-app";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  base: `/${repoName}/`,
  // แสดงเวอร์ชันบนหน้าเว็บ: เพิ่ม "version" ใน package.json ทุกครั้งที่แก้ไขและ deploy
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version.split(".").slice(0, 2).join(".")),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
