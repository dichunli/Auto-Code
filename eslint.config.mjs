import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React 19 实验性规则过于严格，对 useEffect 中加载数据的常见模式误报
      // 项目中统一使用 useEffect + async fetch + setState 的数据加载模式，关闭避免误报
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      // Next.js Image 组件优化建议，项目中统一使用 <img> + Tailwind 控制尺寸
      "@next/next/no-img-element": "off",
      // 未使用变量保持 warn；下划线前缀（_args/_relation 等）是"故意不用的 mock 参数"惯例，豁免（2026-08-21）
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-new/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "android/app/build/**",
    "android/app/src/main/assets/**",
    // 多会话并行开发的 worktree 目录（含各自的 .next 构建产物），不参与 lint（2026-08-21）
    ".claude/**",
    // Node.js 脚本使用 require() 是标准做法
    "**/*.js",
  ]),
]);

export default eslintConfig;
