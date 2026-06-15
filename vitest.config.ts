import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only our fast, pure unit tests — NOT the VS Code integration tests in
    // src/test/, which import 'vscode' and can only run inside the Extension Host.
    include: ["src/**/*.unit.test.ts"],
    reporters: ["default", "junit"],
    outputFile: { junit: "test-results/junit.xml" },
  },
});
