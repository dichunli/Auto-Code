# 踩坑记录 — 换电脑后必读

本文档记录项目开发过程中踩过的坑，防止换电脑后记忆丢失导致重复犯错。

---

## 2026-06-10：架构改造部署连环坑

### 背景
把工单列表从客户端查询改为 Server Component 服务端查询，知识库改为 Server Action 查询。部署过程中连续踩了 4 个坑。

### 坑⑥：deploy.bat 不删除 .next 目录导致 chunk 不匹配
**现象**：部署后页面显示"出错了"，控制台报 `500 Internal Server Error`，JS chunk 加载失败。  
**原因**：`deploy.bat` 原来的流程是"停服→构建→启动"，但**没有删除旧的 `.next` 目录**。Next.js 增量构建会保留旧文件，但 chunk 文件名每次构建都不同。旧 HTML 引用了旧 chunk 文件名，新构建中这些旧 chunk 不存在，服务器返回 500。  
**修复**：`deploy.bat` 在 `npm run build` 之前增加 `rmdir /s /q .next`，彻底删除旧构建目录。  
**教训**：每次部署前必须删除 `.next` 目录，防止旧文件残留导致 chunk 不匹配。

### 坑⑦：PM2 多实例冲突（npx pm2 vs 全局 pm2）
**现象**：反复停服、构建、启动，但页面仍然加载旧的 chunk。  
**原因**：`deploy.bat` 使用 `npx pm2` 启动，但手动执行的命令用全局 `pm2`。两者是不同的 PM2 实例，管理不同的进程。停了一个，另一个还在运行。  
**修复**：统一使用 `npx pm2`，`deploy.bat` 中已统一。  
**教训**：项目中只用一种方式启动 PM2（`npx pm2` 或全局 `pm2`），不要混用。

### 坑⑧：Server Component 中不能使用 onChange 事件处理函数
**现象**：工单列表页面报错"An error occurred in the Server Components render"。  
**原因**：在 `work-orders/page.tsx`（Server Component）中，给 `<select>` 元素加了 `onChange` 事件处理函数。Next.js 的 Server Component 不支持 React 事件处理系统（所有事件处理必须在 Client Component 中）。  
**修复**：把 `onChange` 改成 `<Link>` 跳转，或者把交互部分提取为 Client Component。  
**教训**：Server Component 中**不能**使用 `onChange`、`onClick`、`onSubmit` 等事件处理函数。有交互就拆成 Client Component。

### 坑⑨：Supabase `.not("status", "in", [...])` 语法不支持
**现象**：工单列表查询报错 `"failed to parse filter (not.in.settled,delivered)"`。  
**原因**：Supabase JS 客户端的 `.not()` 方法不支持 `in` 操作符。`.not("status", "in", ["settled", "delivered"])` 在 SQL 解析时失败。  
**修复**：改用多次 `.not("status", "eq", "xxx")`，如：`.not("status", "eq", "settled").not("status", "eq", "delivered")`。  
**教训**：Supabase `.not()` 只支持 `eq`、`gt`、`lt` 等简单操作符，**不支持 `in`**。需要排除多个值时，用多个 `.not("eq", ...)` 链式调用。

---

## 2026-06-09：客户端认证存储大翻车

### 背景
把浏览器环境的 `createSupabaseClient` 换成 `createBrowserClient`（@supabase/ssr），想"用更标准的库"。结果引发连锁故障。

### 踩的 3 个坑

#### 坑①：createBrowserClient 不读 localStorage 旧 session
**现象**：已登录用户刷新页面后，所有数据加载为空（接车0单、车型库空白、知识库空白）。  
**原因**：`createBrowserClient` 默认只从 cookie 读 session，之前用户的 session 存在 localStorage 里。  
**修复**：给 `createBrowserClient` 配回自定义 storage（`getItem` 先读 cookie，回退 localStorage）。  
**最终方案**：浏览器环境恢复 `createSupabaseClient` + 自定义 storage，`createBrowserClient` 在这个项目里不适用。

#### 坑②：createBrowserClient 的 cookie 格式跟服务端对不上
**现象**：手机工作台 `/m` 只显示"个人信息"，其他功能入口全部消失。  
**原因**：`/m` 是 Server Component，服务端 `createServerClient` 从 cookie 读 session 做权限过滤。`createBrowserClient` 写的 cookie 格式跟 `createServerClient` 读取的格式不兼容，服务端认为用户没登录。  
**修复**：浏览器环境彻底恢复 `createSupabaseClient` + 自定义 storage（localStorage + cookie 同步）。

