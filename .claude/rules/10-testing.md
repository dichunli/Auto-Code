# 测试规范

- **工具函数必须有单元测试**：`src/lib/` 和 `src/utils/` 下的纯函数必须编写 Vitest 测试用例
- **核心业务流程覆盖**：客户创建、工单开单、库存出入库等核心业务至少有一条端到端或集成测试路径
- **测试文件命名**：与被测文件同名 + `.test.ts`（如 `formatCurrency.ts` 对应 `formatCurrency.test.ts`）
- **提交前自检**：运行 `npm run test:unit` 确保测试通过，运行 `npm run build` 确保构建无报错
