import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createZeppOsPlugin } from "zepp-web-runner/plugin";

const root = path.resolve(__dirname, "..");
const webSrc = path.resolve(__dirname, "src");
const generatedConfigPath = path.resolve(root, "shared", "config.generated.js");

export default defineConfig(async () => {
  // `make web` runs the config generator first, so this matches the same
  // CHESS_SERVER_URL as the watch build.
  const generated = existsSync(generatedConfigPath)
    ? (await import(pathToFileURL(generatedConfigPath).href)).default
    : null;
  const serverUrl = generated?.serverUrl || "";

  return {
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
        "@zeppos/zml/base-side": path.resolve(webSrc, "shims/zml-base-side.js"),
        "@shared": path.resolve(root, "shared"),
      },
    },
    server: {
      fs: { allow: [root] },
      // The browser calls /api/* on the Vite origin (see httpAdapter.js), so
      // this proxy is the only thing that talks to the Worker. It avoids
      // CORS/preflight issues on the Worker hostname. `make web` defaults
      // CHESS_SERVER_URL to the local Worker dev server
      // (http://localhost:8787); pass a different CHESS_SERVER_URL to
      // point it at the deployed Worker instead.
      proxy: serverUrl
        ? {
            "/api": {
              target: serverUrl,
              changeOrigin: true,
              secure: true,
            },
          }
        : undefined,
    },
    // Do NOT pre-bundle the runner shims: @zos/ui must resolve to the same
    // module instance the runner's WatchPage collects widgets from. The dep
    // optimizer would otherwise serve a second copy with its own widget list
    // and the board would render empty.
    optimizeDeps: {
      exclude: ["zepp-web-runner", "@zos/ui", "@zos/sensor"],
    },
  };
});