#### 坑③：formatDate 没指定时区导致 React hydration 错误
**现象**：Console 报红错 `Minified React error #418`。  
**原因**：`formatDate` 用了 `toLocaleDateString("zh-CN")` 但没指定 `timeZone`。服务端 Node.js 按 UTC 格式化，浏览器按东八区格式化，同一时间点两边输出差 8 小时。React hydrate 时发现文本对不上。  
**修复**：`formatDate` 加上 `timeZone: "Asia/Shanghai"`。

#### 坑④：APP 环境取消单例缓存是多此一举
**现象**：Console 满屏黄色警告 `Multiple GoTrueClient instances detected`。  
**原因**：APP 环境去掉单例缓存后，每次调用 `createClient()` 都创建新实例。  
**修复**：恢复 APP 环境单例缓存。Supabase 客户端有 `onAuthStateChange` 自动更新 session，单例完全够用。

#### 坑⑤：改回 createSupabaseClient 时漏改了 getItem，cookie 截断导致 refresh token 丢失
**现象**：登录后左侧菜单显示工单数量（17个），但列表显示"暂无工单数据"；Console 报 `Invalid Refresh Token: Refresh Token Not Found` (400)。  
**原因**：坑①的修复把 `getItem` 改成了"**优先读 cookie**"（为了兼容 `createBrowserClient`）。约 27 分钟后又把 `createBrowserClient` 改回了 `createSupabaseClient`，但 **`getItem` 的"优先 cookie"逻辑忘改回去了**。`createSupabaseClient` 把完整 session（含 user 对象）写入 storage，`setItem` 同时同步到 cookie。cookie 有 **4KB 限制**，大 session 被**截断**后缺少 `refresh_token`。`getItem` 优先读 cookie，读到截断数据 → Supabase 自动刷新 token 时发送空 refresh_token → 400 错误；同时截断的 session 过不了 RLS → 客户端查询被静默过滤 → 列表为空。  
**修复**：`getItem` 读取 cookie 时增加**数据完整性校验**（验证 JSON 能解析且包含 `access_token` 和 `refresh_token`），不完整则回退到 localStorage（无大小限制）。

---

## 为什么登录/列表问题反复出现？根因分析

### 表面现象 vs 深层原因

表面看是"改了一个地方、坏了一片"。但深层原因是：**认证架构在开发过程中被反复重构，每一次重构都没有经过充分验证就合并，没有测试保护，没有回滚准备。**

### 时间线还原（问题是怎么一步步累积的）

| 阶段 | 做了什么 | 引入了什么问题 |
|------|---------|--------------|
| 初期 | 用 `@supabase/supabase-js` + localStorage，简单直接 | 服务端（middleware）读不到 session |
| 中期 | 为了适配 APP（WebView cookie 不工作），加了环境判断 + 自定义 storage + cookie 同步 | 代码复杂度翻倍，storage 读写逻辑不再简单 |
| 后期 | 想"标准化"，切换到 `@supabase/ssr` 的 `createBrowserClient` | `createBrowserClient` 不读 localStorage 旧 session，格式也不兼容服务端 |
| 修复期 | 修 A 症状时顺手改 B，修 B 时又顺手改 C | 每次改动的范围不清晰，"半新半旧"状态不断叠加 |

**关键转折点**：从"简单直接"变成了"复杂定制"，又没有用测试把行为固定下来。后面每一次改动都像在摇骰子——不知道会坏什么。

### 编程行业的共识（为什么这事不该发生）

| 行业经验 | 本项目的问题 |
|---------|------------|
| **"认证是地基，一旦浇筑就不该再动"** | 认证代码在 1 天内改了 5 次，相当于地基打了又拆、拆了又打 |
| **"不要自己写认证逻辑，用标准方案"** | 写了自定义 storage（getItem/setItem/removeItem），且没有单元测试覆盖 |
| **"核心流程必须有自动化测试保护"** | 登录 → 刷新 → 数据加载，全靠人眼测，漏掉是必然的 |
| **"任何架构改动必须有回滚方案"** | 直接在 main 分支改，出问题没有快速回滚路径 |
| **"先验证再合并"** | 新方案（`createBrowserClient`）没有经过充分验证就合入，发现问题后才回滚 |

### 为什么登录问题不是初始阶段就做好的？

**因为需求是渐进暴露的。**

