import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MobileToastProvider } from "@/components/mobile/MobileToast";
import { MobileBottomNav } from "@/components/mobile/MobileBottomNav";

export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/m/");
  }

  return (
    <MobileToastProvider>
      <div className="flex flex-col h-[100dvh] bg-gray-50">
        <main className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </MobileToastProvider>
  );
}
