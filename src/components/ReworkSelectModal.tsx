"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Props {
  vehicleId: string;
  onSelect: (sourceItem: any, unlockOrder: boolean) => void;
  onClose: () => void;
}

export function ReworkSelectModal({ vehicleId, onSelect, onClose }: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [unlockOrder, setUnlockOrder] = useState(false);

  useEffect(() => {
    if (!vehicleId) return;
    supabase
      .from("work_orders")
      .select("*, customers(name)")
      .eq("vehicle_id", vehicleId)
      .in("status", ["completed", "settled", "delivered"])
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setOrders(data || []);
        setLoading(false);
      });
  }, [vehicleId, supabase]);

  useEffect(() => {
    if (!selectedOrderId) {
      setOrderItems([]);
      return;
    }
    supabase
      .from("work_order_items")
      .select("*, profiles(full_name)")
      .eq("work_order_id", selectedOrderId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setOrderItems(data || []);
      });
  }, [selectedOrderId, supabase]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4">
          <p className="text-sm text-gray-500">加载历史工单中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
        <h3 className="text-base font-semibold text-gray-900 mb-1">选择返工来源</h3>
        <p className="text-xs text-gray-500 mb-4">请选择该车辆之前工单中需要返工的原始项目</p>

        <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
          {/* 左侧：历史工单 */}
          <div className="w-1/2 border border-gray-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
              历史工单 ({orders.length})
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {orders.length === 0 && (
                <p className="text-sm text-gray-400 p-2">暂无已完工工单</p>
              )}
              {orders.map((o: any) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelectedOrderId(o.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    selectedOrderId === o.id
                      ? "bg-blue-50 border border-blue-200 text-blue-800"
                      : "hover:bg-gray-50 border border-transparent"
                  }`}
                >
                  <div className="font-medium">{o.order_no}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {o.customers?.name} · {formatDate(o.created_at)} · {o.status === 'settled' ? '已结算' : o.status === 'delivered' ? '已交付' : '已完成'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 右侧：项目列表 */}
          <div className="w-1/2 border border-gray-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
              工单项目
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {!selectedOrderId && (
                <p className="text-sm text-gray-400 p-2">请先选择左侧工单</p>
              )}
              {selectedOrderId && orderItems.length === 0 && (
                <p className="text-sm text-gray-400 p-2">该工单暂无项目</p>
              )}
              {orderItems.map((it: any) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onSelect({ id: it.id, name: it.name, unit_price: it.unit_price, work_order_id: it.work_order_id }, unlockOrder)}
                  className="w-full text-left px-3 py-2 rounded text-sm hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-colors"
                >
                  <div className="font-medium text-gray-800">{it.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                    <span>{it.item_type === 'labor' ? '工时' : it.item_type === 'part' ? '配件' : '其他'}</span>
                    <span>× {it.quantity}</span>
                    <span className="font-medium text-gray-600">{formatCurrency(it.total_price)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={unlockOrder}
              onChange={(e) => setUnlockOrder(e.target.checked)}
              className="rounded"
            />
            同时解锁原工单（允许修改）
          </label>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
