"use client";

import { useWorkOrderToggle } from "./WorkOrderToggleContext";

export function WorkOrderToggleBar() {
  const { showCommission, showTimer, setShowCommission, setShowTimer } = useWorkOrderToggle();

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={showCommission}
          onChange={(e) => setShowCommission(e.target.checked)}
          className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600"
        />
        <span className="text-gray-600">提成信息</span>
      </label>
      <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={showTimer}
          onChange={(e) => setShowTimer(e.target.checked)}
          className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600"
        />
        <span className="text-gray-600">计时功能</span>
      </label>
    </div>
  );
}
