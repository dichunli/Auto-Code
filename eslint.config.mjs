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
    // Node.js 脚本使用 require() 是标准做法
    "**/*.js",
  ]),
]);

export default eslintConfig;
