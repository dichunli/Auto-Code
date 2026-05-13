"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logLogin } from "@/lib/operationLog";

export default function LoginPage() {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const supabase = createClient();

  function isPhone(value: string) {
    return /^1[3-9]\d{9}$/.test(value);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const credentials: any = { password };
    if (isPhone(account)) {
      credentials.email = "phone-" + account + "@auto.local";
    } else {
      credentials.email = account;
    }

    try {
      console.log("[登录] 开始调用 signInWithPassword...");
      const { data, error } = await Promise.race([
        supabase.auth.signInWithPassword(credentials),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("登录请求超时，请检查网络连接或刷新页面重试")), 10000)
        ),
      ]);
      console.log("[登录] signInWithPassword 返回", { hasSession: !!data?.session, error: error?.message });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      if (!data.session) {
        setError("登录成功但未获取到会话，请检查网络或 Supabase 配置");
        setLoading(false);
        return;
      }

      // 记录登录日志（不阻塞登录流程）
      logLogin({
        userId: data.user?.id || "",
        userName: data.user?.email || account,
        description: `用户 ${account} 登录系统`,
      }).catch(() => {
        console.log("[登录] 日志记录失败，不影响登录");
      });

      console.log("[登录] 开始跳转首页...");
      window.location.href = "/";
      console.log("[登录] window.location.href 已设置");
    } catch (err: any) {
      console.error("[登录] 异常:", err);
      setError("登录请求失败: " + (err?.message || "网络错误或浏览器安全策略阻止了请求"));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl border border-gray-200 p-8">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">修</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">汽修管家</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              手机号 / 邮箱
            </label>
            <input
              type="text"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="请输入手机号或邮箱"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              密码
            </label>
            <input
              type="password"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-gray-400">
          首次使用请在 Supabase 控制台创建用户
        </div>
      </div>
    </div>
  );
}
