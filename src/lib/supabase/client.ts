import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createBrowserClient> | ReturnType<typeof createSupabaseClient> | null = null;

function 是Capacitor环境(): boolean {
  return typeof window !== "undefined" && !!(window as Record<string, unknown>).Capacitor;
}

export function createClient() {
  if (!client) {
    if (是Capacitor环境()) {
      /* APP 环境：用 supabase-js + localStorage，避免 WebView cookie 问题 */
      client = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
    } else {
      /* 浏览器环境：用 ssr 的 cookie 管理 */
      client = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
    }
  }
  return client;
}
