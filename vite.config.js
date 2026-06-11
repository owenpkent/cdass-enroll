import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    // Local-only: never expose on the network.
    host: "127.0.0.1",
    // Stay off 5173: MacroVox's Tauri webview loads its own UI from
    // localhost:5173 in dev, and will render whatever is listening there.
    port: 5180,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
