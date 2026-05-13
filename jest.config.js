const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/e2e/", "/.claude/", "/.agents/"],
  modulePathIgnorePatterns: ["/.claude/", "/.agents/"],
};

module.exports = createJestConfig(customJestConfig);
