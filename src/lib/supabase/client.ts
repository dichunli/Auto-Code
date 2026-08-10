/*
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  改动前必读 — 认证客户端是全局核心文件，动这里等于动所有用户的登录状态  ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  改这个文件之前，必须回答三个问题：                                    ║
 * ║  1. 这个改动只解决什么问题？不要"顺手"改看起来更好的东西              ║
 * ║  2. 已有用户的 session 存在哪（localStorage / cookie）？              ║
 * ║     新逻辑还能读到旧数据吗？读不到怎么办？                           ║
 * ║  3. 改完必须测：已登录用户刷新页面，数据还显示吗？                    ║
 * ║                                                                     ║
 * ║  历史教训：2026-06-09 把 createSupabaseClient 换成 createBrowserClient ║
 * ║  时移除了自定义 storage，导致已登录用户 session 无法读取，全站数据   ║
 * ║  加载为空。修复：createBrowserClient 配回兼容存储（先读cookie回退    ║
 * ║  localStorage）。                                                    ║
 * ║  2026-06-11 统一写 cookie 格式：改用 @supabase/ssr 官方 createChunks ║
 * ║  + base64- 编码分段写入，与服务端读取格式一致，根治单条 cookie 超 4KB ║
 * ║  被浏览器静默截断导致服务端读不到 session 的偶发问题。localStorage   ║
 * ║  仍为主仓库（读取优先），老用户不掉线。                              ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  2026-08-10 重构：本文件已改为「门面」——实现拆到同目录模块，         ║
 * ║  这里只做重导出，保持所有 import 路径不变：                          ║
 * ║    clientCore.ts       createClient 三环境入口 + 环境检测            ║
 * ║    sessionCookie.ts    cookie 读写/分段/解析                         ║
 * ║    sessionStorage.ts   存储 key 常量 + 浏览器/APP 双存储层           ║
 * ║    clientWriteMarker.ts 写操作打标记（实时同步区分自己/他人）        ║
 * ║    sessionInjection.ts 会话注入（确保会话就绪/确保有session/取令牌） ║
 * ║    loginHealth.ts      登录健康检查三件套                            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export { createClient, 获取当前环境 } from "./clientCore";
export { 从SSRCookie解析Session, 写入Session到Cookie, 清除Session的Cookie, COOKIE最大段大小 } from "./sessionCookie";
export { 认证存储Key, APP认证存储Key, 浏览器存储, APP存储 } from "./sessionStorage";
export { 包装写操作标记 } from "./clientWriteMarker";
export { 确保会话就绪, 确保有session, 获取访问令牌 } from "./sessionInjection";
export { 诊断登录健康, 检查登录健康状况, 记录登录健康检查, type 登录健康结果 } from "./loginHealth";
