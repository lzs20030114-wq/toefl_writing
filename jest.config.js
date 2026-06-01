const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/e2e/", "/.claude/", "/.agents/", "/.codex-tmp/", "/_tmp_push"],
  modulePathIgnorePatterns: ["/.claude/", "/.agents/", "/.codex-tmp/", "/_tmp_push"],
};

module.exports = createJestConfig(customJestConfig);
