import { defineConfig } from "vitest/config";

/**
 * 数据库集成测试专用配置（npm run test:db）
 *
 * 与单元测试（vitest.config.ts）分离的原因：
 * - 这类测试需要真实 Postgres（本地 Supabase 或 CI 的 postgres 服务），
 *   不能混进默认范围，否则没有数据库的电脑上 npm test 必然失败
 * - 纯 Node 环境直连 pg，不需要 jsdom / React 插件
 *
 * 运行前提：TEST_DATABASE_URL 指向已应用全部迁移的数据库
 * （CI 里由 scripts/ci-db-setup.sh 自动完成建库）
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["supabase/tests/**/*.test.ts"],
    /* 数据库操作和造数较慢，超时放宽 */
    testTimeout: 30000,
    hookTimeout: 60000,
    /* 测试文件串行跑：多个文件共用同一个库，并行容易互相干扰测试数据 */
    fileParallelism: false,
  },
});
