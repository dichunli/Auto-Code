/* 完整退出登录（2026-09-01）
 *
 * 完整退出 = 本地清除 + 服务端作废 Token，两者配合（用户拍板口径）：
 *   1. 后台作废服务端 refresh_token（不阻塞）：网络正常时立即作废；
 *      代理/弱网挂起时无碍——本地已清、令牌到期自然失效
 *   2. 本地立即清除 session（不等网络，根治 logout 请求挂起导致退出按钮卡死）
 *
 * 用法：handleLogout 里 await 完整退出登录() 后照常跳转登录页。
 */

import { createClient } from "@/lib/supabase/client";

export async function 完整退出登录(): Promise<void> {
  const supabase = createClient();

  /* 1. 后台作废服务端凭证（发起后不等待） */
  void (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
          Authorization: `Bearer ${token}`,
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
    } catch {
      /* 后台作废失败无碍：本地已清，令牌到期自然失效 */
    }
  })();

  /* 2. 本地立即清除（scope:'local' 不调网络，秒回） */
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* 忽略登出错误，调用方照常跳转 */
  }
}
