"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Navbar } from "./Navbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  return (
    <>
      {!isLogin && <Navbar />}
      <main
        className={cn(
          "flex-1 overflow-auto px-4 pb-6 sm:px-6 lg:px-8",
          isLogin ? "pt-0" : "pt-14 md:pt-6"
        )}
      >
        {children}
      </main>
    </>
  );
}
