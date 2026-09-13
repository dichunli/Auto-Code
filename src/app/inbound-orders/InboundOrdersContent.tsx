"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/lib/useDebounce";
import type { 列表明细行 } from "./page";

interface InboundOrder {
  id: string;
  inbound_no: string;
  supplier_name: string | null;
  total_quantity: number;
  total_amount: number | null;
  freight_amount: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  purchase_orders: { order_no: string | null } | null;
}

const PAGE_SIZE = 15;

export default function InboundOrdersContent({
  initialRecords,
  initialItems,
}: {
  initialRecords: InboundOrder[];
  initialItems: 列表明细行[];
}) {
  const router = useRouter();
  const [orders] = useState<InboundOrder[]>(initialRecords);
  const [loading] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  /* 商品信息搜索（2026-09-13）：匹配明细行的 名称/编码/条形码/车牌，命中则显示该入库单 */
  const [商品搜索, set商品搜索] = useState("");
  const 防抖商品搜索 = useDebounce(商品搜索, 300).trim().toLowerCase();
  /* 发起退货：弹窗列出该入库单的商品行，选一个跳到采购退货页并自动带出 */
  const [退货弹窗单, set退货弹窗单] = useState<InboundOrder | null>(null);

  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.supplier_name) set.add(o.supplier_name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh"));
  }, [orders]);

  /* 明细按入库单分组：商品筛选和退货弹窗共用 */
  const 明细按单分组 = useMemo(() => {
    const map = new Map<string, 列表明细行[]>();
    for (const 行 of initialItems) {
      const list = map.get(行.inbound_order_id) || [];
      list.push(行);
      map.set(行.inbound_order_id, list);
    }
    return map;
  }, [initialItems]);

  const filteredOrders = useMemo(() => {
    let list = orders;

    // 按供应商筛选
    if (supplierFilter) {
      list = list.filter((o) => o.supplier_name === supplierFilter);
    }

    // 按日期范围筛选
    if (dateFrom) {
      list = list.filter((o) => o.created_at >= `${dateFrom}T00:00:00`);
    }
    if (dateTo) {
      list = list.filter((o) => o.created_at <= `${dateTo}T23:59:59`);
    }

    // 按商品信息筛选（名称/编码/条形码/车牌 任一命中即保留该单）
    if (防抖商品搜索) {
      list = list.filter((o) =>
        (明细按单分组.get(o.id) || []).some((行) =>
          [行.name, 行.part_number, 行.parts?.barcode, 行.purchase_order_items?.license_plate]
            .some((字段) => (字段 || "").toLowerCase().includes(防抖商品搜索))
        )
      );
    }

    return list;
  }, [orders, supplierFilter, dateFrom, dateTo, 防抖商品搜索, 明细按单分组]);

  // 筛选条件变化时重置页码
  useEffect(() => {
    setPage(1);
  }, [supplierFilter, dateFrom, dateTo, 防抖商品搜索]);

  const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE) || 1;
  const pagedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* 退货弹窗里的商品行（按当前选中的入库单取） */
  const 退货弹窗行们 = 退货弹窗单 ? 明细按单分组.get(退货弹窗单.id) || [] : [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">入库单列表</h1>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* 商品信息搜索（2026-09-13）：名称/编码/条形码/车牌 任一命中即显示该单 */}
      <div className="mb-4">
        <input
          type="text"
          value={商品搜索}
          onChange={(e) => set商品搜索(e.target.value)}
          placeholder="搜索商品：名称 / 编码 / 条形码 / 关联车牌"
          className="w-full max-w-md px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      {supplierOptions.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mb-4">
          <span className="text-xs text-gray-500">供应商:</span>
          <button
            type="button"
            onClick={() => setSupplierFilter(null)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              supplierFilter === null
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white border-gray-200 text-gray-600 hover:border-blue-400"
            }`}
          >
            全部
          </button>
          {supplierOptions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSupplierFilter(name)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                supplierFilter === name
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white border-gray-200 text-gray-600 hover:border-blue-400"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          加载中...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          暂无入库单
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">入库单号</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">关联采购单</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">供应商</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">总数量</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">总金额</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">运费</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">日期</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagedOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-blue-600">
                      <Link href={`/inbound-orders/${o.id}`} className="hover:text-blue-700">
                        {o.inbound_no}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {o.purchase_orders?.order_no || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{o.supplier_name || "-"}</td>
                    <td className="px-6 py-4 text-right text-gray-900">{o.total_quantity}</td>
                    <td className="px-6 py-4 text-right text-gray-900">
                      {o.total_amount != null ? `¥${o.total_amount.toFixed(2)}` : "-"}
                    </td>
                    <td className="px-6 py-4 text-right text-gray-600">
                      {o.freight_amount != null ? `¥${o.freight_amount.toFixed(2)}` : "-"}
                    </td>
                    <td className="px-6 py-4">
                      {o.status === "draft" ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">待确认</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                          {o.status === "completed" ? "已完成" : o.status}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(o.created_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/inbound-orders/${o.id}`}
                          className="text-xs text-blue-600 hover:text-blue-700"
                        >
                          查看详情
                        </Link>
                        {/* 发起退货（2026-09-13）：仅已完成的单可退；待确认单先完成入库再说 */}
                        {o.status === "completed" && (
                          <button
                            type="button"
                            onClick={() => set退货弹窗单(o)}
                            className="text-xs text-orange-600 hover:text-orange-700"
                          >
                            退货
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                共 {filteredOrders.length} 条，第 {page}/{totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => setPage(page + 1)}
                  disabled={page === totalPages}
                  className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 发起退货弹窗（2026-09-13）：列出该单商品，选一个带到采购退货页（批次在退货页按库存剩余选） */}
      {退货弹窗单 && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl my-8">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">发起退货 — 选择商品</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  入库单 {退货弹窗单.inbound_no} · {退货弹窗单.supplier_name || "-"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => set退货弹窗单(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
              {退货弹窗行们.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">该入库单没有商品明细</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="py-2 pr-3 font-medium">商品名称</th>
                      <th className="py-2 pr-3 font-medium">编码</th>
                      <th className="py-2 pr-3 font-medium text-right">数量</th>
                      <th className="py-2 pr-3 font-medium">车牌</th>
                      <th className="py-2 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {退货弹窗行们.map((行) => (
                      <tr key={行.id}>
                        <td className="py-2.5 pr-3 text-gray-900">{行.name || "-"}</td>
                        <td className="py-2.5 pr-3 text-gray-600">{行.part_number || "-"}</td>
                        <td className="py-2.5 pr-3 text-right text-gray-900">{行.quantity}</td>
                        <td className="py-2.5 pr-3 text-gray-600">
                          {行.purchase_order_items?.license_plate || "-"}
                        </td>
                        <td className="py-2.5 text-right">
                          {行.part_id ? (
                            <button
                              type="button"
                              onClick={() =>
                                router.push(
                                  `/inventory/returns/new?partId=${行.part_id}&qty=${行.quantity}`
                                )
                              }
                              className="text-xs px-2.5 py-1 text-orange-600 border border-orange-200 rounded hover:bg-orange-50"
                            >
                              去退货
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400" title="未关联配件档案，请到退货页手工选择">
                              未关联配件
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => set退货弹窗单(null)}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
