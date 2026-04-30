import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default async function InventoryChecksPage() {
  const supabase = await createClient();
  const { data: checks } = await supabase
    .from("inventory_checks")
    .select("*, inventory_check_items(count)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="库存盘点"
        description="创建盘点单并处理盘盈盘亏"
        action={{ href: "/inventory/checks/new", label: "新建盘点单" }}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">盘点单号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">盘点位置</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">盘点项数</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {checks?.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{c.check_no || "-"}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-0.5 rounded ${c.status === "completed" ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}`}>
                      {c.status === "completed" ? "已完成" : "待盘点"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{c.location || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{c.inventory_check_items?.[0]?.count || 0}</td>
                  <td className="px-6 py-4 text-gray-500">{c.notes || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {(!checks || checks.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    暂无盘点单
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
