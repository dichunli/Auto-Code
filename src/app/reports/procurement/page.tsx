"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import * as XLSX from "xlsx";

interface InboundOrder {
  id: string;
  supplier_name: string | null;
  total_amount: number | null;
  total_quantity: number;
  created_at: string;
}

interface ReturnOrder {
  id: string;
  supplier_name: string | null;
  total_quantity: number;
  created_at: string;
}

interface InboundItem {
  name: string | null;
  part_number: string | null;
  quantity: number;
  unit_cost: number | null;
}

export default function ProcurementReportPage() {
  const supabase = createClient();
  const [inboundOrders, setInboundOrders] = useState<InboundOrder[]>([]);
  const [returnOrders, setReturnOrders] = useState<ReturnOrder[]>([]);
  const [inboundItems, setInboundItems] = useState<InboundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  async function loadData() {
    setLoading(true);
    let inboundQuery = supabase
      .from("inbound_orders")
      .select("id, supplier_name, total_amount, total_quantity, created_at")
      .order("created_at", { ascending: false });
    let returnQuery = supabase
      .from("purchase_return_orders")
      .select("id, supplier_name, total_quantity, created_at")
      .order("created_at", { ascending: false });
    let itemQuery = supabase
      .from("inbound_order_items")
      .select("name, part_number, quantity, unit_cost, inbound_orders!inner(created_at)")
      .order("created_at", { ascending: false });

    if (dateFrom) {
      inboundQuery = inboundQuery.gte("created_at", `${dateFrom}T00:00:00`);
      returnQuery = returnQuery.gte("created_at", `${dateFrom}T00:00:00`);
      itemQuery = itemQuery.gte("inbound_orders.created_at", `${dateFrom}T00:00:00`);
    }
    if (dateTo) {
      inboundQuery = inboundQuery.lte("created_at", `${dateTo}T23:59:59`);
      returnQuery = returnQuery.lte("created_at", `${dateTo}T23:59:59`);
      itemQuery = itemQuery.lte("inbound_orders.created_at", `${dateTo}T23:59:59`);
    }

    const [{ data: inboundData }, { data: returnData }, { data: itemData }] = await Promise.all([
      inboundQuery,
      returnQuery,
      itemQuery,
    ]);

    setInboundOrders((inboundData || []) as unknown as InboundOrder[]);
    setReturnOrders((returnData || []) as unknown as ReturnOrder[]);
    setInboundItems((itemData || []) as unknown as InboundItem[]);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 供应商采购金额排名 */
  const supplierRanking = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; qty: number; count: number }>();
    for (const o of inboundOrders) {
      const name = o.supplier_name || "未指定供应商";
      const prev = map.get(name) || { name, amount: 0, qty: 0, count: 0 };
      prev.amount += o.total_amount || 0;
      prev.qty += o.total_quantity;
      prev.count += 1;
      map.set(name, prev);
    }
    return Array.from(map.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
  }, [inboundOrders]);

  /* 配件采购排名 */
  const partRanking = useMemo(() => {
    const map = new Map<
      string,
      { name: string; partNumber: string; qty: number; amount: number; count: number }
    >();
    for (const it of inboundItems) {
      const key = it.part_number || it.name || "未知配件";
      const prev = map.get(key) || {
        name: it.name || "-",
        partNumber: it.part_number || "-",
        qty: 0,
        amount: 0,
        count: 0,
      };
      prev.qty += it.quantity;
      prev.amount += it.quantity * (it.unit_cost || 0);
      prev.count += 1;
      map.set(key, prev);
    }
    return Array.from(map.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
  }, [inboundItems]);

  /* 按月汇总 */
  const monthlySummary = useMemo(() => {
    const map = new Map<
      string,
      { month: string; inboundAmount: number; inboundQty: number; returnQty: number; returnCount: number }
    >();
    for (const o of inboundOrders) {
      const month = o.created_at.slice(0, 7);
      const prev = map.get(month) || { month, inboundAmount: 0, inboundQty: 0, returnQty: 0, returnCount: 0 };
      prev.inboundAmount += o.total_amount || 0;
      prev.inboundQty += o.total_quantity;
      map.set(month, prev);
    }
    for (const o of returnOrders) {
      const month = o.created_at.slice(0, 7);
      const prev = map.get(month) || { month, inboundAmount: 0, inboundQty: 0, returnQty: 0, returnCount: 0 };
      prev.returnQty += o.total_quantity;
      prev.returnCount += 1;
      map.set(month, prev);
    }
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [inboundOrders, returnOrders]);

  /* 采退率 */
  const totalInboundQty = useMemo(
    () => inboundOrders.reduce((sum, o) => sum + o.total_quantity, 0),
    [inboundOrders]
  );
  const totalReturnQty = useMemo(
    () => returnOrders.reduce((sum, o) => sum + o.total_quantity, 0),
    [returnOrders]
  );
  const returnRate = totalInboundQty > 0 ? (totalReturnQty / totalInboundQty) * 100 : 0;

  function handleExport() {
    const wb = XLSX.utils.book_new();

    const supplierSheet = XLSX.utils.json_to_sheet(
      supplierRanking.map((s, i) => ({
        排名: i + 1,
        供应商: s.name,
        入库次数: s.count,
        总数量: s.qty,
        总金额: s.amount,
      }))
    );
    XLSX.utils.book_append_sheet(wb, supplierSheet, "供应商排名");

    const partSheet = XLSX.utils.json_to_sheet(
      partRanking.map((p, i) => ({
        排名: i + 1,
        配件名称: p.name,
        零件编码: p.partNumber,
        入库次数: p.count,
        总数量: p.qty,
        总金额: p.amount,
      }))
    );
    XLSX.utils.book_append_sheet(wb, partSheet, "配件排名");

    const monthSheet = XLSX.utils.json_to_sheet(
      monthlySummary.map((m) => ({
        月份: m.month,
        入库金额: m.inboundAmount,
        入库数量: m.inboundQty,
        采退数量: m.returnQty,
        采退单数: m.returnCount,
      }))
    );
    XLSX.utils.book_append_sheet(wb, monthSheet, "按月汇总");

    XLSX.writeFile(wb, `采购分析报表_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="采购分析报表" description="供应商采购排名、配件采购统计与采退率分析" />

      {/* 日期筛选 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
        />
        <span className="text-xs text-gray-400">至</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
        />
        <button
          type="button"
          onClick={loadData}
          className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          查询
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={loading || inboundOrders.length === 0}
          className="px-3 py-1.5 text-xs rounded border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50"
        >
          导出Excel
        </button>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500">入库单数</div>
          <div className="text-xl font-bold text-gray-900">{inboundOrders.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500">入库总金额</div>
          <div className="text-xl font-bold text-gray-900">
            ¥{inboundOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0).toFixed(2)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500">采退单数</div>
          <div className="text-xl font-bold text-gray-900">{returnOrders.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500">采退率</div>
          <div className="text-xl font-bold text-red-600">{returnRate.toFixed(1)}%</div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">加载中...</div>
      ) : (
        <>
          {/* 图表区 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 供应商采购金额排行图 */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">供应商采购金额排行</h3>
              <div className="space-y-3">
                {supplierRanking.length === 0 && (
                  <div className="text-center text-gray-400 text-sm py-8">暂无数据</div>
                )}
                {supplierRanking.map((s) => {
                  const max = supplierRanking[0]?.amount || 1;
                  const pct = max > 0 ? (s.amount / max) * 100 : 0;
                  return (
                    <div key={s.name} className="flex items-center gap-3">
                      <div className="w-24 text-xs text-gray-600 truncate">{s.name}</div>
                      <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                        <div
                          className="bg-blue-500 h-full rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-16 text-right text-xs text-gray-900">
                        ¥{s.amount.toFixed(0)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 入库/采退数量趋势图 */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">入库/采退数量趋势</h3>
              {monthlySummary.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-8">暂无数据</div>
              ) : (
                <div className="flex items-end gap-2 h-40">
                  {(() => {
                    const maxQty = Math.max(
                      ...monthlySummary.map((x) => Math.max(x.inboundQty, x.returnQty)),
                      1
                    );
                    return monthlySummary.map((m) => {
                      const inboundH = (m.inboundQty / maxQty) * 100;
                      const returnH = (m.returnQty / maxQty) * 100;
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full flex items-end gap-0.5 h-32">
                            <div
                              className="flex-1 bg-blue-500 rounded-t"
                              style={{ height: `${inboundH}%` }}
                              title={`入库 ${m.inboundQty}`}
                            />
                            <div
                              className="flex-1 bg-red-400 rounded-t"
                              style={{ height: `${returnH}%` }}
                              title={`采退 ${m.returnQty}`}
                            />
                          </div>
                          <div className="text-[10px] text-gray-500">{m.month.slice(5)}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
              {monthlySummary.length > 0 && (
                <div className="flex items-center justify-center gap-4 mt-3">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-blue-500 rounded-sm"></div>
                    <span className="text-xs text-gray-500">入库数量</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-red-400 rounded-sm"></div>
                    <span className="text-xs text-gray-500">采退数量</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 供应商采购排名 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900">供应商采购金额排名（Top 10）</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">排名</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">供应商</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">入库次数</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">总数量</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">总金额</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {supplierRanking.map((s, idx) => (
                    <tr key={s.name} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-gray-500">{idx + 1}</td>
                      <td className="px-6 py-4 text-gray-900 font-medium">{s.name}</td>
                      <td className="px-6 py-4 text-right text-gray-600">{s.count}</td>
                      <td className="px-6 py-4 text-right text-gray-600">{s.qty}</td>
                      <td className="px-6 py-4 text-right text-gray-900 font-medium">
                        ¥{s.amount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {supplierRanking.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                        暂无数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 配件采购排名 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900">配件采购金额排名（Top 10）</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">排名</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">配件名称</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">零件编码</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">入库次数</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">总数量</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">总金额</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {partRanking.map((p, idx) => (
                    <tr key={p.partNumber + p.name} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-gray-500">{idx + 1}</td>
                      <td className="px-6 py-4 text-gray-900 font-medium">{p.name}</td>
                      <td className="px-6 py-4 text-gray-600">{p.partNumber}</td>
                      <td className="px-6 py-4 text-right text-gray-600">{p.count}</td>
                      <td className="px-6 py-4 text-right text-gray-600">{p.qty}</td>
                      <td className="px-6 py-4 text-right text-gray-900 font-medium">
                        ¥{p.amount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {partRanking.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                        暂无数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 按月汇总 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900">入库/采退按月汇总</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">月份</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">入库金额</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">入库数量</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">采退数量</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">采退单数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {monthlySummary.map((m) => (
                    <tr key={m.month} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-gray-900 font-medium">{m.month}</td>
                      <td className="px-6 py-4 text-right text-gray-900">
                        ¥{m.inboundAmount.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-600">{m.inboundQty}</td>
                      <td className="px-6 py-4 text-right text-gray-600">{m.returnQty}</td>
                      <td className="px-6 py-4 text-right text-gray-600">{m.returnCount}</td>
                    </tr>
                  ))}
                  {monthlySummary.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                        暂无数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
