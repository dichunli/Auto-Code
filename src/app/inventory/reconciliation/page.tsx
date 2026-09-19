import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

interface 对账行 {
  part_id: string;
  part_number: string | null;
  name: string | null;
  total_qty: number;
  batch_qty: number;
  location_qty: number;
  batch_diff: number;
  location_diff: number;
}

/* ═══ 库存三方对账（总库存 vs 批次合计 vs 仓位合计）═══
 * 不一致的配件列在这里，作为按仓位盘点纠偏的目标清单 */
export default async function StockReconciliationPage() {
  const supabase = await createClient();
  const { data: rpc结果 } = await supabase.rpc("report_stock_reconciliation");
  const 不一致 = Array.isArray(rpc结果) ? (rpc结果 as 对账行[]) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存三方对账"
        description="总库存 / 批次合计 / 仓位合计 不一致的配件清单，可用按仓位盘点纠偏"
      />

      <div className="flex flex-wrap gap-2">
        <Link href="/inventory" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          返回配件列表
        </Link>
        <Link href="/inventory/checks" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          去盘点纠偏
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {不一致.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="text-4xl mb-3">✅</div>
            <div className="text-gray-900 font-medium">三方账全部一致</div>
            <div className="text-sm text-gray-400 mt-1">总库存 = 批次合计 = 仓位合计，无需纠偏</div>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-gray-100">
              <span className="text-sm text-gray-500">
                共 <span className="font-semibold text-red-600">{不一致.length}</span> 个配件三方不一致
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">配件编码</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">配件名称</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">总库存</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">批次合计</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">批次差异</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">仓位合计</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">仓位差异</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {不一致.map((row) => (
                    <tr key={row.part_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-gray-900 font-medium">{row.part_number || "-"}</td>
                      <td className="px-6 py-4 text-gray-600">{row.name || "-"}</td>
                      <td className="px-6 py-4 text-right text-gray-900 font-medium">{row.total_qty}</td>
                      <td className="px-6 py-4 text-right text-gray-600">{row.batch_qty}</td>
                      <td className={`px-6 py-4 text-right font-medium ${row.batch_diff !== 0 ? "text-red-600" : "text-gray-400"}`}>
                        {row.batch_diff > 0 ? `+${row.batch_diff}` : row.batch_diff}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-600">{row.location_qty}</td>
                      <td className={`px-6 py-4 text-right font-medium ${row.location_diff !== 0 ? "text-red-600" : "text-gray-400"}`}>
                        {row.location_diff > 0 ? `+${row.location_diff}` : row.location_diff}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="text-xs text-gray-400 px-1">
        批次差异 = 总库存 − 批次合计（正数说明批次账少记，如期初未批次化的老库存）；
        仓位差异 = 总库存 − 仓位合计（正数说明仓位账少记，如不带仓位入库的老数据）。
        历史差异属阶段五存量清洗范围，可通过按仓位盘点逐配件校准。
      </div>
    </div>
  );
}
