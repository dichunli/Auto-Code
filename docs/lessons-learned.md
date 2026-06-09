# 踩坑记录 — 换电脑后必读

本文档记录项目开发过程中踩过的坑，防止换电脑后记忆丢失导致重复犯错。

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

### 核心教训
- **`createBrowserClient` 在这个项目里不适用**。`createSupabaseClient` + 自定义 storage（localStorage + cookie 同步）是验证过的稳定方案。
- **改认证/session/存储机制前，必须回答三个问题**：已有数据在哪？新逻辑能读到吗？读不到怎么办？
- **涉及时区的函数必须显式指定 `timeZone`**，否则服务端和客户端输出不一致。
- **一个提交只做一件事**，禁止"顺手"改看起来更好但其实无关的东西。
