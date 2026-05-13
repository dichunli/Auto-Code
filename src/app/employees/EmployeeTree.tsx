"use client";

import { useState } from "react";
import Link from "next/link";

interface Role {
  name: string;
  label: string;
}

interface ProfileRole {
  role_id: string;
  roles: Role | null;
}

interface Group {
  id: string;
  name: string;
  sort_order: number;
}

interface Employee {
  id: string;
  full_name: string | null;
  phone: string | null;
  group_id: string | null;
  is_active: boolean;
  entry_date: string | null;
  mechanic_level_id: string | null;
  mechanic_levels: { name: string; sort_order: number | null } | null;
  profile_roles: ProfileRole[] | null;
}

interface Props {
  groups: Group[];
  employees: Employee[];
}

export function EmployeeTree({ groups, employees }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // 组内按等级 sort_order 降序，再按姓名升序
  function sortInGroup(arr: Employee[]) {
    return [...arr].sort((a, b) => {
      const sa = a.mechanic_levels?.sort_order ?? -1;
      const sb = b.mechanic_levels?.sort_order ?? -1;
      if (sa !== sb) return sb - sa;
      return (a.full_name || "").localeCompare(b.full_name || "", "zh-Hans-CN");
    });
  }

  // 按 group_id 聚合
  const byGroup = new Map<string | null, Employee[]>();
  employees.forEach((e) => {
    const key = e.group_id || null;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(e);
  });

  const sortedGroups = [...groups].sort((a, b) => a.sort_order - b.sort_order);
  const unassigned = byGroup.get(null) || [];

  function renderEmployeeRow(e: Employee) {
    return (
      <tr key={e.id} className="hover:bg-gray-50">
        <td className="pl-12 pr-6 py-3 text-gray-400 text-xs">└</td>
        <td className="px-6 py-3">
          <Link href={`/employees/${e.id}`} className="font-medium text-blue-600 hover:text-blue-700">
            {e.full_name || "-"}
          </Link>
        </td>
        <td className="px-6 py-3 text-gray-600">{e.phone || "-"}</td>
        <td className="px-6 py-3">
          <div className="flex flex-wrap gap-1">
            {e.profile_roles?.map((pr) => (
              <span key={pr.role_id} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                {pr.roles?.label || pr.roles?.name}
              </span>
            ))}
            {(!e.profile_roles || e.profile_roles.length === 0) && <span className="text-gray-400">-</span>}
          </div>
        </td>
        <td className="px-6 py-3 text-gray-600">{e.mechanic_levels?.name || "-"}</td>
        <td className="px-6 py-3 text-gray-500">{e.entry_date || "-"}</td>
        <td className="px-6 py-3">
          <span className={`text-xs px-2 py-0.5 rounded ${e.is_active ? "bg-green-50 text-green-700" : "bg-gray-50 text-gray-500"}`}>
            {e.is_active ? "在职" : "离职"}
          </span>
        </td>
      </tr>
    );
  }

  function renderGroupHeaderRow(key: string, label: string, count: number, isCollapsed: boolean) {
    return (
      <tr
        className="bg-purple-50/40 hover:bg-purple-50 cursor-pointer border-t-2 border-purple-100"
        onClick={() => toggle(key)}
      >
        <td className="pl-4 pr-2 py-3 text-purple-600 w-10">
          <span className="inline-block w-4 text-center select-none">{isCollapsed ? "▶" : "▼"}</span>
        </td>
        <td className="px-6 py-3 font-semibold text-purple-900" colSpan={6}>
          {label}
          <span className="ml-2 text-xs font-normal text-purple-600">{count} 人</span>
        </td>
      </tr>
    );
  }

  const rows: React.ReactElement[] = [];

  sortedGroups.forEach((g) => {
    const members = sortInGroup(byGroup.get(g.id) || []);
    const key = g.id;
    const isCollapsed = collapsed.has(key);
    rows.push(
      <tr
        key={`g-${key}`}
        className="bg-purple-50/40 hover:bg-purple-50 cursor-pointer border-t-2 border-purple-100"
        onClick={() => toggle(key)}
      >
        <td className="pl-4 pr-2 py-3 text-purple-600 w-10">
          <span className="inline-block w-4 text-center select-none">{isCollapsed ? "▶" : "▼"}</span>
        </td>
        <td className="px-6 py-3 font-semibold text-purple-900" colSpan={6}>
          {g.name}
          <span className="ml-2 text-xs font-normal text-purple-600">{members.length} 人</span>
        </td>
      </tr>
    );
    if (!isCollapsed) {
      members.forEach((m) => rows.push(renderEmployeeRow(m)));
    }
  });

  if (unassigned.length > 0) {
    const key = "__unassigned__";
    const isCollapsed = collapsed.has(key);
    const members = sortInGroup(unassigned);
    rows.push(
      <tr
        key={`g-${key}`}
        className="bg-gray-50/60 hover:bg-gray-100 cursor-pointer border-t-2 border-gray-200"
        onClick={() => toggle(key)}
      >
        <td className="pl-4 pr-2 py-3 text-gray-500 w-10">
          <span className="inline-block w-4 text-center select-none">{isCollapsed ? "▶" : "▼"}</span>
        </td>
        <td className="px-6 py-3 font-semibold text-gray-700" colSpan={6}>
          未分组
          <span className="ml-2 text-xs font-normal text-gray-500">{members.length} 人</span>
        </td>
      </tr>
    );
    if (!isCollapsed) {
      members.forEach((m) => rows.push(renderEmployeeRow(m)));
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="pl-4 pr-2 py-3 text-left font-medium text-gray-500 w-10"></th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">姓名</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">电话</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">角色</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">技师等级</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">入职日期</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length > 0 ? rows : (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                  暂无员工数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
