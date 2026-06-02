# 代码书写规范

## 基本规则

- **全部代码和注释使用中文**，包括变量名、函数名、组件名（尽量使用中文语义）
- 组件文件名使用 PascalCase（如 `PartForm.tsx`）
- 普通工具文件名使用 camelCase（如 `formatCurrency.ts`）
- 页面路由文件夹使用 kebab-case（如 `parts/new/page.tsx`）

## 组件规范

- 客户端组件（含交互、useState、useEffect 等）文件**顶部必须加 `"use client"`**
- Server Action 文件**顶部必须加 `"use server"`**
- 页面组件默认使用 Server Component，仅将需要交互的部分提取为 Client Component
- 组件 props 优先使用具体 TypeScript 类型，**严禁使用 `any`**
- **禁止在组件函数内部定义子组件**（会导致每次渲染重新创建组件，违反 React 规则）。子组件必须定义在父组件外部、同一文件内
- **禁止条件调用 Hook**：所有 `useState`/`useEffect`/`useCallback`/`useMemo` 等 Hook 必须在组件函数顶部调用，不能放在 `if` 条件分支或提前 `return` 之后

## 样式规范

- **全部使用 Tailwind CSS 工具类**，不手写 `.css` 文件
- 颜色统一使用 Tailwind 预设色阶（如 `bg-blue-600`、`text-gray-500`）
- 间距优先使用 4 的倍数（如 `p-4`、`gap-2`）

## 状态与表单规范

- 表单中的价格、数量等数字字段，前端用**字符串**存储，提交时转换为 number
- 搜索功能统一使用 **300ms 防抖**（`setTimeout` + `clearTimeout` 模式）
- 弹窗/模态框使用固定定位（`fixed inset-0`）+ 半透明遮罩（`bg-black/50`）

## ESLint 红线规则（必须保持为 error，严禁降级）

以下规则已配置在 `eslint.config.mjs` 中，**禁止降级为 warn 或关闭**：
- `@typescript-eslint/no-explicit-any` — 禁止使用 `any` 类型
- `react-hooks/rules-of-hooks` — Hook 必须在组件顶部无条件调用
- `react-hooks/static-components` — 禁止在渲染时创建组件

## 交互与错误处理

- 用户操作失败（如保存、删除）使用 `alert()` 提示错误信息
- 删除操作前必须弹出 `confirm()` 确认
- 加载状态使用 `disabled:opacity-50` 和按钮文字变化（如"保存中..."）提示

## 表单校验规则

- 车牌号：必填，`trim()` + `toUpperCase()`
- VIN 码：可选填，`trim()` + `toUpperCase()`，非空时校验全局唯一性
- 客户手机号：必填，`trim()`，校验全局唯一性
