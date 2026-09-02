import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MobileToastProvider } from "@/components/mobile/MobileToast";
import { MobileBottomNav } from "@/components/mobile/MobileBottomNav";
import { AppAuthGuard } from "@/components/mobile/AppAuthGuard";

function 是APP环境(userAgent: string): boolean {
  return (
    userAgent.includes("wv") ||
    userAgent.includes("Capacitor") ||
    (!userAgent.includes("Chrome/") && userAgent.includes("Linux; Android"))
  );
}

export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  const userAgent = headerList.get("user-agent") || "";

  /* APP 环境：跳过服务端 auth 检查，由客户端自行处理 */
  if (!是APP环境(userAgent)) {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null; /* getSession本地读不联网（2026-09-03） */

    if (!user) {
      redirect("/login?redirect=/m/");
    }
  }

  return (
    <MobileToastProvider>
      <div className="flex flex-col h-[100dvh] bg-gray-50">
        <main className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
          {children}
        </main>
        <MobileBottomNav />
        {是APP环境(userAgent) && <AppAuthGuard />}
      </div>
    </MobileToastProvider>
  );
}
