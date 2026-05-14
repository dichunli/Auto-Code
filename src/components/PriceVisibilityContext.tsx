"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface PriceVisibilityState {
  showPrices: boolean;
  togglePrices: () => void;
}

const Context = createContext<PriceVisibilityState>({
  showPrices: true,
  togglePrices: () => {},
});

export function PriceVisibilityProvider({ children }: { children: ReactNode }) {
  const [showPrices, setShowPrices] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("show_prices");
    if (saved !== null) {
      setShowPrices(saved !== "false");
    }
  }, []);

  function togglePrices() {
    setShowPrices((prev) => {
      const next = !prev;
      localStorage.setItem("show_prices", String(next));
      return next;
    });
  }

  return (
    <Context.Provider value={{ showPrices, togglePrices }}>
      {children}
    </Context.Provider>
  );
}

export function usePriceVisibility() {
  return useContext(Context);
}

export function PriceValue({
  value,
  prefix = "¥",
  className,
}: {
  value: number | string | null;
  prefix?: string;
  className?: string;
}) {
  const { showPrices } = usePriceVisibility();
  if (!showPrices) {
    return <span className={className}>***</span>;
  }
  const num = typeof value === "string" ? parseFloat(value) : value;
  return (
    <span className={className}>
      {prefix}
      {Number(num || 0).toFixed(2)}
    </span>
  );
}
