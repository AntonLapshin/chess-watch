import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createZeppOsPlugin } from "zepp-web-runner/plugin";

const root = path.resolve(__dirname, "..");
const webSrc = path.resolve(__dirname, "src");

export default defineConfig({
  plugins: [
    react(),
    createZeppOsPlugin({ root }),
  ],
  resolve: {
    alias: {
      // Local shims for Zepp APIs the runner does not provide (plan §10 item 5):
      // getDeviceInfo() must return the selected preset's dimensions/shape,
      // storage maps to localStorage, and BasePage.request() calls the same
      // HTTP adapter the side service uses — no BLE in the browser.
      "@zos/device": path.resolve(webSrc, "shims/device.js"),
      "@zos/storage": path.resolve(webSrc, "shims/storage.js"),
      "@zeppos/zml/base-page": path.resolve(webSrc, "shims/zml-base-page.js"),
      "@zeppos/zml/base-app": path.resolve(webSrc, "shims/zml-base-app.js"),
      "@shared": path.resolve(root, "shared"),
    },
  },
  server: {
    fs: { allow: [root] },
  },
  // Do NOT pre-bundle the runner shims: @zos/ui must resolve to the same
  // module instance the runner's WatchPage collects widgets from. The dep
  // optimizer would otherwise serve a second copy with its own widget list
  // and the board would render empty.
  optimizeDeps: {
    exclude: ["zepp-web-runner", "@zos/ui", "@zos/sensor"],
  },
});