- 第一阶段：只有浏览器访问 → localStorage 够用
- 第二阶段：加了 APP（Capacitor WebView）→ cookie 不工作，必须自定义 storage
- 第三阶段：加了手机工作台（Server Component）→ 服务端需要读到 session，必须 cookie 同步
- 第四阶段：想"统一用标准库"→ 切换到 `createBrowserClient`，发现和现有架构不兼容

**每次新需求出现时，没有在架构层面做完整设计，而是"补丁式修复"。** 补丁叠补丁，最后成了一团乱麻。

### 彻底杜绝的方案（不只是规范，是架构改变）

#### 方案一：认证代码彻底冻结（短期，今天就能做）

**当前方案已经能工作，禁止再优化。**

- `createSupabaseClient`（`@supabase/supabase-js`）+ 自定义 storage
- localStorage 存完整 session，cookie 同步精简标记
- 这个方案有坑（cookie 4KB 限制），但已经修好了（getItem 完整性校验）
- **从今天起，除非出现安全漏洞，否则任何人（包括 AI）不得再改认证相关文件**

#### 方案二：用自动化测试把行为固定下来（本周必须做）

**人眼会漏，测试不会。**

必须补充的测试覆盖：

```
测试文件：src/lib/supabase/client.test.ts
├── 浏览器环境
│   ├── getItem 从 localStorage 读取完整 session
│   ├── getItem cookie 被截断时回退到 localStorage
│   ├── setItem 同时写入 localStorage 和 cookie
│   └── removeItem 同时清除 localStorage 和 cookie
├── APP 环境
│   ├── 单例缓存只创建一次
│   └── 不使用 cookie
└── session 数据格式校验
    ├── 有效 session（含 access_token + refresh_token）
    └── 截断 session（缺少 refresh_token）→ 回退 localStorage
```

```
测试文件：src/app/login/page.test.tsx（或 E2E 测试）
├── 登录成功 → session 写入 localStorage
├── 登录成功 → cookie 同步成功
├── 刷新页面 → 不跳回登录页
├── 关闭浏览器再打开 → 不跳回登录页
└── 各页面数据加载
    ├── 工单列表有数据
    ├── 车型库有数据
    └── 知识库有数据
```

#### 方案三：客户端不再直接查数据库，统一走 Server Actions（中期，1-2 周）

**当前架构的问题**：客户端组件（如 `WorkOrdersContent.tsx`）直接调用 `supabase.from(...)` 查数据库。这意味着：
- 认证状态必须在客户端完全正确，否则 RLS 拒绝
- 客户端需要处理 session、refresh token、RLS 等所有复杂度

**更好的架构**：

```
现在：  客户端组件 → createClient() → Supabase → 数据库
        （session 问题 = 数据加载失败）

改为：  客户端组件 → Server Action → 服务端 auth 校验 → Supabase → 数据库
        （session 只在服务端处理，客户端不管认证）
```

具体做法：
1. 每个页面的数据查询封装成 Server Action（`"use server"`）
2. Server Action 中用 `createServerClient` 读取 session，做权限校验
3. 客户端组件只调用 Server Action，不直接操作数据库
4. 这样客户端完全不需要关心 session、refresh token、storage 等问题

**好处**：
- 认证逻辑集中在服务端，客户端代码大幅简化
- 服务端 session 管理更可靠（`@supabase/ssr` 的多 cookie 机制）
- 出问题更容易排查（服务端统一日志）

#### 方案四：数据加载失败必须显式提示，不能静默空白（今天就能做）

**当前问题**：RLS 过滤数据时，Supabase 返回空数组，error 为 null。页面显示"暂无数据"，用户不知道是**真的没有数据**还是**加载失败了**。

**修复**：在客户端查询中加入 session 有效性检查：

```typescript
// 查询前先检查 session
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  setQueryError("登录状态已过期，请重新登录");
  return;
}
```

或者更直接：查询后如果数据为空，但同页面的服务端统计显示有数据，就提示"数据加载异常，请刷新页面"。

### 结论

**登录问题反复出现的根本原因**：认证架构从简单变复杂的过程中，没有用测试把行为固定下来，也没有在某一个节点说"到此为止，不再改了"。

**彻底杜绝的唯一方法**：
1. **冻结认证代码**（今天）
2. **补测试**（本周）
3. **架构上把认证收回到服务端**（1-2 周）
4. **数据加载失败显式提示**（今天）

否则即使这次修好了，下次有人（或 AI）"顺手优化"一下，还会再炸。

---

## 认证/Session 改动铁律（以后必须严格执行）

