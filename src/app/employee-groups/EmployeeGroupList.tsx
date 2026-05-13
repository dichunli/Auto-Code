"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Group {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  profiles?: { count: number }[];
}

interface Props {
  groups: Group[];
}

export function EmployeeGroupList({ groups }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);

  async function handleDelete(id: string, name: string, memberCount: number) {
    if (memberCount > 0) {
      alert(`「${name}」下还有 ${memberCount} 名员工，请先移走员工再删除分组。`);
      return;
    }

    if (!confirm(`确定要删除分组「${name}」吗？`)) {
      return;
    }

    const { error } = await supabase.from("employee_groups").delete().eq("id", id);
    if (error) {
      alert("删除失败：" + error.message);
      return;
    }

    router.refresh();
  }

  async function swapOrder(currentIndex: number, targetIndex: number) {
    if (targetIndex < 0 || targetIndex >= groups.length) return;
    const a = groups[currentIndex];
    const b = groups[targetIndex];
    setBusy(a.id);
    try {
      const { error: e1 } = await supabase
        .from("employee_groups")
        .update({ sort_order: b.sort_order })
        .eq("id", a.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("employee_groups")
        .update({ sort_order: a.sort_order })
        .eq("id", b.id);
      if (e2) throw e2;
      router.refresh();
    } catch (err: any) {
      alert("排序失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(null);
    }
  }

  async function updateOrder(id: string, value: string) {
    const num = parseInt(value);
    if (isNaN(num)) return;
    setBusy(id);
    try {
      const { error } = await supabase
        .from("employee_groups")
        .update({ sort_order: num })
        .eq("id", id);
      if (error) throw error;
      router.refresh();
    } catch (err: any) {
      alert("排序失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-gray-500">分组名称</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">描述</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">排序</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">人数</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups?.map((g, index) => {
              const memberCount = g.profiles?.[0]?.count || 0;
              const isFirst = index === 0;
              const isLast = index === groups.length - 1;
              const isBusy = busy === g.id;
              return (
                <tr key={g.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <Link href={`/employees?group=${g.id}`} className="text-blue-600 hover:text-blue-700">
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{g.description || "-"}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isFirst || isBusy}
                        onClick={() => swapOrder(index, index - 1)}
                        className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="上移"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={isLast || isBusy}
                        onClick={() => swapOrder(index, index + 1)}
                        className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="下移"
                      >
                        ↓
                      </button>
                      <input
                        type="number"
                        defaultValue={g.sort_order}
                        disabled={isBusy}
                        onBlur={(e) => {
                          if (parseInt(e.target.value) !== g.sort_order) {
                            updateOrder(g.id, e.target.value);
                          }
                        }}
                        className="w-16 ml-2 px-2 py-1 text-sm rounded border border-gray-300 text-center"
                      />
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{memberCount}</td>
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      onClick={() => handleDelete(g.id, g.name, memberCount)}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
            {(!groups || groups.length === 0) && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                  暂无分组
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
