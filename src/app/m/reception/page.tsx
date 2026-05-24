"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface Order {
  id: string;
  order_no: string;
  status: string;
  received_at: string;
  mileage_in: number | null;
  fuel_level: number | null;
  vehicles: { plate_number: string; brand: string; model: string } | null;
  customers: { name: string; phone: string } | null;
}

const statusLabel: Record<string, string> = {
  received: "已接车",
  pending_diagnosis: "待诊断",
  pending_repair: "待维修",
  repairing: "维修中",
  pending_quality_check: "待质检",
  pending_close: "待结算",
  pending_settlement: "待结算",
  settled: "已结算",
  delivered: "已交车",
};

const statusColor: Record<string, string> = {
  received: "bg-blue-50 text-blue-700",
  pending_diagnosis: "bg-orange-50 text-orange-700",
  pending_repair: "bg-yellow-50 text-yellow-700",
  repairing: "bg-green-50 text-green-700",
  pending_quality_check: "bg-purple-50 text-purple-700",
  pending_close: "bg-gray-50 text-gray-700",
  pending_settlement: "bg-gray-50 text-gray-700",
  settled: "bg-gray-50 text-gray-500",
  delivered: "bg-gray-50 text-gray-400",
};

const SETTLED_STATUSES = ["settled", "delivered"];

export default function MobileReceptionListPage() {
  const supabase = createClient();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilter, setShowFilter] = useState(false);
  const [plateFilter, setPlateFilter] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("work_orders")
        .select(
          "id, order_no, status, received_at, mileage_in, fuel_level, vehicles(plate_number, brand, model), customers(name, phone)"
        )
        .not("status", "in", `(${SETTLED_STATUSES.join(",")})`)
        .neq("order_type", "cancelled")
        .order("created_at", { ascending: false });
      setOrders((data || []) as Order[]);
      setLoading(false);
    }
    load();
  }, [supabase]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const plate = order.vehicles?.plate_number || "";
      const brand = order.vehicles?.brand || "";
      const model = order.vehicles?.model || "";
      const phone = order.customers?.phone || "";

      if (plateFilter && !plate.toLowerCase().includes(plateFilter.toLowerCase())) return false;
      if (vehicleFilter) {
        const vehicleText = `${brand} ${model}`.toLowerCase();
        if (!vehicleText.includes(vehicleFilter.toLowerCase())) return false;
      }
      if (phoneFilter && !phone.includes(phoneFilter)) return false;
      return true;
    });
  }, [orders, plateFilter, vehicleFilter, phoneFilter]);

  return (
    <div className="flex flex-col pb-20">
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 px-4 py-3 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-gray-900">接车登记</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">共 {filteredOrders.length} 单</span>
            <button
              onClick={() => setShowFilter((v) => !v)}
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${showFilter ? "bg-blue-50 text-blue-600" : "text-gray-500 hover:text-blue-600"}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </button>
          </div>
        </div>

        {showFilter && (
          <div className="space-y-2 pt-1 pb-1">
            <input
              type="text"
              value={plateFilter}
              onChange={(e) => setPlateFilter(e.target.value)}
              placeholder="车牌号"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={vehicleFilter}
              onChange={(e) => setVehicleFilter(e.target.value)}
              placeholder="品牌车型"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              inputMode="numeric"
              value={phoneFilter}
              onChange={(e) => setPhoneFilter(e.target.value.replace(/\D/g, ""))}
              placeholder="客户手机"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {(plateFilter || vehicleFilter || phoneFilter) && (
              <button
                onClick={() => {
                  setPlateFilter("");
                  setVehicleFilter("");
                  setPhoneFilter("");
                }}
                className="w-full py-2 text-sm text-gray-500 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                清空筛选
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 p-3 space-y-3">
        {loading ? (
          <div className="text-center text-gray-400 py-12 text-sm">加载中...</div>
        ) : filteredOrders.length > 0 ? (
          filteredOrders.map((order) => (
            <Link
              key={order.id}
              href={`/work-orders/${order.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-3 space-y-2 active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-900">
                  {order.vehicles?.plate_number || "无车牌"}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${statusColor[order.status] || "bg-gray-50 text-gray-600"}`}>
                  {statusLabel[order.status] || order.status}
                </span>
              </div>
              <div className="text-sm text-gray-600">
                {order.customers?.name} · {order.customers?.phone}
              </div>
              <div className="text-xs text-gray-400 flex items-center gap-3">
                <span>
                  {order.vehicles?.brand} {order.vehicles?.model}
                </span>
              </div>
              <div className="text-xs text-gray-400 flex items-center gap-3">
                <span>里程: {order.mileage_in} km</span>
                {order.fuel_level != null && <span>油量: {order.fuel_level}%</span>}
              </div>
            </Link>
          ))
        ) : (
          <div className="text-center text-gray-400 py-12 text-sm">
            {orders.length > 0 ? "没有匹配的工单" : "暂无在厂车辆"}
          </div>
        )}
      </div>

    </div>
  );
}
