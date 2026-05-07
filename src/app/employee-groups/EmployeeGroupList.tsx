"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

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
            {groups?.map((g) => {
              const memberCount = g.profiles?.[0]?.count || 0;
              return (
                <tr key={g.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <Link href={`/employees?group=${g.id}`} className="text-blue-600 hover:text-blue-700">
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{g.description || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{g.sort_order}</td>
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