### 为什么单独列出来？
2026-06-09 这一天之内，认证/session 代码被改了 **5 次**，每次修一个症状、引入一个新 bug，工单列表、车型库、知识库、手机工作台全部轮流坏了一遍。这是**系统性问题**，不是某个具体 bug 的问题。

### 铁律一：认证代码冻结原则
**当前方案已验证可用，禁止再改，除非有明确的业务需求倒逼。**

- ✅ 当前稳定方案：`createSupabaseClient`（`@supabase/supabase-js`）+ 自定义 storage（localStorage 为主 + cookie 同步）
- ❌ 禁止再尝试切换：`createBrowserClient`、`@supabase/ssr` 的浏览器端、纯 cookie 方案、纯 localStorage 方案
- ❌ 禁止"顺手优化"认证相关代码：storage 读写逻辑、单例缓存、`autoRefreshToken` 开关、`flowType`、key 命名规则

**如果忍不住想改，先回答：业务上出了什么问题，非改认证不可吗？**

### 铁律二：改动前强制清单（必须逐项勾选）
改 `client.ts`、`server.ts`、`middleware.ts`、`login/page.tsx` 之前，必须：

| # | 检查项 | 为什么 |
|---|--------|--------|
| 1 | 在原文件同目录保存 `.bak` 备份 | 出问题 30 秒内能回滚 |
| 2 | 在独立分支开发（`fix/auth-xxx`） | 不能污染 main，可随时丢弃 |
| 3 | 写影响范围文档（哪怕三句话） | 强制思考"谁会受影响" |
| 4 | 已有用户的 session 存在哪？新逻辑能读到吗？ | 坑①②⑤全是这个 |
| 5 | storage 的 getItem/setItem/removeItem 三个方法是否配对修改？ | 坑⑤就是只改了方案、漏改 getItem |
| 6 | cookie 中存的数据是否会超过 4KB？ | session 含 user 对象时极易超限 |
| 7 | 服务端 `createServerClient` 和客户端 `createClient` 的 session 是否还能互通？ | 坑②就是两边格式对不上 |

### 铁律三：改动后必测清单（不能只测当前症状）
改完认证相关代码，**必须**验证以下全部场景，缺一不可：

| # | 测试场景 | 通过标准 |
|---|----------|----------|
| 1 | 新用户登录 → 进入首页 | 不报错、有数据 |
| 2 | 已登录用户**刷新页面**（F5） | 不跳回登录页、数据正常显示 |
| 3 | 已登录用户**关闭浏览器再打开** | 不跳回登录页、数据正常显示 |
| 4 | 工单列表页 | 工单数量 > 0 时列表正常显示 |
| 5 | 车型库页 | 车型数据正常加载 |
| 6 | 知识库页 | 知识库数据正常加载 |
| 7 | 手机工作台 `/m` | 所有功能入口可见、能点击 |
| 8 | APP 扫码登录 | 登录成功、数据正常 |
| 9 | 控制台无红错 | 无 400/401/403 认证错误 |
| 10 | `npm run build` 通过 | 构建无红色报错 |

**少测一个场景，等于没测。** 坑②就是没测手机工作台，坑⑤就是没测"刷新页面后数据是否还在"。

### 铁律四：回滚权优先于修复权
如果改完后发现有问题：
1. **第一选择是回滚**（用 `.bak` 文件或 `git revert`），不是继续修
2. 回滚到上一个**确定可用**的版本
3. 在独立分支上重新分析问题，而不是在 main 上"现场调试"

### 铁律五：引入自动化测试兜底
认证/session 这种核心逻辑，必须靠测试保护，不能靠人眼。

**必须补充的测试**：
- `client.ts`：session 存储/读取/删除的单元测试（验证 storage 各方法配对工作）
- `login/page.tsx`：登录流程的集成测试（模拟登录 → 验证 session 写入 → 验证页面跳转）
- 核心页面数据加载：工单列表、车型库、知识库的端到端测试（登录后访问页面 → 验证数据非空）

---

### 核心教训
- **`createBrowserClient` 在这个项目里不适用**。`createSupabaseClient` + 自定义 storage（localStorage + cookie 同步）是验证过的稳定方案。
- **改认证/session/存储机制前，必须回答三个问题**：已有数据在哪？新逻辑能读到吗？读不到怎么办？
- **涉及时区的函数必须显式指定 `timeZone`**，否则服务端和客户端输出不一致。
- **一个提交只做一件事**，禁止"顺手"改看起来更好但其实无关的东西。
- **改回旧方案时，必须把配套逻辑也改回去**。不能只改主逻辑、漏掉辅助逻辑（如 `getItem` 的读取优先级），否则会产生"半新半旧"的混合状态，比纯新方案更难排查。

