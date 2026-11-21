import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.toml" },
    }),
  ],
  test: {
    pool: "@cloudflare/vitest-plugin",
    include: ["tests/integration.test.mjs"],
    testTimeout: 60000,
  },
});
