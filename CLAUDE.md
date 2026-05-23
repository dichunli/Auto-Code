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
- 数据唯一性约束（数据库层 + 前端校验需同时保证）：
  - 客户表：`phone` 可为空，非空时全局唯一
  - 车辆表：`vin` 全局唯一（允许空值，非空值不可重复）
  - 车辆表：`plate_number` 全局唯一，且不可为空
  - 配件库存表（`parts`）：`part_number` 全局唯一，且不可为空
  - 维修项目名称库（`service_names`）：`name` 全局唯一，且不可为空
  - 配件名称库（`part_names`）：`name` 全局唯一，且不可为空
- 图片上传前统一压缩至 **300KB** 以内，使用 `src/lib/imageCompress.ts`
- 视频不上传原文件、前端不压缩，限制单个不超过 **100MB**、时长不超过 **60 秒**

### 数据质量规范
- 字符串字段提交前统一 `trim()`，为空时传 `NULL`（不存空字符串）
- 数字字段（价格、数量等）未填写时传 `NULL`，`0` 表示实际值为 0
- 金额计算注意 JavaScript 浮点数精度问题，关键运算建议先转整数分处理

### 表单校验规则
- 车牌号：必填，`trim()` + `toUpperCase()`
- VIN 码：可选填，`trim()` + `toUpperCase()`，非空时校验全局唯一性
- 客户手机号：必填，`trim()`，校验全局唯一性

## 部署与运维

### 生产环境
- **服务器**：Windows 11 Pro，通过 PM2 管理 Next.js 进程
- **服务名**：`auto-repair-shop`
- **端口**：3000（本地访问 `http://localhost:3000`）
- **启动配置**：`ecosystem.config.js`

### 安全部署流程（重要）
**必须先停服，再构建，再启动**。禁止在 PM2 运行期间删除 `.next` 目录，否则会导致静态文件句柄失效，页面样式/脚本 404 或 500。

```bash
pm2 stop auto-repair-shop
npm run build
pm2 start ecosystem.config.js
```

### 一键部署
- 项目根目录有 `deploy.bat`，双击可自动完成"停服→构建→启动"
- 如果构建出现红色报错，需先修复错误再重新部署
- 部署完成后需强制刷新浏览器（Ctrl+F5）清除缓存
