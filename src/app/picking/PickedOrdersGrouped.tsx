"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

/* 已领料单（picking_orders 联查工单/车辆/操作人） */
export interface 已领料单 {
  id: string;
  picking_no: string;
  status: string;
  total_quantity: number;
  receiver_name: string | null;
  created_at: string;
  work_orders: {
    id: string;
    order_no: string;
    vehicles: { plate_number: string; vehicle_model_id: number | null; brand: string | null; model: string | null } | null;
  } | null;
  profiles: { full_name: string | null } | null;
}

/* 领料明细行（picking_order_items） */
export interface 领料明细行 {
  id: string;
  picking_order_id: string;
  name: string | null;
  part_number: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  batch_no: string | null;
  quantity: number;
}

interface Props {
  initialRecords: 已领料单[];
  明细列表: 领料明细行[];
  /* 工单id → 车型信息文本（服务端拼好，车型库优先、车辆档案 brand/model 兜底） */
  车型By工单: Record<string, string>;
}

const 每页工单数 = 10;

/* 已领料：三级层级展示（2026-09-09 用户拍板）
   一级 工单（车牌+车型）→ 二级 领料单（单号/领料人/退料按钮）→ 三级 领料明细 */
export function PickedOrdersGrouped({ initialRecords, 明细列表, 车型By工单 }: Props) {
  const [keyword, setKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  /* 明细按领料单预分组 */
  const 明细By单 = useMemo(() => {
    const map: Record<string, 领料明细行[]> = {};
    for (const it of 明细列表) {
      if (!map[it.picking_order_id]) map[it.picking_order_id] = [];
      map[it.picking_order_id].push(it);
    }
    return map;
  }, [明细列表]);

  const 过滤后 = useMemo(() => {
    let list = initialRecords;
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (o) =>
          o.picking_no.toLowerCase().includes(kw) ||
          (o.work_orders?.order_no || "").toLowerCase().includes(kw) ||
          (o.work_orders?.vehicles?.plate_number || "").toLowerCase().includes(kw) ||
          (o.receiver_name || "").toLowerCase().includes(kw)
      );
    }
    if (dateFrom) list = list.filter((o) => o.created_at >= `${dateFrom}T00:00:00`);
    if (dateTo) list = list.filter((o) => o.created_at <= `${dateTo}T23:59:59`);
    return list;
  }, [initialRecords, keyword, dateFrom, dateTo]);

  /* 筛选条件变化时重置页码 */
  useEffect(() => {
    setPage(1);
  }, [keyword, dateFrom, dateTo]);

  /* 一级：按工单分组 */
  const 工单组 = useMemo(() => {
    const map = new Map<string, { 工单id: string; 工单号: string; 车牌: string; 单列表: 已领料单[] }>();
    for (const o of 过滤后) {
      const wo = o.work_orders;
      const key = wo?.id || "no_order";
      const 已有 = map.get(key);
      if (已有) {
        已有.单列表.push(o);
      } else {
        map.set(key, {
          工单id: key,
          工单号: wo?.order_no || "未关联工单",
          车牌: wo?.vehicles?.plate_number || "-",
          单列表: [o],
        });
      }
    }
    return Array.from(map.values());
  }, [过滤后]);

  const 总页数 = Math.ceil(工单组.length / 每页工单数) || 1;
  const 页内组 = 工单组.slice((page - 1) * 每页工单数, page * 每页工单数);

  return (
    <div>
      {/* 筛选行 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索单号 / 工单号 / 车牌 / 领料人"
          className="px-3 py-1.5 text-xs rounded border border-gray-200 w-56 focus:outline-none focus:border-blue-400"
        />
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

      {页内组.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          暂无领料单
        </div>
      ) : (
        <div className="space-y-4">
          {页内组.map((组) => (
            <div key={组.工单id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* 一级：工单（车牌大 + 车型） */}
              <div className="flex items-center gap-x-4 gap-y-1 flex-wrap px-5 py-3 bg-gray-50 border-b border-gray-100">
                {组.工单id !== "no_order" ? (
                  <Link href={`/work-orders/${组.工单id}`} className="text-sm text-blue-600 hover:text-blue-700">
                    {组.工单号}
                  </Link>
                ) : (
                  <span className="text-sm text-gray-500">{组.工单号}</span>
                )}
                <span className="text-lg font-bold text-gray-900 tracking-wide">{组.车牌}</span>
                {车型By工单[组.工单id] && (
                  <span className="text-sm text-gray-500">{车型By工单[组.工单id]}</span>
                )}
              </div>

              {/* 二级：领料单 */}
              <div className="divide-y divide-gray-100">
                {组.单列表.map((o) => (
                  <div key={o.id} className="px-5 py-3">
                    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
                      <Link
                        href={`/picking-orders/${o.id}`}
                        className="font-medium text-blue-600 hover:text-blue-700"
                      >
                        {o.picking_no}
                      </Link>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          o.status === "confirmed" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {o.status === "confirmed" ? "已出库" : "已作废"}
                      </span>
                      <span className="text-xs text-gray-500">共 {o.total_quantity} 件</span>
                      <span className="text-xs text-gray-500">领料人：{o.receiver_name || "-"}</span>
                      <span className="text-xs text-gray-500">操作人：{o.profiles?.full_name || "-"}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(o.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="flex-1" />
                      <Link
                        href={`/picking-orders/${o.id}`}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        查看/打印
                      </Link>
                      {/* 退料入口：按这张领料单开退料单（带参跳开单页） */}
                      <Link
                        href={`/material-returns/new?picking_order_id=${o.id}`}
                        className="px-2.5 py-1 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50"
                      >
                        退料
                      </Link>
                    </div>

                    {/* 三级：领料明细 */}
                    {(明细By单[o.id] || []).length > 0 && (
                      <div className="mt-2 ml-4 border-l-2 border-gray-100 pl-4">
                        <table className="w-full text-xs">
                          <tbody>
                            {(明细By单[o.id] || []).map((it) => (
                              <tr key={it.id} className="text-gray-600">
                                <td className="py-1 pr-4 text-gray-900">{it.name || "-"}</td>
                                <td className="py-1 pr-4 text-gray-400">{it.part_number || "-"}</td>
                                <td className="py-1 pr-4 text-gray-400">
                                  {[it.brand, it.specification].filter(Boolean).join(" / ")}
                                </td>
                                <td className="py-1 pr-4 text-gray-400">{it.batch_no || "-"}</td>
                                <td className="py-1 text-right text-gray-900">
                                  {it.quantity} {it.unit || "个"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页（按工单组） */}
      {总页数 > 1 && (
        <div className="flex items-center justify-between px-2 mt-4">
          <span className="text-xs text-gray-500">
            共 {工单组.length} 个工单，第 {page}/{总页数} 页
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
              disabled={page === 总页数}
              className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
