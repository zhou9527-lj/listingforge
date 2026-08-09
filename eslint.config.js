import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri/target", ".toolchains", ".build", ".tmp", "vite.config.js", "vite.config.d.ts"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // Node 脚本（截图/构建工具）：声明 Node 全局变量，避免 no-undef
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        document: "readonly", // page.evaluate 回调在浏览器上下文执行
        window: "readonly", // evaluateOnNewDocument / evaluate 回调在浏览器上下文执行
        atob: "readonly", // 同一回调内解码 PNG mock 字节
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { window: "readonly", document: "readonly", navigator: "readonly" },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
