"use client";

import { useWorkOrderToggle } from "./WorkOrderToggleContext";

export function WorkOrderToggleBar() {
  const { showCommission, showTimer, setShowCommission, setShowTimer } = useWorkOrderToggle();

  return (
    <div className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 px-4 py-3 mb-4">
      <span className="text-sm text-gray-500">显示设置：</span>
      <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={showCommission}
          onChange={(e) => setShowCommission(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600"
        />
        提成信息
      </label>
      <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={showTimer}
          onChange={(e) => setShowTimer(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600"
        />
        计时功能
      </label>
    </div>
  );
}
