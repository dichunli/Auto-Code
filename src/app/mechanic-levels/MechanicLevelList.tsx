"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Level {
  id: string;
  name: string;
  level_code: string | null;
  share_coefficient: number;
  commission_weight: number;
  sort_order: number;
}

interface Props {
  levels: Level[];
}

export function MechanicLevelList({ levels }: Props) {
  const router = useRouter();
  const supabase = createClient();

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定要删除等级「${name}」吗？`)) {
      return;
    }

    const { error } = await supabase.from("mechanic_levels").delete().eq("id", id);
    if (error) {
      alert("删除失败：" + error.message);
      return;
    }

    router.refresh();
  }

  async function moveUp(index: number) {
    if (index <= 0) return;
    const current = levels[index];
    const prev = levels[index - 1];

    await Promise.all([
      supabase.from("mechanic_levels").update({ sort_order: prev.sort_order }).eq("id", current.id),
      supabase.from("mechanic_levels").update({ sort_order: current.sort_order }).eq("id", prev.id),
    ]);

    router.refresh();
  }

  async function moveDown(index: number) {
    if (index >= levels.length - 1) return;
    const current = levels[index];
    const next = levels[index + 1];

    await Promise.all([
      supabase.from("mechanic_levels").update({ sort_order: next.sort_order }).eq("id", current.id),
      supabase.from("mechanic_levels").update({ sort_order: current.sort_order }).eq("id", next.id),
    ]);

    router.refresh();
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-gray-500">排序</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">等级名称</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">编码</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">个人系数</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">团队权重</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {levels.map((l, i) => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveUp(i)}
                      disabled={i === 0}
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed px-1"
                      title="上移"
                    >
                      ↑
                    </button>
                    <span className="text-gray-500 text-xs w-5 text-center">{l.sort_order}</span>
                    <button
                      type="button"
                      onClick={() => moveDown(i)}
                      disabled={i === levels.length - 1}
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed px-1"
                      title="下移"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td className="px-6 py-4 font-medium text-gray-900">{l.name}</td>
                <td className="px-6 py-4 text-gray-600">{l.level_code || "-"}</td>
                <td className="px-6 py-4 text-gray-600">{l.share_coefficient}</td>
                <td className="px-6 py-4 text-gray-600">{l.commission_weight}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/mechanic-levels/${l.id}/edit`}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      编辑
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(l.id, l.name)}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {levels.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                  暂无技师等级
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
