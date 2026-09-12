"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { 退回已入库 } from "@/app/procurement/actions";
import { PriceValue } from "@/components/PriceVisibilityContext";
import { useConfirm } from "./ConfirmDialog";
import { DocumentNameInput } from "./DocumentNameInput";

interface PurchaseOrderItem {
  id: string;
  name: string;
  brand: string | null;
  specification: string | null;
  quantity: number;
  unit_cost: number | null;
  received_qty: number | null;
  part_id: string | null;
  work_order_item_part_id: string | null;
  part_number: string | null;
  supplier_part_name: string | null;
  unit: string | null;
  category: string | null;
  license_plate: string | null;
  photos: string[] | null;
  notes: string | null;
}

interface InboundOrder {
  id: string;
  inbound_no: string;
  total_quantity: number;
  total_amount: number | null;
  created_at: string;
}

/* 订单类型导出给采购看板 page.tsx：服务端首屏查询结果作为 props 传入用（待办清单第9项） */
export interface PurchaseOrder {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  status: string;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
  suppliers: { id: string; name: string } | null;
  purchase_order_items: PurchaseOrderItem[];
  inbound_orders: InboundOrder[] | null;
}

/* 首屏数据 props（服务端查询注入，待办清单第9项）：
   有 initialOrders 时首屏直接渲染、跳过 useEffect 里的 loadData，
   避免 SPA 软导航时 session 未就绪导致整页空白；后续操作照常走 loadData 刷新 */
interface CompletedStorageListProps {
  initialOrders?: PurchaseOrder[];
}