---

## 2026-06-12：图片/视频上传全面重构 + 视频上传排查

### 背景
全面重构系统中的图片和视频上传功能（统一压缩参数、统一存储、统一上传 Hook、统一图片查看器等），重构成功后发现在 APP 中视频上传点不动。

### 踩的 3 个坑

#### 坑①：WebView 三种常见方案都打不开文件选择器

**走了 4 个死胡同**：

| 尝试 | 为什么失败 |
|------|-----------|
| `<input type="file" className="hidden">` + JS `.click()` | WebView 不响应隐藏元素的 `.click()` |
| `<label htmlFor="id">` + 外部 `<input>` | WebView 不弹文件选择器 |
| `<label>` 嵌套 `<input>` + `sr-only` | WebView 不弹文件选择器 |
| `getUserMedia` + `MediaRecorder` 网页录像 | WebView HTTP 环境直接拒绝摄像头 API |

**教训**：Android WebView 有三个死限制，前端怎么试都绕不过——① file input 打不开 ② getUserMedia 被拒 ③ 只有 Capacitor 插件/原生桥接才靠谱。**前端搞不动时，先去看原生代码有没有方案**。

#### 坑②：反复改前端没反应，因为 APK 里根本没录像功能

**关键线索**：用户说"VIN 拍照正常"。VIN 拍照和视频录像用的是同一套**原生桥接机制**（Java JSInterface），这说明机制本身是好的。

**根因**：视频录像桥接（`AndroidVideoCapture`）是后加进 MainActivity.java 的。用户装的 APK 没有这个桥接，前端再怎么改代码、重新部署服务器都没用。**原生桥接 ≠ 网页代码，网页改完部署服务器即可，原生桥接必须重新打包 APK。**

**教训**：
- **APP 里拍照/录像没反应 → 先问"VIN 拍照能用吗"**：能 = 机制 OK 但桥接缺，不能 = 机制本身坏了
- **凡涉及新增 Java 桥接，必须提醒用户 `npx cap sync` + 重新打包 APK**
- **电脑浏览器能上传 ≠ APP 能用**：浏览器走 HTML file input，APP 必须走原生桥接

#### 坑③：APP 视频必须用原生系统相机，不能用 MediaRecorder

**MainActivity.java 注释早就写了**：
> Android WebView 的 getUserMedia() 在 HTTP 环境下会被拒绝，所以所有摄像头功能必须使用 Capacitor 原生插件，不能依赖 WebView 的 JavaScript 摄像头 API。

但我之前没看这段注释，自己装了 MediaRecorder 方案试了两次才发现不行。

**教训**：**先读原生代码的注释和文档**。MainActivity.java 里已经写了每个桥接的用法和限制，读一遍能省半天时间。

### 架构教训

**"APP 是远程壳，改代码不用重打包"这个说法不完全对。**

准确的表述是：
- 网页代码（React/页面/逻辑）→ 远程加载，部署服务器即可
- **原生桥接（Java JSInterface）→ 必须打包进 APK**，新增的桥接旧 APK 没有

**判断方法**：改的东西在 `src/` 下 → 部署服务器；改的东西在 `android/` 下 → 重新打包 APK。

---

## 2026-06-11：点菜单进列表页数据为空

### 背景
车型库列表和维修项目列表通过左侧菜单点击进入时数据显示为空，但按 F5 刷新就恢复正常。

### 根因
客户端 `createClient()` 是单例，SPA 软跳转时没有从 localStorage 重新读取 session → `getSession()` 返回空 → 查询不带 token → RLS 当作未登录过滤 → 返回空数据。F5 刷新重建客户端 → 重新读 localStorage → 正常。

### 修复
`src/lib/supabase/client.ts` 中新增 `确保会话就绪()` 函数，AppShell 挂载时调用：若客户端无 session 但 localStorage 里有有效数据，手动 `setSession()` 注入。Promise 缓存全站只跑一次。

### 排查方法

以后遇到"列表页数据为空"，先排查是缓存还是 session：

1. **`Ctrl+F5` 强制刷新** → 好了 = 浏览器缓存旧 JS chunk（尤其是刚部署过后）
2. 刷新后**仍空白** → 检查 `确保会话就绪()` 是否被正确调用（控制台加日志看 setSession 走了没）
3. 如果 APP 里也空白 → 看是不是 APP 环境跳过了注入逻辑（APP 由 onAuthStateChange 自管）
