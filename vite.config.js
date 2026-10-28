import { defineConfig } from "vite";
import { rmSync } from "node:fs";
import { join } from "node:path";

// public/seed.local.json holds real employer details. Dev reads it from
// public/, but it must never ship in a build (dist/ may be served or shared).
function stripSeedFromBuild() {
  let outDir;
  return {
    name: "strip-seed-from-build",
    apply: "build",
    configResolved(cfg) {
      outDir = join(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      rmSync(join(outDir, "seed.local.json"), { force: true });
    },
  };
}

// The dev server needs ws: for HMR; the shipped build does not.
function stripWsFromBuildCsp() {
  return {
    name: "strip-ws-from-build-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(/\s+ws:\/\/(?:localhost|127\.0\.0\.1):\*/g, "");
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [stripSeedFromBuild(), stripWsFromBuildCsp()],
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
