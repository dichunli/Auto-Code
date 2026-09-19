"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/PrintButton";
import { formatCurrency } from "@/lib/utils";

/* 物流公司对账单客户端（2026-09-15 批次4）
 * 月份内签收运单明细 + 运费/代收/已结未结合计，可打印/导出 Excel */

interface 公司信息 {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
}

interface 运单行 {
  id: string;
  tracking_no: string;
  package_count: number | null;
  freight_amount: number | null;
  cod_amount: number | null;
  supplier_name: string | null;
  received_at: string | null;
  freight_settled: boolean | null;
  cod_transferred: boolean | null;
  settlement_no: string | null;
}

export default function LogisticsStatementContent({
  company,
  rows,
  month,
}: {
  company: 公司信息;
  rows: 运单行[];
  month: string;
}) {
  const router = useRouter();

  /* 合计（转分计算防浮点） */
  const 合计 = useMemo(() => {
    let 运费分 = 0;
    let 代收分 = 0;
    let 已结分 = 0;
    for (const r of rows) {
      const 运 = Math.round((r.freight_amount || 0) * 100);
      运费分 += 运;
      代收分 += Math.round((r.cod_amount || 0) * 100);
      if (r.freight_settled) 已结分 += 运;
    }
    return {
      运费: 运费分 / 100,
      代收: 代收分 / 100,
      已结: 已结分 / 100,
      未结: (运费分 - 已结分) / 100,
      件数: rows.reduce((s, r) => s + (r.package_count || 0), 0),
    };
  }, [rows]);

  async function 导出Excel() {
    /* xlsx 约 400KB，改为点导出时才动态加载（2026-09-19，9-15 诊断🟡#20） */
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const 表头 = [
      { 项目: `物流公司：${company.name}`, 说明: `对账月份：${month}` },
      { 项目: `运费合计：${formatCurrency(合计.运费)}`, 说明: `未结：${formatCurrency(合计.未结)}` },
      {},
    ];
    const 明细 = rows.map((r) => ({
      签收日期: r.received_at ? new Date(r.received_at).toLocaleDateString("zh-CN") : "",
      运单号: r.tracking_no,
      发货供应商: r.supplier_name || "",
      件数: r.package_count || "",
      运费: r.freight_amount || 0,
      代收货款: r.cod_amount || 0,
      是否已结: r.freight_settled ? "已结" : "未结",
      结算单号: r.settlement_no || "",
    }));
    const ws = XLSX.utils.json_to_sheet([...表头, ...明细]);
    XLSX.utils.book_append_sheet(wb, ws, `${month} 对账单`);
    XLSX.writeFile(wb, `物流对账单_${company.name}_${month}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={`物流对账单 - ${company.name}`}
          description="按运单签收日取数，可打印发给物流公司核对"
          action={{ href: "/logistics", label: "返回物流管理" }}
        />
      </div>

      {/* 月份选择 + 操作（打印时隐藏） */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && router.push(`/logistics/${company.id}/statement?month=${e.target.value}`)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        <PrintButton label="打印对账单" />
        <button
          onClick={导出Excel}
          className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          导出 Excel
        </button>
      </div>

      {/* 打印用表头（屏幕上隐藏） */}
      <div className="hidden print:block text-center">
        <h1 className="text-xl font-bold">物流运费对账单</h1>
        <p className="text-sm mt-1">{company.name}　　对账月份：{month}</p>
        {(company.contact || company.phone) && (
          <p className="text-xs text-gray-600 mt-1">
            {company.contact ? `联系人：${company.contact}　` : ""}{company.phone ? `电话：${company.phone}` : ""}
          </p>
        )}
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 print:border-black print:rounded-none">
          <div className="text-sm text-gray-500">运费合计（{rows.length} 单 / {合计.件数} 件）</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(合计.运费)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 print:border-black print:rounded-none">
          <div className="text-sm text-gray-500">代收货款合计</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(合计.代收)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 print:border-black print:rounded-none">
          <div className="text-sm text-gray-500">已结运费</div>
          <div className="text-xl font-bold text-green-600 mt-1">{formatCurrency(合计.已结)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 print:border-black print:rounded-none">
          <div className="text-sm text-gray-500">未结运费</div>
          <div className="text-xl font-bold text-red-600 mt-1">{formatCurrency(合计.未结)}</div>
        </div>
      </div>

      {/* 明细表 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden print:border-black print:rounded-none">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">签收日期</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">运单号</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">发货供应商</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">件数</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">运费</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">代收货款</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">结算状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                  {r.received_at ? new Date(r.received_at).toLocaleDateString("zh-CN") : "-"}
                </td>
                <td className="px-4 py-3 text-gray-900">{r.tracking_no}</td>
                <td className="px-4 py-3 text-gray-600">{r.supplier_name || "-"}</td>
                <td className="px-4 py-3 text-right text-gray-600">{r.package_count || "-"}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(r.freight_amount || 0)}</td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {r.cod_amount ? formatCurrency(r.cod_amount) : "-"}
                  {/* 批次5：代收未转付提示（货运站还没把钱转给供应商） */}
                  {(r.cod_amount || 0) > 0 && !r.cod_transferred && (
                    <span className="block text-[10px] text-orange-600">代收未转付</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.freight_settled ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                      已结{r.settlement_no ? `（${r.settlement_no}）` : ""}
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700">未结</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-gray-400">本月没有签收的运单</td>
              </tr>
            )}
            {rows.length > 0 && (
              <tr className="bg-gray-50/60 font-bold">
                <td className="px-4 py-3 text-gray-900" colSpan={3}>合计</td>
                <td className="px-4 py-3 text-right text-gray-900">{合计.件数}</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(合计.运费)}</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(合计.代收)}</td>
                <td className="px-4 py-3"></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 打印用签字区（屏幕上隐藏） */}
      <div className="hidden print:flex justify-between mt-12 text-sm">
        <span>物流方核对签字：____________</span>
        <span>我方核对签字：____________</span>
        <span>日期：____年____月____日</span>
      </div>
    </div>
  );
}
