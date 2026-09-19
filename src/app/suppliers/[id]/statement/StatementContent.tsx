"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/PrintButton";
import { formatCurrency } from "@/lib/utils";

/* 供应商对账单（2026-09-15 批次2）
 * 期初欠款 + 本期逐笔流水（带跑动余额）+ 期末欠款，可打印/导出 Excel */

interface 供应商信息 {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  settle_type: string | null;
  credit_days: number | null;
  payee_name: string | null;
  bank_name: string | null;
  bank_account: string | null;
  payment_note: string | null;
}

interface 流水行 {
  id: string;
  transaction_type: string;
  amount: number;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  payment_method: string | null;
  created_at: string;
  profiles: { full_name: string } | null;
  docNo: string | null;
  docHref: string | null;
}

const 类型名: Record<string, string> = {
  debit: "应付（入库）",
  credit: "退货冲减",
  payment: "付款",
  refund: "退款",
  /* 2026-09-16 批次6 */
  discount: "优惠",
};

const 结算方式名: Record<string, string> = {
  cash: "现结",
  monthly: "月结",
  credit_days: "账期",
};

/* 正负号：应付/退款加欠款，付款/冲减/优惠减欠款（与总账公式一致） */
function 符号(type: string): number {
  if (type === "debit" || type === "refund") return 1;
  if (type === "payment" || type === "credit" || type === "discount") return -1;
  return 0;
}

