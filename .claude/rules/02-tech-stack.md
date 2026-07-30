# 技术栈与版本锁定

## 版本锁定声明（重要）

- **保持当前技术栈版本，不要自动升级任何依赖**
- 除非用户明确要求升级某个特定包，否则维持现有版本不变
- 不要引入新的框架或工具（如 Redux、Zustand、React Query、Prisma 等）
- 数据库表结构通过 `supabase/migrations_*.sql` 文件手动管理

## 技术栈（当前固定版本）

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Next.js | 16.2.4（App Router 模式） |
| UI 库 | React | 19.2.4 |
| 语言 | TypeScript | 5.x |
| 样式 | Tailwind CSS | 4.x |
| 数据库/后端 | Supabase | supabase-js ^2.105.1 |
| 测试 | Vitest | ^4.1.5 |
| 其他 | jsbarcode, qrcode.react, xlsx | 见 package.json |

## 项目约定

- 客户端组件文件顶部必须加 `"use client"` 声明
- 搜索功能统一使用 `useDebounce` Hook（`src/lib/useDebounce.ts`），禁止手写 `setTimeout` + `clearTimeout` 防抖
- 表单中的价格/数量字段前端用字符串存储，提交时转换为 number
- 弹窗/模态框使用固定定位（fixed inset-0）+ 半透明遮罩（bg-black/50）实现
- 所有代码注释和界面文案使用中文
- 车型数据来自 `vehicle_models` 表
- 价格优先级规则（从高到低）：
  1. 指定用户价格 — 按车辆
  2. 指定用户价格 — 按用户
  3. 指定用户价格 — 按单位
  4. 指定车型价格 — 单位价
  5. 指定车型价格 — VIP价
  6. 指定车型价格 — 销售价
  7. 单位价
  8. 车型价
  9. VIP价
  10. 标准价
