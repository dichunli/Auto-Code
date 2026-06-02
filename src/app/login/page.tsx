"use client";

import { useState, useEffect } from "react";
import { createClient, 获取当前环境 } from "@/lib/supabase/client";
import { logLogin } from "@/lib/operationLog";

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
  /* 因此 APP 环境不做任何处理，浏览器环境也只记录日志不强制刷新 */
  useEffect(() => {
    function handlePageShow(e: PageTransitionEvent) {
      if (e.persisted && 获取当前环境() !== "APP") {
        /* 浏览器环境：从缓存恢复时，如果已经有 session 则跳走，不强制刷新 */
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

  function isPhone(value: string) {
    return /^1[3-9]\d{9}$/.test(value);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    /* 防止 supabase 客户端尚未初始化时提交 */
    if (!supabase) {
      setError("登录服务正在初始化，请稍后再试");
      return;
    }

    setLoading(true);
    setError("");

    const credentials: { password: string; email: string } = { password, email: "" };
    if (isPhone(account)) {
      credentials.email = "phone-" + account + "@auto.local";
    } else {
      credentials.email = account;
    }

    try {
      const { data, error } = await Promise.race([
        supabase.auth.signInWithPassword(credentials),
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

          <form onSubmit={handleSubmit} className="login-form">
            <div>
              <label className="login-label">
                手机号 / 邮箱
              </label>
              <input
                type="text"
                required
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
                type="password"
                required
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

            <button
              type="submit"
              disabled={loading}
              className="login-btn"
            >
              {loading ? "登录中..." : "登录"}
            </button>
          </form>

          <div className="login-hint">
            首次使用请在 Supabase 控制台创建用户
          </div>
        </div>
      </div>
    </>
  );
}
