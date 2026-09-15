# 测试规范

- **工具函数必须有单元测试**：`src/lib/` 和 `src/utils/` 下的纯函数必须编写 Vitest 测试用例
- **涉及金额、库存的 Server Action / RPC 必须有集成测试**：管钱管货的代码没有测试保护出过事故（并发入库丢库存），数据库测试写法参照 `supabase/tests/settle-work-order.test.ts`（pg 直连 + withAuth 注入身份 + 前缀造数清理）
- **权限校验必须有"拒绝路径"测试**：未登录、角色不足时必须断言被拦住，不能只测正常路径
- **修 bug 必须补回归测试**：每个修复提交附一条能复现该 bug 的测试，防止复发
- **数据库集成测试**：放 `supabase/tests/`，用 `npm run test:db` 单独跑（走 `vitest.db.config.ts`，需本地 Postgres）；CI 里由 GitHub Actions 自动建库执行（`scripts/ci-db-setup.sh` 垫片 + 全量迁移重放）
- **核心业务流程覆盖**：客户创建、工单开单、库存出入库等核心业务至少有一条端到端或集成测试路径
- **测试文件命名**：与被测文件同名 + `.test.ts`（如 `formatCurrency.ts` 对应 `formatCurrency.test.ts`）
- **提交前自检**：运行 `npm run test:unit` 确保测试通过，运行 `npm run build` 确保构建无报错
- **涉及登录/session/认证的改动，必须额外运行 `npm run test:auth`**（认证回归测试，覆盖登录后刷新、软跳转、未登录拦截、退出登录拦截等历史事故场景）；需要环境变量 `SMOKE_ACCOUNT` / `SMOKE_PASSWORD`
- **核心保存流程改动需真实浏览器实测**：在独立测试目录起 dev 服务器（见 08-deployment.md），用 Playwright 走一遍"填写→保存→查数据库验证→清理测试数据"的完整闭环
