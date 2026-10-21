/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @linden/core is consumed from source, so core edits show up live and no build step is needed.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@linden/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) },
  },
  // Relative asset paths so the build can be hosted as static files anywhere (SPEC §1.5).
  base: "./",
  // svg2pdf.js's "main" is a UMD build expecting a global jsPDF; inlined, tests use its ES module.
  test: { server: { deps: { inline: ["svg2pdf.js"] } } },
});
