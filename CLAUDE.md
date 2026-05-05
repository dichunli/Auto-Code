# 汽修厂管理系统 - 项目说明

## 用户背景

- 用户是不懂编程的中国初学者，也不懂英文
- 全程必须使用中文沟通
- 解释技术问题时请尽量通俗化，避免使用晦涩术语

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
- 搜索功能统一使用 300ms 防抖（setTimeout + clearTimeout 模式）
- 表单中的价格/数量字段前端用字符串存储，提交时转换为 number
- 弹窗/模态框使用固定定位（fixed inset-0）+ 半透明遮罩（bg-black/50）实现
- 所有代码注释和界面文案使用中文
- 车型数据来自 `vehicle_models` 表
- 价格优先级规则（维修项目）：指定用户价格 > 指定车型价格 > 单位价 > 车型价 > VIP价 > 标准价

## 代码书写规范

### 基本规则
- **全部代码和注释使用中文**，包括变量名、函数名、组件名（尽量使用中文语义）
- 组件文件名使用 PascalCase（如 `PartForm.tsx`）
- 普通工具文件名使用 camelCase（如 `formatCurrency.ts`）
- 页面路由文件夹使用 kebab-case（如 `parts/new/page.tsx`）

### 组件规范
- 客户端组件（含交互、useState、useEffect 等）文件**顶部必须加 `"use client"`**
- Server Action 文件**顶部必须加 `"use server"`**
- 页面组件默认使用 Server Component，仅将需要交互的部分提取为 Client Component
- 组件 props 优先使用具体 TypeScript 类型，尽量避免 `any`

### 样式规范
- **全部使用 Tailwind CSS 工具类**，不手写 `.css` 文件
- 颜色统一使用 Tailwind 预设色阶（如 `bg-blue-600`、`text-gray-500`）
- 间距优先使用 4 的倍数（如 `p-4`、`gap-2`）

### 状态与表单规范
- 表单中的价格、数量等数字字段，前端用**字符串**存储，提交时转换为 number
- 搜索功能统一使用 **300ms 防抖**（`setTimeout` + `clearTimeout` 模式）
- 弹窗/模态框使用固定定位（`fixed inset-0`）+ 半透明遮罩（`bg-black/50`）

### 交互与错误处理
- 用户操作失败（如保存、删除）使用 `alert()` 提示错误信息
- 删除操作前必须弹出 `confirm()` 确认
- 加载状态使用 `disabled:opacity-50` 和按钮文字变化（如"保存中..."）提示

### 数据库操作规范
- 数据库表结构通过 `supabase/migrations_*.sql` 手写 SQL 管理
- 新建表必须同时创建索引和 RLS 策略
- 删除数据前先检查关联业务数据，防止误删
