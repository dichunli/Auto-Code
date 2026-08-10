/* ═══ session cookie 读写（与 @supabase/ssr 服务端格式完全一致） ═══
 * 从 client.ts 拆出（2026-08 认证层重构，纯搬家零行为变化） */
import { stringFromBase64URL, stringToBase64URL, createChunks } from "@supabase/ssr";

/*
 * cookie 单段最大字节数：与 @supabase/ssr 的 createChunks 默认值（MAX_CHUNK_SIZE=3180）保持一致。
 * 浏览器单条 cookie 上限约 4KB，3180 留足了 cookie 名、编码膨胀和分隔符的余量。
 */
export const COOKIE最大段大小 = 3180;

/* base64url 解码（兼容 @supabase/ssr 的 cookie 编码，支持 UTF-8） */
function base64url解码(str: string): string {
  return stringFromBase64URL(str);
}

/*
 * 写入 session cookie（与 @supabase/ssr 服务端读取格式完全一致）：
 * 1. 用 base64- 前缀 + base64url 编码（服务端 createServerClient 认这种格式）
 * 2. 超过单段上限时，用官方 createChunks 切成 key.0、key.1… 多段写入
 *    —— 解决「单条 cookie 超 4KB 被浏览器静默截断 → 服务端读不到 session」的隐患
 * 写入前先清掉旧的分段，避免上次 3 段、这次 2 段时残留第 3 段导致解析错乱。
 */
export function 写入Session到Cookie(key: string, value: string): void {
  清除Session的Cookie(key);
  const 编码值 = "base64-" + stringToBase64URL(value);
  const maxAge = 400 * 24 * 60 * 60;
  const chunks = createChunks(key, 编码值, COOKIE最大段大小);
  for (const chunk of chunks) {
    document.cookie = `${chunk.name}=${encodeURIComponent(chunk.value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  }
}

/*
 * 清除 session cookie：单条 + 所有分段（key、key.0、key.1…）一并删除，
 * 防止退出登录或重新登录后残留旧 cookie 段。
 */
export function 清除Session的Cookie(key: string): void {
  document.cookie = `${key}=; path=/; max-age=0`;
  for (let i = 0; i < 10; i++) {
    document.cookie = `${key}.${i}=; path=/; max-age=0`;
  }
}

/* 解析 @supabase/ssr 格式的 cookie 值（支持 base64- 前缀和分段 cookie） */
export function 从SSRCookie解析Session(key: string): string | null {
  /* 1. 尝试读取单个 cookie */
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
  );
  const cookieValue = match ? decodeURIComponent(match[1]) : null;

  if (cookieValue) {
    /* 1a. 直接是 JSON（当前自定义格式） */
    try {
      const parsed = JSON.parse(cookieValue);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.access_token === "string" &&
        typeof parsed.refresh_token === "string" &&
        parsed.access_token.length > 0 &&
        parsed.refresh_token.length > 0
      ) {
        return cookieValue;
      }
    } catch {
      /* 不是纯 JSON，继续尝试 */
    }

    /* 1b. @supabase/ssr 的 base64url 格式 */
    if (cookieValue.startsWith("base64-")) {
      try {
        const decoded = base64url解码(cookieValue.substring("base64-".length));
        const parsed = JSON.parse(decoded);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.access_token === "string" &&
          typeof parsed.refresh_token === "string" &&
          parsed.access_token.length > 0 &&
          parsed.refresh_token.length > 0
        ) {
          return decoded;
        }
      } catch {
        /* 解码失败 */
      }
    }
  }

  /* 2. 尝试读取分段 cookie（sb-key.0, sb-key.1, ...） */
  const chunks: string[] = [];
  for (let i = 0; ; i++) {
    const chunkName = i === 0 ? key : `${key}.${i}`;
    const chunkMatch = document.cookie.match(
      new RegExp(`(?:^|; )${chunkName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
    );
    if (!chunkMatch) break;
    chunks.push(decodeURIComponent(chunkMatch[1]));
  }

  if (chunks.length > 0) {
    try {
      const combined = chunks.join("");
      let decoded: string;
      if (combined.startsWith("base64-")) {
        decoded = base64url解码(combined.substring("base64-".length));
      } else {
        decoded = combined;
      }
      const parsed = JSON.parse(decoded);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.access_token === "string" &&
        typeof parsed.refresh_token === "string" &&
        parsed.access_token.length > 0 &&
        parsed.refresh_token.length > 0
      ) {
        return decoded;
      }
    } catch {
      /* 分段解析失败 */
    }
  }

  return null;
}
