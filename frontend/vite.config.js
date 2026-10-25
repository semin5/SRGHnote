import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/note/",
  plugins: [react()],
  build: { outDir: "../src/main/resources/static", emptyOutDir: true },
  server: { port: 5184, proxy: { "/note/api": "http://localhost:3019", "/it/api": "http://sarangmc.kr" } },
});
