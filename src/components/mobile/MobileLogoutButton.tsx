"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function MobileLogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    if (!confirm("确定要退出登录吗？")) return;
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="w-full py-3 text-sm text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50 active:bg-red-100 transition-colors"
    >
      退出登录
    </button>
  );
}
