import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/rules.test.mjs", "tests/game-do.test.mjs", "tests/actions.test.mjs", "tests/index.test.mjs"],
    testTimeout: 30000,
  },
});