export default function StatementContent({
  supplier,
  rows,
  month,
  期初起点,
  期末止点,
}: {
  supplier: 供应商信息;
  rows: 流水行[];
  month: string;
  期初起点: string;
  期末止点: string;
}) {
  const router = useRouter();

  /* 期初欠款 + 本期流水 + 期末欠款 + 跑动余额（全部转分计算防浮点） */
  const 账 = useMemo(() => {
    let 期初分 = 0;
    for (const r of rows) {
      if (r.created_at < 期初起点) 期初分 += Math.round(r.amount * 100) * 符号(r.transaction_type);
    }
    const 本期 = rows.filter((r) => r.created_at >= 期初起点 && r.created_at < 期末止点);
    /* 跑动余额用普通循环（map 回调里改外部变量会被 react-hooks/immutability 拦） */
    let 跑动分 = 期初分;
    const 本期带余额: (流水行 & { 余额: number })[] = [];
    for (const r of 本期) {
      跑动分 += Math.round(r.amount * 100) * 符号(r.transaction_type);
      本期带余额.push({ ...r, 余额: 跑动分 / 100 });
    }
    let 应付分 = 0;
    let 付款分 = 0;
    let 冲减分 = 0;
    let 退款分 = 0;
    let 优惠分 = 0;
    for (const r of 本期) {
      const 分 = Math.round(r.amount * 100);
      if (r.transaction_type === "debit") 应付分 += 分;
      else if (r.transaction_type === "payment") 付款分 += 分;
      else if (r.transaction_type === "credit") 冲减分 += 分;
      else if (r.transaction_type === "refund") 退款分 += 分;
      else if (r.transaction_type === "discount") 优惠分 += 分;
    }
    return {
      期初: 期初分 / 100,
      本期: 本期带余额,
      期末: 跑动分 / 100,
      本期应付: 应付分 / 100,
      本期付款: 付款分 / 100,
      本期冲减: 冲减分 / 100,
      本期退款: 退款分 / 100,
      本期优惠: 优惠分 / 100,
    };
  }, [rows, 期初起点, 期末止点]);

  async function 导出Excel() {
    /* xlsx 约 400KB，改为点导出时才动态加载（2026-09-19，9-15 诊断🟡#20） */
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const 表头 = [
      { 项目: `供应商：${supplier.name}`, 说明: `对账月份：${month}` },
      { 项目: `期初欠款：${formatCurrency(账.期初)}`, 说明: `期末欠款：${formatCurrency(账.期末)}` },
      {},
    ];
    const 明细 = 账.本期.map((r) => ({
      日期: new Date(r.created_at).toLocaleString("zh-CN"),
      类型: 类型名[r.transaction_type] || r.transaction_type,
      单据号: r.docNo || "",
      摘要: r.description || "",
      应付增加: r.transaction_type === "debit" ? r.amount : "",
      付款支出: r.transaction_type === "payment" ? r.amount : "",
      优惠: r.transaction_type === "discount" ? r.amount : "",
      冲减: r.transaction_type === "credit" ? r.amount : "",
      退款: r.transaction_type === "refund" ? r.amount : "",
      余额: r.余额,
      经办人: r.profiles?.full_name || "",
    }));
    const ws = XLSX.utils.json_to_sheet([...表头, ...明细]);
    XLSX.utils.book_append_sheet(wb, ws, `${month} 对账单`);
    XLSX.writeFile(wb, `对账单_${supplier.name}_${month}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={`对账单 - ${supplier.name}`}
          description="期初欠款 + 本期逐笔流水 + 期末欠款，可打印发给供应商核对"
          action={{ href: `/suppliers/${supplier.id}`, label: "返回供应商" }}
        />
      </div>

      {/* 月份选择 + 操作（打印时隐藏） */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && router.push(`/suppliers/${supplier.id}/statement?month=${e.target.value}`)}
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
        <h1 className="text-xl font-bold">供应商对账单</h1>
        <p className="text-sm mt-1">{supplier.name}　　对账月份：{month}</p>
      </div>

      {/* 供应商财务信息 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 print:border-black print:rounded-none text-sm">
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-gray-600">
          {supplier.contact && <span>联系人：{supplier.contact}</span>}
          {supplier.phone && <span>电话：{supplier.phone}</span>}
          {supplier.settle_type && (
            <span>
              结算方式：{结算方式名[supplier.settle_type] || supplier.settle_type}
              {supplier.settle_type === "credit_days" && supplier.credit_days ? ` ${supplier.credit_days} 天` : ""}
            </span>
          )}
          {supplier.payee_name && <span>收款户名：{supplier.payee_name}</span>}
          {supplier.bank_name && <span>开户行：{supplier.bank_name}</span>}
          {supplier.bank_account && <span>账号：{supplier.bank_account}</span>}
          {supplier.payment_note && <span>收款说明：{supplier.payment_note}</span>}
        </div>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 print:border-black print:rounded-none">
          <div className="text-sm text-gray-500">期初欠款</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(账.期初)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 print:border-black print:rounded-none">
          <div className="text-sm text-gray-500">本期应付（入库）</div>
          <div className="text-xl font-bold text-red-600 mt-1">+{formatCurrency(账.本期应付)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 print:border-black print:rounded-none">
          <div className="text-sm text-gray-500">
            本期已付{账.本期冲减 > 0 ? `（另冲减 ${formatCurrency(账.本期冲减)}）` : ""}{账.本期优惠 > 0 ? `（另优惠 ${formatCurrency(账.本期优惠)}）` : ""}
          </div>
          <div className="text-xl font-bold text-green-600 mt-1">-{formatCurrency(账.本期付款)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 print:border-black print:rounded-none">
          <div className="text-sm text-gray-500">期末欠款</div>
          <div className={`text-xl font-bold mt-1 ${账.期末 > 0 ? "text-red-600" : "text-gray-900"}`}>{formatCurrency(账.期末)}</div>
        </div>
      </div>

      {/* 明细表 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden print:border-black print:rounded-none">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">日期</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">类型</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">单据</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">摘要</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">应付+</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">付款−</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">余额</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 print:hidden">经办人</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* 期初行 */}
            <tr className="bg-gray-50/60 font-medium">
              <td className="px-4 py-3 text-gray-500" colSpan={6}>期初欠款</td>
              <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(账.期初)}</td>
              <td className="print:hidden"></td>
            </tr>
            {账.本期.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                  {new Date(r.created_at).toLocaleDateString("zh-CN")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      r.transaction_type === "debit" || r.transaction_type === "payment"
                        ? "bg-red-50 text-red-700"
                        : "bg-green-50 text-green-700"
                    }`}
                  >
                    {类型名[r.transaction_type] || r.transaction_type}
                  </span>
                  {r.payment_method && <span className="text-xs text-gray-400 ml-1">{r.payment_method}</span>}
                </td>
                <td className="px-4 py-3 text-xs">
                  {r.docHref && r.docNo ? (
                    <Link href={r.docHref} className="text-blue-600 hover:underline">{r.docNo}</Link>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600 text-xs">{r.description || "-"}</td>
                <td className="px-4 py-3 text-right text-red-600">
                  {r.transaction_type === "debit" ? formatCurrency(r.amount) : ""}
                </td>
                <td className="px-4 py-3 text-right text-green-600">
                  {/* 优惠也算减欠款，和付款同列展示（类型徽标区分） */}
                  {r.transaction_type === "payment" || r.transaction_type === "discount" ? formatCurrency(r.amount) : ""}
                </td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(r.余额)}</td>
                <td className="px-4 py-3 text-gray-500 text-xs print:hidden">{r.profiles?.full_name || "-"}</td>
              </tr>
            ))}
            {账.本期.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-gray-400">本期没有发生往来</td>
              </tr>
            )}
            {/* 期末行 */}
            <tr className="bg-gray-50/60 font-bold">
              <td className="px-4 py-3 text-gray-900" colSpan={6}>期末欠款</td>
              <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(账.期末)}</td>
              <td className="print:hidden"></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 打印用签字区（屏幕上隐藏） */}
      <div className="hidden print:flex justify-between mt-12 text-sm">
        <span>供方核对签字：____________</span>
        <span>需方核对签字：____________</span>
        <span>日期：____年____月____日</span>
      </div>
    </div>
  );
}
