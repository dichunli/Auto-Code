/* ═══ 登录健康检查 — 长期预防：只读诊断，绝不修改任何 session 数据 ═══
 * 从 client.ts 拆出（2026-08 认证层重构，纯搬家零行为变化）
 *
 * 目的：把历史上反复踩的「session 损坏」坑变成「一眼能看出」的诊断。
 * 它只读取存储、检查关键字段是否齐全/一致/过期，返回结构化结果，
 * 不 setSession、不 removeItem、不跳转、不弹窗。发现问题由调用方决定
 * 怎么提示（当前仅在控制台打日志）。 */
import { 从SSRCookie解析Session } from "./sessionCookie";
import { 认证存储Key, APP认证存储Key } from "./sessionStorage";
import { 获取当前环境 } from "./clientCore";

/* 健康检查结果：健康为 true 时 问题 数组为空 */
export interface 登录健康结果 {
  健康: boolean;
  /* 发现的问题描述（中文），健康时为空数组 */
  问题: string[];
  详情: {
    环境: "APP" | "浏览器" | "服务端";
    /* 存储中是否存在 session（localStorage 或 cookie 任一） */
    有Session: boolean;
    /* access_token 是否存在且非空 */
    有AccessToken: boolean;
    /* refresh_token 是否存在且非空 */
    有RefreshToken: boolean;
    /* token 是否已过期（无 expires_at 时为 null，无法判断） */
    已过期: boolean | null;
    /* 浏览器环境下 localStorage 与 cookie 是否一致（其他环境为 null） */
    存储一致: boolean | null;
  };
}

/* 安全解析 session 字符串，失败返回 null */
function 解析Session(原始值: string | null): {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
} | null {
  if (!原始值) return null;
  try {
    const parsed = JSON.parse(原始值);
    if (parsed && typeof parsed === "object") return parsed;
    return null;
  } catch {
    return null;
  }
}

/*
 * 纯诊断函数：给定「localStorage 原始值」和「cookie 原始值」，算出健康结果。
 * 抽成纯函数是为了好测试——不依赖真实浏览器存储，输入确定则输出确定。
 */
export function 诊断登录健康(
  环境: "APP" | "浏览器" | "服务端",
  localStorage原始值: string | null,
  cookie原始值: string | null
): 登录健康结果 {
  const 问题: string[] = [];

  const local会话 = 解析Session(localStorage原始值);
  const cookie会话 = 解析Session(cookie原始值);
  /* 浏览器环境以 localStorage 为主仓库，APP 环境只看 localStorage */
  const 主会话 = local会话 || cookie会话;

  const 有Session = !!(localStorage原始值 || cookie原始值);
  const 有AccessToken = !!(主会话?.access_token && 主会话.access_token.length > 0);
  const 有RefreshToken = !!(主会话?.refresh_token && 主会话.refresh_token.length > 0);

  /* 判断过期：当前时间（秒）是否已超过 expires_at */
  let 已过期: boolean | null = null;
  if (主会话?.expires_at && typeof 主会话.expires_at === "number") {
    已过期 = Date.now() / 1000 >= 主会话.expires_at;
  }

  /* 浏览器环境才检查两边一致性；APP / 服务端不涉及 cookie 主仓库，置 null */
  let 存储一致: boolean | null = null;
  if (环境 === "浏览器") {
    const local有效 = !!(local会话?.access_token && local会话?.refresh_token);
    const cookie有效 = !!(cookie会话?.access_token && cookie会话?.refresh_token);
    if (local有效 && cookie有效) {
      /* 两边都有：比对 access_token 是否一致（refresh_token 不一定同步刷新，不强求） */
      存储一致 = local会话!.access_token === cookie会话!.access_token;
    } else if (local有效 !== cookie有效) {
      /* 一边有一边没有，视为不一致（服务端可能读不到 session） */
      存储一致 = false;
    } else {
      /* 两边都没有效 session，无所谓一致不一致 */
      存储一致 = null;
    }
  }

  /* 只有「存在 session」时才报字段缺失——没登录不算问题 */
  if (有Session) {
    if (!有AccessToken) {
      问题.push("session 缺少 access_token，登录态无效");
    }
    if (!有RefreshToken) {
      问题.push("session 缺少 refresh_token，token 过期后将无法自动刷新（典型为 cookie 被截断）");
    }
    if (已过期 === true) {
      问题.push("access_token 已过期，若刷新失败查询会被当作未登录返回空数据");
    }
    if (存储一致 === false) {
      问题.push("localStorage 与 cookie 中的登录态不一致，服务端可能读不到 session 导致数据为空");
    }
  }

  return {
    健康: 问题.length === 0,
    问题,
    详情: { 环境, 有Session, 有AccessToken, 有RefreshToken, 已过期, 存储一致 },
  };
}

/*
 * 从当前浏览器/APP 的真实存储中读取数据并诊断。
 * 服务端无存储可读，直接返回「健康」（服务端 session 由 cookie + middleware 管，不在此检查）。
 */
export function 检查登录健康状况(): 登录健康结果 {
  const 环境 = 获取当前环境();
  if (环境 === "服务端") {
    return {
      健康: true,
      问题: [],
      详情: { 环境, 有Session: false, 有AccessToken: false, 有RefreshToken: false, 已过期: null, 存储一致: null },
    };
  }

  if (环境 === "APP") {
    const local原始 = window.localStorage.getItem(APP认证存储Key);
    return 诊断登录健康("APP", local原始, null);
  }

  /* 浏览器环境：分别读 localStorage 和 cookie，比对一致性 */
  const local原始 = window.localStorage.getItem(认证存储Key);
  const cookie原始 = 从SSRCookie解析Session(认证存储Key);
  return 诊断登录健康("浏览器", local原始, cookie原始);
}

/*
 * 在控制台输出健康检查结果（只在发现问题时打印警告，健康则安静）。
 * 给 AppShell 等入口调用——静默后台诊断，不打扰用户，方便排查时看原因。
 */
export function 记录登录健康检查(): 登录健康结果 {
  const 结果 = 检查登录健康状况();
  if (!结果.健康) {
    /*
     * 对于「存储不一致」的情况，Supabase 客户端刷新 token 后会自动更新 localStorage，
     * 但 cookie 可能滞后一个周期，这是正常的、不会导致功能问题。
     * 如果页面能正常加载数据，忽略此警告即可。
     * 只在有真正的严重问题时才打 warn 日志。
     */
    const 严重问题 = 结果.问题.filter((p) =>
      !p.includes("localStorage 与 cookie 中的登录态不一致")
    );

    if (严重问题.length > 0) {
      console.warn(
        "[登录健康检查] ⚠️ 发现登录态异常：\n  - " + 严重问题.join("\n  - "),
        "\n详情:",
        结果.详情
      );
    }
  }
  return 结果;
}
