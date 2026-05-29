"use client";

interface MonthSelectorProps {
  monthOptions: string[];
  defaultValue: string;
}

export function MonthSelector({ monthOptions, defaultValue }: MonthSelectorProps) {
  return (
    <select
      name="month"
      defaultValue={defaultValue}
      onChange={(e) => {
        const url = new URL(window.location.href);
        url.searchParams.set("month", e.target.value);
        window.location.href = url.toString();
      }}
      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {monthOptions.map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  );
}
