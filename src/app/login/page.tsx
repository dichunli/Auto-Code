"use client";

/*
 * ========== 登录页面 - 兼容性设计说明 ==========
 *
 * 【问题背景】某些旧版Android手机的WebView不支持React 19的某些新特性，
 * 导致React无法hydrate（页面显示正常但按钮点击无反应）。
 * 典型现象："当前环境: 检测中..."一直不变，点击登录按钮没反应。
 *
 * 【根本原因】国产低端手机的WebView内核版本过旧（如Android 8-10的默认WebView），
 * 无法解析Next.js 16 + Turbopack + React 19生成的一些现代JS语法。
 *
 * 【解决方案】登录页面采用"双保险"设计：
 * 1. 蓝色"登录"按钮 → React版本，正常设备使用（有完整的错误处理、加载状态）
 * 2. "登录（兼容模式）"按钮 → 原生HTML+JS版本，用dangerouslySetInnerHTML插入真正的
 *    原生DOM元素，完全不依赖React事件系统。旧版WebView也能正常工作。
 *
 * 【关键实现】
 * - 原生按钮必须使用 <div dangerouslySetInnerHTML> 插入，React的JSX不支持原生 onclick
 * - 原生脚本必须使用 <div dangerouslySetInnerHTML> 包裹 <script>，否则Next.js SSR会过滤掉
 * - 登录成功后同时写入 localStorage 和 cookie，让APP的createClient()能正确识别session
 *
 * 【不要删除兼容模式按钮】即使未来升级了React版本，某些用户的旧手机仍然需要它。
 *
 * 【相关记忆】[[old-webview-react-failure]]
 */

import { useState, useEffect } from "react";
import { createClient, 获取当前环境 } from "@/lib/supabase/client";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { logLogin } from "@/lib/operationLog";
import { 账号转邮箱 } from "@/lib/loginCredentials";

