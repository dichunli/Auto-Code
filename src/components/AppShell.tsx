"use client";

import { usePathname } from "next/navigation";
import { useEffect, Suspense } from "react";
import { cn } from "@/lib/utils";
import { Navbar } from "./Navbar";
import { PriceVisibilityProvider, usePriceVisibility } from "./PriceVisibilityContext";

function KeyboardHandler() {
  const { togglePrices } = usePriceVisibility();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        togglePrices();
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [togglePrices]);

  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  return (
    <PriceVisibilityProvider>
      <KeyboardHandler />
      <Suspense fallback={null}>
        {!isLogin && <Navbar />}
      </Suspense>
      <main
        className={cn(
          "flex-1 overflow-auto px-4 pb-6 sm:px-6 lg:px-8",
          isLogin ? "pt-0" : "pt-14 md:pt-6"
        )}
      >
        {children}
      </main>
    </PriceVisibilityProvider>
  );
}