export function CompletedStorageList(props: CompletedStorageListProps) {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [orders, setOrders] = useState<PurchaseOrder[]>(props.initialOrders ?? []);
  const [loading, setLoading] = useState(!props.initialOrders);
  const [submitting, setSubmitting] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_orders")
      .select(
        `
        id, order_no, supplier_id, status, total_amount, notes, created_at,
        suppliers(id, name),
        purchase_order_items(
          id, name, brand, specification, quantity, unit_cost, received_qty,
          part_id, work_order_item_part_id, part_number, supplier_part_name,
          unit, category, license_plate, photos, notes
        ),
        inbound_orders(id, inbound_no, total_quantity, total_amount, created_at)
      `
      )
      .eq("status", "completed")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("加载已入库采购单失败:", error);
      setLoading(false);
      return;
    }

    setOrders((data || []) as unknown as PurchaseOrder[]);
    setLoading(false);
  }

  useEffect(() => {
    /* 服务端已给首屏数据则跳过首次查询，避免重复拉取 */
    if (props.initialOrders) return;
    loadData();

  }, []);

  /* 撤销已入库→退回待入库（2026-09-13 用户拍板新语义）：
     只倒退一步——扣回库存、删除入库单，收货处理结果全部保留；
     蓝卡流程单单回滚，黄卡流程整批回滚（RPC revoke_completed_inbound 新语义） */
  async function handleRevokeCompleted(orderId: string) {
    setSubmitting(`revoke-${orderId}`);
    try {
      /* 1. 只读预查：明细是否挂批次（黄卡=整批回滚）+ 入库单号（文案展示） */
      const { data: 明细们 } = await supabase
        .from("purchase_order_items")
        .select("receiving_batch_id")
        .eq("order_id", orderId);
      const 批次ids = [...new Set(
        ((明细们 || []) as { receiving_batch_id: string | null }[])
          .map((m) => m.receiving_batch_id)
          .filter((x): x is string => !!x)
      )];

      let 批次文案 = "";
      let 涉及单数 = 1;
      if (批次ids.length > 0) {
        const { data: 批次们 } = await supabase
          .from("receiving_batches")
          .select("id, batch_no")
          .in("id", 批次ids);
        const { data: 涉及明细 } = await supabase
          .from("purchase_order_items")
          .select("order_id")
          .in("receiving_batch_id", 批次ids);
        涉及单数 = new Set(((涉及明细 || []) as { order_id: string }[]).map((m) => m.order_id)).size;
        批次文案 = ((批次们 || []) as { batch_no: string }[]).map((b) => b.batch_no).join("、");
      }

      const { data: inboundOrderList } = await supabase
        .from("inbound_orders")
        .select("id, inbound_no")
        .eq("purchase_order_id", orderId)
        .eq("status", "completed");

      /* 2. 组装确认文案（新语义：只删入库单和库存，收货结果保留，不删待退货记录） */
      const 入库单文案 = inboundOrderList && inboundOrderList.length > 0
        ? `（${inboundOrderList.map((o) => o.inbound_no).join("、")}）`
        : "";
      const msg = 批次ids.length > 0
        ? `该单随批次 ${批次文案} 一起入库（共 ${涉及单数} 张采购单）。\n` +
          `撤销将【整批回滚】：扣回库存、删除入库单${入库单文案}，` +
          `${涉及单数 > 1 ? `全部 ${涉及单数} 张采购单` : "该单"}退回「待入库」。\n` +
          `收货结果（处理动作/数量）全部保留，是否继续？`
        : `撤销后将扣回库存、删除入库单${入库单文案}，该单退回「待入库」。\n` +
          `收货结果（处理动作/数量）全部保留，是否继续？`;
      if (!(await 请求确认(msg))) {
        setSubmitting(null);
        return;
      }

      /* 3. 回滚由数据库事务完成：扣回库存/仓位、删入库单/库存批次/流水/应付款，
         采购单（黄卡含整批）回 pending_storage；任一失败整体回滚 */
      const res = await 退回已入库(orderId);
      if (!res.success) throw new Error(res.error || "撤销失败");

      loadData();
    } catch (err: unknown) {
      alert("撤销失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  const displayGroups = useMemo(() => {
    const map = new Map<string, PurchaseOrder[]>();
    for (const o of orders) {
      const key = o.suppliers?.name || "未指定供应商";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([key, list]) => ({ key, orders: list }));
  }, [orders]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        加载中...
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        暂无已入库的采购单
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {displayGroups.map((g) => (
        /* 分组卡片：与待采购页统一风格（2026-08-15）——左侧蓝竖条+蓝色标签+加粗组名 */
        <div key={g.key} className="bg-white rounded-xl border border-gray-200 border-l-4 border-l-blue-500 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 flex items-center">
                <span className="inline-block px-2 py-0.5 rounded bg-blue-600 text-white mr-2 text-[10px] font-bold">供应商</span>
                <span className="font-bold text-gray-900">{g.key}</span>
              </h3>
              <span className="text-xs text-gray-500">共 {g.orders.length} 张采购单</span>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {g.orders.map((order) => (
              <div key={order.id} className="px-6 py-4">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <Link
                    href={`/procurement/${order.id}`}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {order.order_no || order.id.slice(0, 8)}
                  </Link>
                  <span className="text-xs text-gray-500">
                    {new Date(order.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-gray-500">
                    {order.purchase_order_items.length} 项 · <PriceValue value={order.total_amount} />
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                    已入库
                  </span>
                  {order.inbound_orders && order.inbound_orders.length > 0 ? (
                    order.inbound_orders.map((io) => (
                      <Link
                        key={io.id}
                        href={`/inbound-orders/${io.id}`}
                        className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:text-blue-700"
                      >
                        入库单:{io.inbound_no}
                      </Link>
                    ))
                  ) : (
                    <span className="text-xs text-gray-400">暂无入库单</span>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-gray-100 rounded-lg">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 w-10">序号</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">零件编码</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">商品名称</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">单据名称</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500 w-14">数量</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 w-12">单位</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">分类</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">车牌</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-500 w-32">到货数量</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {order.purchase_order_items.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                          <td className="px-3 py-2 text-gray-700">{item.part_number || "-"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="text-gray-900 font-medium">{item.name}</div>
                            {item.brand || item.specification ? (
                              <div className="text-xs text-gray-400">
                                {item.brand || ""} {item.specification || ""}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            <DocumentNameInput 采购明细id={item.id} 初始值={item.supplier_part_name || ""} 保存后={loadData} />
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{item.quantity}</td>
                          <td className="px-3 py-2 text-gray-500">{item.unit || "-"}</td>
                          <td className="px-3 py-2 text-gray-500">{item.category || "-"}</td>
                          <td className="px-3 py-2 text-gray-500">{item.license_plate || "-"}</td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                              {item.received_qty || 0} / {item.quantity}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleRevokeCompleted(order.id)}
                    disabled={submitting === `revoke-${order.id}`}
                    className="px-3 py-1.5 border border-orange-200 text-orange-600 bg-orange-50 text-sm font-medium rounded-lg hover:bg-orange-100 transition-colors disabled:opacity-50"
                  >
                    {submitting === `revoke-${order.id}` ? "处理中..." : "退回待入库"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {确认弹窗}
    </div>
  );
}