export default function LoginPage() {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [环境, set环境] = useState("检测中...");
  /* supabase 客户端延迟到 useEffect 中创建，避免 SSR 阶段环境误判 */
  const [supabase, setSupabase] = useState<ReturnType<typeof createClient> | null>(null);

  useEffect(() => {
    set环境(获取当前环境());
    /* 客户端挂载后再创建 supabase 实例，确保能正确识别 APP/WebView 环境 */
    setSupabase(createClient());
  }, []);

  /* 检测页面是否从浏览器缓存恢复（bfcache） */
  /* 注意：APP 环境下某些国产手机的 WebView 会误触发 persisted，导致输入框被清空 */
  /* 环境判断必须用 是Capacitor环境()（isNativePlatform），禁止 window.Capacitor：
     浏览器 import @capacitor/core 后会生成 Web 垫片，导致浏览器被误判成 APP 而不跳回首页 */
  useEffect(() => {
    function handlePageShow(e: PageTransitionEvent) {
      if (e.persisted) {
        /* 事件触发时双重检查：如果是 APP 环境直接忽略 */
        if (是Capacitor环境()) return;

        /* 浏览器环境：从缓存恢复时，如果已经有 session 则跳走 */
        const hasToken = document.cookie.includes("sb-") || !!window.localStorage.getItem("sb-");
        if (hasToken) {
          window.location.href = "/";
        }
      }
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  /* 注册PWA service worker */
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  async function handleSubmit() {
    /* 防止 supabase 客户端尚未初始化时提交 */
    if (!supabase) {
      try {
        const client = createClient();
        setSupabase(client);
        /* 继续用新创建的客户端登录 */
        await 用客户端登录(client);
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[login] createClient failed:", msg);
        setError("登录服务初始化失败: " + msg);
        setLoading(false);
        return;
      }
    }

    await 用客户端登录(supabase);
  }

  async function 用客户端登录(登录客户端: ReturnType<typeof createClient>) {
    setLoading(true);
    setError("");

    const credentials: { password: string; email: string } = {
      password,
      email: 账号转邮箱(account),
    };

    try {
      const { data, error } = await Promise.race([
        登录客户端.auth.signInWithPassword(credentials),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("登录请求超时，请检查网络连接或刷新页面重试")), 10000)
        ),
      ]);

      if (error) {
        setError(error.message || "登录失败，请检查账号密码");
        setLoading(false);
        return;
      }

      if (!data.session) {
        setError("登录成功但未获取到会话，请检查网络或 Supabase 配置");
        setLoading(false);
        return;
      }

      /* 记录登录日志（不阻塞登录流程） */
      logLogin({
        userId: data.user?.id || "",
        userName: data.user?.email || account,
        description: `用户 ${account} 登录系统`,
      }).catch(() => {});

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      window.location.href = isMobile ? "/m" : "/";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "网络错误或浏览器安全策略阻止了请求";
      setError("登录请求失败: " + message);
      setLoading(false);
    }
  }

  return (
    <>
      {/* ===== 原生登录脚本：兼容旧版WebView（React可能加载失败） ===== */}
      {/* 用 div+dangerouslySetInnerHTML 确保原生 script 被插入到 DOM 中 */}
      <div dangerouslySetInnerHTML={{ __html: `
        <script id="native-login-script">
          (function() {
            /* 如果React加载成功，让React接管；否则原生登录作为fallback */
            window._nativeLoginInit = function() {
              var accountEl = document.getElementById('login-account');
              var passwordEl = document.getElementById('login-password');
              var account = accountEl ? accountEl.value : '';
              var password = passwordEl ? passwordEl.value : '';

              if (!account || !password) {
                alert('请输入账号和密码');
                return;
              }

              var isPhone = /^1[3-9]\\d{9}$/.test(account);
              var email = isPhone ? 'phone-' + account + '@auto.local' : account;

              var SUPABASE_URL = '` + (process.env.NEXT_PUBLIC_SUPABASE_URL || '') + `';
              var SUPABASE_KEY = '` + (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '') + `';

              fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
                method: 'POST',
                headers: {
                  'apikey': SUPABASE_KEY,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email: email, password: password })
              })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.error) {
                  alert('登录失败: ' + (data.error_description || data.error || '未知错误'));
                  return;
                }
                if (data.access_token) {
                  var tokenKey = 'sb-' + SUPABASE_URL.replace('https://', '').split('.')[0] + '-auth-token';
                  localStorage.setItem(tokenKey, JSON.stringify(data));
                  /* 同时写入cookie，让服务端也能识别 */
                  var maxAge = 400 * 24 * 60 * 60;
                  document.cookie = tokenKey + '=' + encodeURIComponent(JSON.stringify(data)) + '; path=/; max-age=' + maxAge + '; SameSite=Lax';
                  alert('✅ 登录成功！正在跳转...');
                  window.location.href = '/m';
                } else {
                  alert('登录响应异常，没有获取到token');
                }
              })
              .catch(function(err) {
                alert('登录请求失败: ' + (err.message || String(err)));
              });
            };
          })();
        </script>
      `}} />

      {/* 兜底样式：防止某些浏览器缓存旧CSS导致页面无样式 */}
      <style dangerouslySetInnerHTML={{ __html: `
        .login-root { min-height:100vh; display:flex; align-items:center; justify-content:center; background:#f9fafb; padding:0 16px; font-family:system-ui,-apple-system,sans-serif; }
        .login-card { width:100%; max-width:400px; background:#fff; border-radius:12px; border:1px solid #e5e7eb; padding:24px; box-shadow:0 1px 3px rgba(0,0,0,0.05); }
        @media (min-width:768px){ .login-card { padding:32px; } }
        .login-logo { display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:24px; }
        @media (min-width:768px){ .login-logo { margin-bottom:32px; } }
        .login-logo-box { width:40px; height:40px; background:#2563eb; border-radius:8px; display:flex; align-items:center; justify:center; flex-shrink:0; }
        .login-logo-text { color:#fff; font-weight:700; font-size:18px; }
        .login-title { font-size:20px; font-weight:700; color:#111827; }
        @media (min-width:768px){ .login-title { font-size:24px; } }
        .login-form { display:flex; flex-direction:column; gap:16px; }
        .login-label { display:block; font-size:14px; font-weight:500; color:#374151; margin-bottom:4px; }
        .login-input { width:100%; padding:10px 12px; border:1px solid #d1d5db; border-radius:8px; font-size:16px; outline:none; box-sizing:border-box; }
        .login-input:focus { border-color:#2563eb; box-shadow:0 0 0 2px rgba(37,99,235,0.2); }
        .login-error { font-size:14px; color:#dc2626; background:#fef2f2; padding:10px 12px; border-radius:8px; }
        .login-btn { width:100%; padding:12px; font-size:14px; font-weight:500; color:#fff; background:#2563eb; border:none; border-radius:8px; cursor:pointer; }
        .login-btn:disabled { opacity:0.5; cursor:not-allowed; }
        .login-hint { margin-top:24px; text-align:center; font-size:12px; color:#9ca3af; }
        /* 移动端：内容靠上对齐，防止键盘弹出遮挡输入框 */
        @media (max-width:767px){ .login-root { align-items:flex-start; padding-top:60px; } }
        /* 隐藏兼容模式按钮和提示（所有设备统一隐藏） */
        .login-compat-btn { display:none; } .login-compat-hint { display:none; }
      `}} />
      <noscript>
        <div style={{ padding: "20px", textAlign: "center", color: "#dc2626", background: "#fef2f2", borderRadius: "8px", margin: "20px" }}>
          <strong>请启用JavaScript</strong><br/>
          您的浏览器禁用了JavaScript，无法登录。请换用Chrome浏览器或开启JavaScript后刷新。
        </div>
      </noscript>
      <div className="login-root">
        <div className="login-card">
          <div className="login-logo">
            <div className="login-logo-box">
              <span className="login-logo-text">修</span>
            </div>
            <h1 className="login-title">汽修管家</h1>
          </div>

          {/* 环境检测显示（调试用，确认 APP 是否正确识别） */}
          <div style={{ fontSize: "12px", color: "#9ca3af", textAlign: "center", marginBottom: "12px" }}>
            当前环境: {环境}
          </div>

          <div className="login-form"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleSubmit();
              }
            }}
          >
            <div>
              <label className="login-label">
                手机号 / 邮箱
              </label>
              <input
                id="login-account"
                type="text"
                className="login-input"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="请输入手机号或邮箱"
              />
            </div>
            <div>
              <label className="login-label">
                密码
              </label>
              <input
                id="login-password"
                type="password"
                className="login-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
              />
            </div>

            {error && (
              <div className="login-error">
                {error}
              </div>
            )}

            {/* React版本登录按钮（正常设备用） */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="login-btn"
            >
              {loading ? "登录中..." : "登录"}
            </button>

            {/* 原生登录按钮（旧版WebView fallback，用dangerouslySetInnerHTML插入真正的原生HTML） */}
            {/* 移动端（屏幕宽度≤767px）自动隐藏此按钮，因为现代手机浏览器和APP的WebView都支持React 19 */}
            <div className="login-compat-btn" dangerouslySetInnerHTML={{ __html: `
              <button type="button"
                onclick="if(window._nativeLoginInit){window._nativeLoginInit();}else{alert('登录脚本加载中，请稍后再试');}"
                style="margin-top:8px;padding:12px;font-size:14px;font-weight:500;color:#fff;background:#2563eb;border:none;border-radius:8px;cursor:pointer;width:100%;"
              >
                登录（兼容模式）
              </button>
            `}} />

            {/* 调试信息显示 */}
            <div
              id="debug-info"
              className="login-compat-hint"
              style={{
                marginTop: "8px",
                fontSize: "11px",
                color: "#9ca3af",
                lineHeight: "1.5",
                wordBreak: "break-all",
              }}
            >
              {环境 === "检测中..." ? `如果上方按钮点击无反应，请使用"兼容模式"按钮` : `环境: ${环境}`}
            </div>
          </div>

          <div className="login-hint">
            首次使用请在 Supabase 控制台创建用户
          </div>
        </div>
      </div>
    </>
  );
}
