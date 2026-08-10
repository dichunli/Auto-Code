"use client";

import { useRouter } from "next/navigation";

interface 员工项 {
  id: string;
  full_name: string;
}

/** 人员切换下拉框：在个人考勤明细页顶部直接换人，不用返回月报 */
export function PersonSwitcher({
  员工们,
  当前id,
  month,
}: {
  员工们: 员工项[];
  当前id: string;
  month: string;
}) {
  const router = useRouter();

  return (
    <select
      value={当前id}
      onChange={(e) => router.push(`/attendance/${e.target.value}?month=${month}`)}
      className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-medium text-gray-900"
      aria-label="切换员工"
    >
      {员工们.map((员) => (
        <option key={员.id} value={员.id}>
          {员.full_name}
        </option>
      ))}
    </select>
  );
}
