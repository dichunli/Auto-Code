# 测试规范

- **工具函数必须有单元测试**：`src/lib/` 和 `src/utils/` 下的纯函数必须编写 Vitest 测试用例
- **核心业务流程覆盖**：客户创建、工单开单、库存出入库等核心业务至少有一条端到端或集成测试路径
- **测试文件命名**：与被测文件同名 + `.test.ts`（如 `formatCurrency.ts` 对应 `formatCurrency.test.ts`）
- **提交前自检**：运行 `npm run test:unit` 确保测试通过，运行 `npm run build` 确保构建无报错
- **涉及登录/session/认证的改动，必须额外运行 `npm run test:auth`**（认证回归测试，覆盖登录后刷新、软跳转、未登录拦截、退出登录拦截等历史事故场景）；需要环境变量 `SMOKE_ACCOUNT` / `SMOKE_PASSWORD`
- **核心保存流程改动需真实浏览器实测**：在独立测试目录起 dev 服务器（见 08-deployment.md），用 Playwright 走一遍"填写→保存→查数据库验证→清理测试数据"的完整闭环
