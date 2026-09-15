import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    /* 单元测试只扫 src；数据库集成测试在 supabase/tests，用 npm run test:db（vitest.db.config.ts）单独跑，
       避免没有本地 Postgres 的电脑上 npm test 必然失败 */
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
