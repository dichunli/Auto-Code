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
      // exhaustive-deps 2026-09-13 从 off 改 warn（诊断发现 35 处依赖缺失，
      // 其中 APP 照片恢复逻辑失效就是关闭此规则才没被发现；逐个修完后改回 error）
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "off",
      // Next.js Image 组件优化建议，项目中统一使用 <img> + Tailwind 控制尺寸
      "@next/next/no-img-element": "off",
      // 未使用变量保持 warn；下划线前缀（_args/_relation 等）是"故意不用的 mock 参数"惯例，豁免（2026-08-21）
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      /* ═══ 三条红线显式写死（2026-08-29 待办#15）：原来靠插件 recommended 继承，
       * 升级依赖可能静默降级为 warn，必须保持 error，禁止降级 ═══ */
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/static-components": "error",
      /* ═══ 禁原生弹窗（2026-09-13 弹窗治理后锁住，防反弹）：
       * alert→toast(@/lib/globalToast)/全局提示(GlobalDialogs)，
       * confirm→useConfirm，prompt→全局输入(GlobalDialogs) ═══ */
      "no-restricted-globals": ["error",
        { name: "alert", message: "请用 toast()/全局提示()，见 src/lib/globalToast.ts 与 src/components/GlobalDialogs.tsx" },
        { name: "confirm", message: "请用 useConfirm()（src/components/ConfirmDialog.tsx）" },
        { name: "prompt", message: "请用 全局输入()（src/components/GlobalDialogs.tsx）" },
      ],
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
