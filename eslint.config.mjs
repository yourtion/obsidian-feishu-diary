import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
  },
  {
    ignores: ["main.js", "dist/**", "node_modules/**", "scripts/**", "tests/**"],
  },
  {
    // CLI 运行时（src/cli.ts + src/node/，不进 main.js 插件产物）：
    // stdout/stderr 是本职输出；Node 下无 Electron renderer 的 CORS 约束，
    // fetch 即官方姿势（scripts/p0 已实证，见 AGENTS.md 硬知识 9 的适用边界）。
    // obsidianmd/rule-custom-message 是 no-console 的语境包装规则，需一并关闭。
    files: ["src/cli.ts", "src/node/**/*.ts"],
    rules: {
      "no-console": "off",
      "obsidianmd/rule-custom-message": "off",
      "no-restricted-globals": "off",
    },
  },
  {
    // service.ts 是双运行时共用模块（Obsidian 插件 + Node CLI）：globalThis 分支
    // 仅在 CLI 下执行（插件里 window 恒存在，短路不触达），是刻意的 Node 兼容路径。
    files: ["src/service.ts"],
    rules: {
      "obsidianmd/no-global-this": "off",
    },
  },
]);
