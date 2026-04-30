import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default async function PurchaseReturnsPage() {
  const supabase = await createClient();
  const { data: returns } = await supabase
    .from("purchase_returns")
    .select("*, parts(part_number, name), part_batches(batch_no)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="供应商退货"
        description="管理退货单，按先进先出退最早批次"
        action={{ href: "/inventory/returns/new", label: "新建退货" }}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">批次</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">数量</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">原因</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {returns?.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{r.parts?.name}</div>
                    <div className="text-xs text-gray-500">{r.parts?.part_number}</div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{r.part_batches?.batch_no || "-"}</td>
                  <td className="px-6 py-4 text-gray-900">{r.quantity}</td>
                  <td className="px-6 py-4 text-gray-600">{r.reason || "-"}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        r.status === "completed"
                          ? "bg-green-50 text-green-700"
                          : "bg-yellow-50 text-yellow-700"
                      }`}
                    >
                      {r.status === "completed" ? "已完成" : "待处理"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {(!returns || returns.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    暂无退货单
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
