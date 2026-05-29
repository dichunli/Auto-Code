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

## TypeScript 类型规范（重要）

- **严禁使用 `any` 类型**。所有数据必须定义具体接口：
  - Supabase 查询返回的数据 → 在文件顶部定义接口（如 `interface 配件分类 { id: string; name: string }`）
  - `useState` 数组状态 → 使用 `useState<配件分类[]>([])` 而非 `useState<any[]>([])`
  - `.map()` / `.filter()` 回调参数 → 使用具体类型而非 `(item: any)`
  - 错误捕获 → 使用 `catch (err: unknown)` + `err instanceof Error` 判断，严禁 `catch (err: any)`
- **禁止 `as any` 类型断言**。如必须断言，使用 `as 具体类型` 或 `as unknown as 目标类型`
- 工具函数中的泛型参数默认使用 `unknown` 而非 `any`（如 `function fn<T = unknown>()`）

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
- 组件 props 优先使用具体 TypeScript 类型，**严禁使用 `any`**
- **禁止在组件函数内部定义子组件**（会导致每次渲染重新创建组件，违反 React 规则）。子组件必须定义在父组件外部、同一文件内
- **禁止条件调用 Hook**：所有 `useState`/`useEffect`/`useCallback`/`useMemo` 等 Hook 必须在组件函数顶部调用，不能放在 `if` 条件分支或提前 `return` 之后

### 样式规范
- **全部使用 Tailwind CSS 工具类**，不手写 `.css` 文件
- 颜色统一使用 Tailwind 预设色阶（如 `bg-blue-600`、`text-gray-500`）
- 间距优先使用 4 的倍数（如 `p-4`、`gap-2`）

### 状态与表单规范
- 表单中的价格、数量等数字字段，前端用**字符串**存储，提交时转换为 number
- 搜索功能统一使用 **300ms 防抖**（`setTimeout` + `clearTimeout` 模式）
- 弹窗/模态框使用固定定位（`fixed inset-0`）+ 半透明遮罩（`bg-black/50`）

### ESLint 红线规则（必须保持为 error，严禁降级）
以下规则已配置在 `eslint.config.mjs` 中，**禁止降级为 warn 或关闭**：
- `@typescript-eslint/no-explicit-any` — 禁止使用 `any` 类型
- `react-hooks/rules-of-hooks` — Hook 必须在组件顶部无条件调用
- `react-hooks/static-components` — 禁止在渲染时创建组件

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

## Git 工作流规范

- **禁止直接推送 `main` 分支**。所有改动通过功能分支 + Pull Request 合并
- 功能分支命名格式：`feat/功能描述`（如 `feat/commission-report`）、`fix/问题描述`（如 `fix/part-search`）
- 提交信息（commit message）使用中文，格式：`类型: 描述`。常用类型：
  - `feat:` 新功能
  - `fix:` 修复 bug
  - `refactor:` 重构（不改功能）
  - `chore:` 杂项（配置、依赖等）
  - `docs:` 文档更新
- **不要每次小修改都提交**。等一个功能点完成后再统一提交，减少提交噪音
- 合并前确保 `npm run build` 无报错，`npm run lint` 无 error

## 改动安全规范（防止改坏已有功能）

- **修改关键配置文件前必须先备份**：`ecosystem.config.js`、`next.config.ts`、`package.json` 等部署相关文件改动前，在原文件同目录保存一份 `.bak` 备份，或先在 Git 中确认当前状态干净
- **新功能在单独分支开发**，不要直接在 `main` 分支上修改，避免影响正在运行的生产环境
- **涉及部署、服务器配置、构建流程的改动，必须先问用户确认**，不能擅自修改生产环境的运行方式
- **改完后必须验证 3 个核心功能**：登录、工单列表、数据保存（增删改）。确认无误后再通知用户测试
- **禁止在生产服务器上直接试验不确定的改动**。如需测试，先停服后再操作，测试通过后再恢复服务

## 安全开发规范

### 前端安全
- **禁止直接拼接用户输入到 URL 或 HTML**：防止 XSS 攻击。使用框架的转义机制（如 React 默认转义 JSX 内容），不要手动操作 `innerHTML`
- **敏感操作必须二次确认**：金额修改、批量删除、数据导出等操作必须弹出 `confirm()` 或专用确认弹窗，不能一触即发
- **权限校验双保险**：前端根据角色隐藏按钮/菜单，但后端 API 也必须做权限校验（RLS + 服务端校验），不能依赖前端隐藏

### 数据安全
- **禁止在客户端暴露敏感密钥**：Supabase service_role key、第三方 API 密钥等只能用在服务端（Server Action / API Route）
- **文件上传类型白名单**：只允许图片（jpg/png/webp）和视频（mp4），禁止上传可执行文件
- **SQL 注入防护**：手写 SQL 时使用参数化查询（`$1, $2` 占位符），严禁字符串拼接 SQL

## 性能规范

- **列表页必须分页**：数据量超过 50 条的表格/列表必须实现分页，禁止一次性加载全部数据
- **图片懒加载**：页面中非首屏图片使用 `loading="lazy"`，减少初始加载时间
- **大数据表格虚拟滚动**：数据量超过 200 行的表格考虑使用虚拟滚动，避免 DOM 节点过多导致卡顿
- **避免在 `useEffect` 中频繁触发全量重渲染**：大数据计算使用 `useMemo`，事件回调使用 `useCallback`

## API 与数据交互规范

- **统一服务端响应格式**：Server Action 和 API Route 返回的结构保持一致：
  ```typescript
  { success: boolean; data?: T; error?: string }
  ```
- **错误码约定**：
  - 业务校验失败 → 返回 `{ success: false, error: "具体错误原因" }`，不抛异常
  - 系统异常 → 记录日志后返回用户友好提示，不暴露堆栈信息
- **网络请求超时处理**：Supabase 查询超过 10 秒需加 loading 提示，避免用户以为页面卡死
- **乐观更新谨慎使用**：涉及金额、库存的更新必须等待服务端确认后再更新 UI，不能用乐观更新

## 测试规范

- **工具函数必须有单元测试**：`src/lib/` 和 `src/utils/` 下的纯函数必须编写 Vitest 测试用例
- **核心业务流程覆盖**：客户创建、工单开单、库存出入库等核心业务至少有一条端到端或集成测试路径
- **测试文件命名**：与被测文件同名 + `.test.ts`（如 `formatCurrency.ts` 对应 `formatCurrency.test.ts`）
- **提交前自检**：运行 `npm run test:unit` 确保测试通过，运行 `npm run build` 确保构建无报错

## 部署与运维

### 生产环境
- **服务器**：Windows 11 Pro，通过 PM2 管理 Next.js 进程
- **服务名**：`auto-repair-shop`
- **端口**：3000（本地访问 `http://localhost:3000`）
- **HTTPS 端口**：3443（手机扫码用）
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
