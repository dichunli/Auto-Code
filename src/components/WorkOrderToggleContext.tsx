"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface ToggleState {
  showCommission: boolean;
  showTimer: boolean;
  setShowCommission: (v: boolean) => void;
  setShowTimer: (v: boolean) => void;
}

const Context = createContext<ToggleState>({
  showCommission: true,
  showTimer: true,
  setShowCommission: () => {},
  setShowTimer: () => {},
});

export function WorkOrderToggleProvider({ children }: { children: ReactNode }) {
  const [showCommission, setShowCommissionState] = useState(false);
  const [showTimer, setShowTimerState] = useState(false);

  useEffect(() => {
    const savedCommission = localStorage.getItem("wo_show_commission");
    const savedTimer = localStorage.getItem("wo_show_timer");
    if (savedCommission !== null) {
      setShowCommissionState(savedCommission !== "false");
    }
    if (savedTimer !== null) {
      setShowTimerState(savedTimer !== "false");
    }
  }, []);

  function setShowCommission(v: boolean) {
    localStorage.setItem("wo_show_commission", String(v));
    setShowCommissionState(v);
  }

  function setShowTimer(v: boolean) {
    localStorage.setItem("wo_show_timer", String(v));
    setShowTimerState(v);
  }

  return (
    <Context.Provider value={{ showCommission, showTimer, setShowCommission, setShowTimer }}>
      {children}
    </Context.Provider>
  );
}

export function useWorkOrderToggle() {
  return useContext(Context);
}

export function ShowCommission({ children }: { children: ReactNode }) {
  const { showCommission } = useWorkOrderToggle();
  if (!showCommission) return null;
  return <>{children}</>;
}

export function ShowTimer({ children }: { children: ReactNode }) {
  const { showTimer } = useWorkOrderToggle();
  if (!showTimer) return null;
  return <>{children}</>;
}
