"use client";

interface FuelGaugeProps {
  value: string | number;
  onChange: (value: string) => void;
}

export function FuelGauge({ value, onChange }: FuelGaugeProps) {
  const numValue = typeof value === "string" ? parseInt(value) || 0 : value || 0;
  const totalCells = 20;
  const cellValue = 100 / totalCells; // 每格 5%

  function handleCellClick(index: number) {
    const target = (index + 1) * cellValue;
    if (numValue === target) {
      // 再次点击最高格，减少一格（最低到 0）
      onChange(String(Math.max(0, target - cellValue)));
    } else {
      onChange(String(target));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-500 shrink-0">E&lt;</span>
      <div className="flex-1 flex h-8 rounded border border-gray-300 overflow-hidden">
        {Array.from({ length: totalCells }, (_, i) => {
          const isActive = (i + 1) * cellValue <= numValue;
          return (
            <div
              key={i}
              className={`flex-1 border-r border-white last:border-r-0 cursor-pointer transition-colors ${
                isActive ? "bg-blue-400" : "bg-gray-100"
              }`}
              onClick={() => handleCellClick(i)}
            />
          );
        })}
      </div>
      <span className="text-sm font-medium text-blue-600 min-w-[2.5rem] text-right">
        {numValue}%
      </span>
      <span className="text-sm text-gray-500 shrink-0">&gt;F</span>
    </div>
  );
}
