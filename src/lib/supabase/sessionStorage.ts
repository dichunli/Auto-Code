/* ═══ session 存储层：存储 key 常量 + 浏览器/APP 双存储 ═══
 * 从 client.ts 拆出（2026-08 认证层重构，纯搬家零行为变化） */
import { 写入Session到Cookie, 清除Session的Cookie, 从SSRCookie解析Session } from "./sessionCookie";

/* 从 Supabase URL 中提取项目引用 ID（用于构造 storage key） */
function 获取项目引用(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

const 项目引用 = 获取项目引用();
export const 认证存储Key = `sb-${项目引用}-auth-token`;
export const APP认证存储Key = `sb-${项目引用}-auth-token-app`;

/*
 * 浏览器环境统一存储：localStorage 为主，同时同步 cookie 给 middleware 读取
 * 解决 @supabase/ssr 的 createBrowserClient 在 Next.js App Router 客户端路由中的 session 丢失问题
 */
export const 浏览器存储 = {
  getItem: (key: string): string | null => {
    if (typeof window === "undefined") return null;
    /*
     * 优先从 localStorage 读取（无大小限制，不会被截断）。
     * 之前优先从 cookie 读取，但 cookie 有 4KB 限制，大 session 会被浏览器
     * 静默截断，导致 GoTrueClient 解析失败并调用 removeItem 清除 session
     *（连带 localStorage 中的完整 session 也被清除了）。
     */
    const localValue = window.localStorage.getItem(key);
    if (localValue) return localValue;
    /*
     * 回退到 cookie（兼容仅从 cookie 登录的旧 session，包括 @supabase/ssr 格式）。
     * 如果读到了有效数据，同步到 localStorage 以便后续优先读取。
     */
    if (key === 认证存储Key) {
      const ssrValue = 从SSRCookie解析Session(key);
      if (ssrValue) {
        window.localStorage.setItem(key, ssrValue);
        return ssrValue;
      }
    }
    return null;
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
    /* 同时写入 cookie（base64-+分段，与服务端 @supabase/ssr 读取格式一致），让服务端能读取 session */
    if (key === 认证存储Key) {
      写入Session到Cookie(key, value);
    }
  },
  removeItem: (key: string): void => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    if (key === 认证存储Key) {
      清除Session的Cookie(key);
    }
  },
};

/* APP 环境存储：只使用 localStorage（APP 专属 key），cookie 仅同步给服务端 */
export const APP存储 = {
  getItem: (key: string): string | null => {
    if (typeof window === "undefined") return null;
    if (key === APP认证存储Key) {
      return window.localStorage.getItem(APP认证存储Key);
    }
    return null;
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === "undefined") return;
    if (key === APP认证存储Key) {
      window.localStorage.setItem(APP认证存储Key, value);
      /* 同时写入 cookie（base64-+分段，与服务端 @supabase/ssr 读取格式一致），让服务端能读取 session */
      写入Session到Cookie(认证存储Key, value);
    }
  },
  removeItem: (key: string): void => {
    if (typeof window === "undefined") return;
    if (key === APP认证存储Key) {
      window.localStorage.removeItem(APP认证存储Key);
    }
  },
};
