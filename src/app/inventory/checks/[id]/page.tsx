import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import CompleteCheckButton from "./CompleteCheckButton";

/* 盘点单详情 — Server Component 首屏直查 */

interface 盘点明细行 {
  id: string;
  system_qty: number | null;
  actual_qty: number | null;
  diff_qty: number | null;
  notes: string | null;
  parts: { part_number: string | null; name: string | null } | null;
}

export default async function InventoryCheckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: 盘点单, error } = await supabase
    .from("inventory_checks")
    .select("id, check_no, status, location, notes, created_at, completed_at")
    .eq("id", id)
    .maybeSingle();

  /* 查询失败与单不存在分开：网络异常给重试提示，不冒充 404 */
  if (error) {
    return (
      <div>
        <PageHeader title="盘点单详情" />
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
          加载失败：{error.message}（请刷新重试）
        </div>
      </div>
    );
  }
  if (!盘点单) notFound();

  const { data: 明细原始 } = await supabase
    .from("inventory_check_items")
    .select("id, system_qty, actual_qty, diff_qty, notes, parts(part_number, name)")
    .eq("check_id", id)
    .order("created_at");
  const 明细 = (明细原始 || []) as unknown as 盘点明细行[];

  const 已完成 = 盘点单.status === "completed";

  return (
    <div>
      <PageHeader
        title={`盘点单 ${盘点单.check_no || ""}`}
        description={已完成 ? "已完成" : "待盘点（实盘数填完后点下方按钮完成）"}
      />

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-gray-500">状态</div>
            <div className="mt-1">
              <span className={`text-xs px-2 py-0.5 rounded ${已完成 ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}`}>
                {已完成 ? "已完成" : "待盘点"}
              </span>
            </div>
          </div>
          <div>
            <div className="text-gray-500">盘点位置</div>
            <div className="mt-1 text-gray-900">{盘点单.location || "-"}</div>
          </div>
          <div>
            <div className="text-gray-500">创建时间</div>
            <div className="mt-1 text-gray-900">{盘点单.created_at ? new Date(盘点单.created_at).toLocaleString() : "-"}</div>
          </div>
          <div>
            <div className="text-gray-500">完成时间</div>
            <div className="mt-1 text-gray-900">{盘点单.completed_at ? new Date(盘点单.completed_at).toLocaleString() : "-"}</div>
          </div>
        </div>
        {盘点单.notes && <div className="mt-4 text-sm text-gray-600">备注：{盘点单.notes}</div>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">配件编号</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">名称</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">系统库存</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">实盘库存</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">差异</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {明细.map((行) => (
                <tr key={行.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-600">{行.parts?.part_number || "-"}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{行.parts?.name || "-"}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{行.system_qty ?? "-"}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{行.actual_qty ?? "未盘"}</td>
                  <td className="px-4 py-2 text-right">
                    <span className={`font-medium ${(行.diff_qty || 0) > 0 ? "text-green-600" : (行.diff_qty || 0) < 0 ? "text-red-600" : "text-gray-600"}`}>
                      {(行.diff_qty || 0) > 0 ? "+" : ""}
                      {行.diff_qty ?? "-"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{行.notes || "-"}</td>
                </tr>
              ))}
              {明细.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                    暂无盘点明细
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!已完成 && 明细.length > 0 && <CompleteCheckButton checkId={盘点单.id} />}
    </div>
  );
}
