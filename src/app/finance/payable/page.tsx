import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import ApPaymentCell from "./ApPaymentCell";

/* 应付记录（含关联供应商与采购单） */
interface 应付记录 {
  id: string;
  status: string;
  amount: number | null;
  paid_amount: number | null;
  due_date: string | null;
  notes: string | null;
  suppliers: { name: string | null; contact: string | null } | null;
  purchase_orders: { order_no: string | null; total_amount: number | null } | null;
}

export default async function PayablePage({ searchParams }: { searchParams?: Promise<{ page?: string; all?: string; q?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();

  /* 列表分页（每页 50 条，数据库层取数）；
   * 汇总卡片需要全量总额——单独查一趟只取两个金额列（不带关联、不带其他字段），数据量很小 */
  const page = Math.max(1, parseInt(params?.page || "1", 10) || 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  /* 2026-09-16 批次6：采购应付汇总表默认"只看有欠款"，?all=1 显示全部有往来的 */
  const 只看有欠款 = params?.all !== "1";
  const 搜索词 = (params?.q || "").trim();

  const [{ data: items, count }, { data: 金额行 }, { data: 供应商余额 }, { data: 物流余额 }, { data: 账户列表 }, { data: 支付方式列表 }] = await Promise.all([
    supabase
      .from("accounts_payable")
      .select("*, suppliers(name, contact), purchase_orders(order_no, total_amount)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1),
    supabase.from("accounts_payable").select("amount, paid_amount"),
    /* 2026-09-15 批次4：采购应付/物流应付全口径（此前这页只有外包应付）
       2026-09-16 批次6：供应商汇总加累计列（入库数/进货/已付/退货） */
    supabase.rpc("supplier_balances"),
    supabase.rpc("logistics_company_balances"),
    /* 2026-09-16 销账闭环：外包付款弹窗要用的资金账户和支付方式 */
    supabase.from("finance_accounts").select("id, name").eq("is_active", true).order("name"),
    supabase.from("payment_methods").select("code, name").eq("is_active", true).order("sort_order"),
  ]);

  interface 供应商汇总行 {
    supplier_id: string;
    supplier_name: string;
    balance: number;
    inbound_count: number;
    total_debit: number;
    total_payment: number;
    total_credit: number;
    /* 2026-09-16 批次7：累计优惠（抹零） */
    total_discount: number;
  }

  /* 汇总表：默认只看有欠款；搜索词按名称模糊过滤 */
  const 采购汇总 = ((供应商余额 || []) as 供应商汇总行[])
    .filter((r) => (只看有欠款 ? Number(r.balance) > 0.004 : Number(r.inbound_count) > 0 || Number(r.total_payment) > 0))
    .filter((r) => !搜索词 || r.supplier_name.includes(搜索词));
  const 采购应付合计 = ((供应商余额 || []) as 供应商汇总行[])
    .filter((r) => Number(r.balance) > 0.004)
    .reduce((s, r) => s + Number(r.balance), 0);
  const 物流欠款 = ((物流余额 || []) as { company_id: string; company_name: string; balance: number }[])
    .filter((r) => Number(r.balance) > 0.004);
  const 物流应付合计 = 物流欠款.reduce((s, r) => s + Number(r.balance), 0);

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));

  const statusMap: Record<string, { label: string; class: string }> = {
    pending: { label: "待付款", class: "bg-yellow-50 text-yellow-700" },
    partial: { label: "部分付款", class: "bg-blue-50 text-blue-700" },
    paid: { label: "已结清", class: "bg-green-50 text-green-700" },
    cancelled: { label: "已取消", class: "bg-gray-50 text-gray-600" },
  };

  const totalAmount = 金额行?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0;
  const totalPaid = 金额行?.reduce((sum, r) => sum + (r.paid_amount || 0), 0) || 0;
  const totalPending = totalAmount - totalPaid;

  return (
    <div className="space-y-6">
      <PageHeader title="应付账款" description="采购货款、物流运费、外包费用的全口径应付" />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">采购应付（供应商欠款）</div>
          <div className="text-xl font-bold text-red-600 mt-1">{formatCurrency(采购应付合计)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">物流应付（未结运费）</div>
          <div className="text-xl font-bold text-red-600 mt-1">{formatCurrency(物流应付合计)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">外包应付（未付部分）</div>
          <div className="text-xl font-bold text-red-600 mt-1">{formatCurrency(totalPending)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">应付合计</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(采购应付合计 + 物流应付合计 + totalPending)}</div>
        </div>
      </div>

      {/* 采购应付：按供应商汇总（批次6 参考1号车间：累计列+只看有欠款+搜索） */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-gray-900">采购应付（按供应商汇总）</h3>
          <form action="/finance/payable" method="get" className="flex items-center gap-2 ml-auto">
            {只看有欠款 ? null : <input type="hidden" name="all" value="1" />}
            <input
              type="text"
              name="q"
              defaultValue={搜索词}
              placeholder="搜供应商名称..."
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-40"
            />
            <button type="submit" className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">查询</button>
            <Link
              href={只看有欠款 ? "/finance/payable?all=1" : "/finance/payable"}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              {只看有欠款 ? "显示全部" : "只看有欠款"}
            </Link>
            <Link href="/supplier-payments" className="px-3 py-1.5 text-sm text-blue-600 hover:underline">去付款</Link>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">供应商</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">剩余欠款</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">入库单数</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">累计进货</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">累计已付</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">累计优惠</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">累计退货</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {采购汇总.map((r) => (
                <tr key={r.supplier_id} className="hover:bg-gray-50">
                  <td className="px-4 py-4">
                    <Link href={`/suppliers/${r.supplier_id}`} className="font-medium text-blue-600 hover:underline">
                      {r.supplier_name}
                    </Link>
                  </td>
                  <td className={`px-4 py-4 text-right font-medium ${Number(r.balance) > 0.004 ? "text-red-600" : "text-gray-400"}`}>
                    {formatCurrency(Number(r.balance))}
                  </td>
                  <td className="px-4 py-4 text-right text-gray-600">{r.inbound_count}</td>
                  <td className="px-4 py-4 text-right text-gray-900">{formatCurrency(Number(r.total_debit))}</td>
                  <td className="px-4 py-4 text-right text-green-600">{formatCurrency(Number(r.total_payment))}</td>
                  <td className="px-4 py-4 text-right text-orange-600">{formatCurrency(Number(r.total_discount))}</td>
                  <td className="px-4 py-4 text-right text-gray-600">{formatCurrency(Number(r.total_credit))}</td>
                  <td className="px-4 py-4 text-right space-x-3">
                    <Link href={`/suppliers/${r.supplier_id}/statement`} className="text-xs text-gray-600 hover:underline">对账单</Link>
                    <Link href={`/supplier-payments?supplier_id=${r.supplier_id}&new=1`} className="text-xs text-green-600 hover:underline">去付款</Link>
                  </td>
                </tr>
              ))}
              {采购汇总.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-400">
                    {只看有欠款 ? "供应商货款不欠了" : "没有匹配的供应商"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 物流应付：按公司列未结运费 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">物流应付（按公司）</h3>
          <Link href="/logistics" className="text-sm text-blue-600 hover:underline">去结算</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">物流公司</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">未结运费</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {物流欠款.map((r) => (
                <tr key={r.company_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{r.company_name}</td>
                  <td className="px-6 py-4 text-right font-medium text-red-600">{formatCurrency(Number(r.balance))}</td>
                  <td className="px-6 py-4 text-right">
                    <Link href={`/logistics/${r.company_id}/statement`} className="text-xs text-gray-600 hover:underline">对账单</Link>
                  </td>
                </tr>
              ))}
              {物流欠款.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-gray-400">运费都结清了</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 外包应付（原 accounts_payable 列表） */}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">外包应付（按单据）</h3>
          <span className="text-xs text-gray-500">
            总额 {formatCurrency(totalAmount)} / 已付 {formatCurrency(totalPaid)}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">供应商</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">采购单</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">应付金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">已付金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">未付金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">到期日</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items?.map((r: 应付记录) => {
                const s = statusMap[r.status] || { label: r.status, class: "bg-gray-50 text-gray-600" };
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{r.suppliers?.name || "-"}</div>
                      <div className="text-xs text-gray-500">{r.suppliers?.contact || "-"}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{r.purchase_orders?.order_no || "-"}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">{formatCurrency(r.amount)}</td>
                    <td className="px-6 py-4 text-green-600">{formatCurrency(r.paid_amount)}</td>
                    <td className="px-6 py-4 text-red-600 font-medium">{formatCurrency((r.amount ?? 0) - (r.paid_amount ?? 0))}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${s.class}`}>{s.label}</span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">{r.due_date ? formatDate(r.due_date) : "-"}</td>
                    <td className="px-6 py-4 text-gray-500">{r.notes || "-"}</td>
                    <td className="px-6 py-4 text-right">
                      <ApPaymentCell
                        payableId={r.id}
                        单据名={`${r.suppliers?.name || "外包"} · ${r.notes || "应付单"}`}
                        未付金额={(r.amount ?? 0) - (r.paid_amount ?? 0)}
                        状态={r.status}
                        accounts={账户列表 || []}
                        paymentMethods={支付方式列表 || []}
                      />
                    </td>
                  </tr>
                );
              })}
              {(!items || items.length === 0) && (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-400">暂无应付账款</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页 */}
      <div className="flex items-center justify-center gap-2">
        <Link
          href={`/finance/payable?page=${Math.max(1, page - 1)}`}
          className={`px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
        >
          上一页
        </Link>
        <span className="text-sm text-gray-600 px-2">
          {page} / {totalPages}（共 {count ?? 0} 条）
        </span>
        <Link
          href={`/finance/payable?page=${Math.min(totalPages, page + 1)}`}
          className={`px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
        >
          下一页
        </Link>
      </div>
    </div>
  );
}
