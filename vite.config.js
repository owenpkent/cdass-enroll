import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    // Local-only: never expose on the network.
    host: "127.0.0.1",
  },
  build: {
    target: "es2022",
  },
});
