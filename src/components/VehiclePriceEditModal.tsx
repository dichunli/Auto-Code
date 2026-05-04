"use client";

import { useState, useMemo, useEffect } from "react";

interface VehiclePrice {
  id?: string;
  vehicle_model_id: number;
  vehicle_name: string;
  price: number;
  vip_price: number | null;
  customer_parts_price: number | null;
  company_price: number | null;
  发动机型号: string | null;
  底盘型号: string | null;
  变速箱型号: string | null;
  _expanded?: boolean;
}

interface VehiclePriceEditModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (prices: VehiclePrice[]) => void;
  prices: VehiclePrice[];
  onAddVehicles: (basePrice: { price: number; vip_price: number | null; customer_parts_price: number | null; company_price: number | null }) => void;
}

interface PriceGroup {
  price: number;
  vip_price: number | null;
  customer_parts_price: number | null;
  company_price: number | null;
  vehicles: VehiclePrice[];
  expanded: boolean;
}

function makePriceKey(p: { price: number; vip_price: number | null; customer_parts_price: number | null; company_price: number | null }) {
  const fmt = (v: number | null) => v === null ? "null" : v.toFixed(2);
  return `${p.price.toFixed(2)}_${fmt(p.vip_price)}_${fmt(p.customer_parts_price)}_${fmt(p.company_price)}`;
}

export default function VehiclePriceEditModal({ open, onClose, onConfirm, prices, onAddVehicles }: VehiclePriceEditModalProps) {
  const [localPrices, setLocalPrices] = useState<VehiclePrice[]>([]);
  const [filterQuery, setFilterQuery] = useState("");

  useEffect(() => {
    if (open) setLocalPrices(prices);
  }, [open, prices]);

  const groups = useMemo(() => {
    const map = new Map<string, PriceGroup>();
    for (const p of localPrices) {
      const key = makePriceKey(p);
      if (!map.has(key)) {
        map.set(key, {
          price: p.price,
          vip_price: p.vip_price,
          customer_parts_price: p.customer_parts_price,
          company_price: p.company_price,
          vehicles: [],
          expanded: false,
        });
      }
      map.get(key)!.vehicles.push(p);
    }
    return Array.from(map.values());
  }, [localPrices]);

  const filteredGroups = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        vehicles: g.vehicles.filter(
          (v) =>
            v.vehicle_name.toLowerCase().includes(q) ||
            (v.发动机型号 || "").toLowerCase().includes(q) ||
            (v.底盘型号 || "").toLowerCase().includes(q) ||
            (v.变速箱型号 || "").toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.vehicles.length > 0);
  }, [groups, filterQuery]);

  function removeVehicle(key: string, vehicleModelId: number) {
    setLocalPrices((prev) => prev.filter((p) => !(makePriceKey(p) === key && p.vehicle_model_id === vehicleModelId)));
  }

  function removeGroup(key: string) {
    setLocalPrices((prev) => prev.filter((p) => makePriceKey(p) !== key));
  }

  function handleConfirm() {
    onConfirm(localPrices);
    setFilterQuery("");
  }

  function handleClose() {
    setFilterQuery("");
    onClose();
  }

  // 添加新定价组
  const [newPrice, setNewPrice] = useState("");
  const [newVipPrice, setNewVipPrice] = useState("");
  const [newCustomerPartsPrice, setNewCustomerPartsPrice] = useState("");
  const [newCompanyPrice, setNewCompanyPrice] = useState("");

  function handleAddGroup() {
    const priceVal = newPrice === "" ? NaN : parseFloat(newPrice);
    const vipVal = newVipPrice === "" ? null : parseFloat(newVipPrice);
    const cpVal = newCustomerPartsPrice === "" ? null : parseFloat(newCustomerPartsPrice);
    const coVal = newCompanyPrice === "" ? null : parseFloat(newCompanyPrice);
    if (Number.isNaN(priceVal)) {
      alert("请输入有效的销售价");
      return;
    }
    onAddVehicles({
      price: priceVal,
      vip_price: vipVal,
      customer_parts_price: cpVal,
      company_price: coVal,
    });
    setNewPrice("");
    setNewVipPrice("");
    setNewCustomerPartsPrice("");
    setNewCompanyPrice("");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">编辑车型定价</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        {/* 添加新定价组 */}
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-700 font-medium">新增定价组：</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">销售价</label>
              <input
                type="number"
                className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                placeholder="0.00"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">VIP价</label>
              <input
                type="number"
                className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                placeholder="0.00"
                value={newVipPrice}
                onChange={(e) => setNewVipPrice(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">自带配件价</label>
              <input
                type="number"
                className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                placeholder="0.00"
                value={newCustomerPartsPrice}
                onChange={(e) => setNewCustomerPartsPrice(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">单位价</label>
              <input
                type="number"
                className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                placeholder="0.00"
                value={newCompanyPrice}
                onChange={(e) => setNewCompanyPrice(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={handleAddGroup}
              className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              添加定价组并选择车型
            </button>
          </div>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 bg-white">
          <input
            type="text"
            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="搜索车型（名称、发动机、底盘、变速箱）..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-auto px-6 py-3 space-y-4">
          {filteredGroups.length === 0 && (
            <div className="text-center text-gray-400 py-8">暂无定价组，请在上方添加</div>
          )}
          {filteredGroups.map((g) => {
            const key = makePriceKey(g);
            const allVehicles = groups.find((gg) => makePriceKey(gg) === key)?.vehicles || [];
            return (
              <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
                {/* 定价组标题 */}
                <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-medium text-gray-700">定价组</span>
                    <span className="text-gray-600">销售:<b className="text-gray-900">{g.price}</b></span>
                    <span className="text-gray-600">VIP:<b className="text-gray-900">{g.vip_price ?? "-"}</b></span>
                    <span className="text-gray-600">自带:<b className="text-gray-900">{g.customer_parts_price ?? "-"}</b></span>
                    <span className="text-gray-600">单位:<b className="text-gray-900">{g.company_price ?? "-"}</b></span>
                    <span className="text-xs text-gray-400">（{allVehicles.length} 个车型）</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setLocalPrices((prev) =>
                          prev.map((p) => {
                            if (makePriceKey(p) !== key) return p;
                            return { ...p, _expanded: !p._expanded } as any;
                          })
                        )
                      }
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      {g.expanded ? "收起" : "展开车型"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeGroup(key)}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      删除整组
                    </button>
                  </div>
                </div>

                {/* 车型列表 */}
                {g.expanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-500 w-16">ID</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">车型</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500 w-24">发动机</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500 w-24">底盘</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500 w-24">变速箱</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-500 w-16">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {g.vehicles.map((v) => (
                          <tr key={`${key}-${v.vehicle_model_id}`} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-600">{v.vehicle_model_id}</td>
                            <td className="px-3 py-2 text-gray-900">{v.vehicle_name}</td>
                            <td className="px-3 py-2 text-gray-600">{v.发动机型号 ?? "-"}</td>
                            <td className="px-3 py-2 text-gray-600">{v.底盘型号 ?? "-"}</td>
                            <td className="px-3 py-2 text-gray-600">{v.变速箱型号 ?? "-"}</td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeVehicle(key, v.vehicle_model_id)}
                                className="text-xs text-red-600 hover:text-red-700"
                              >
                                删除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center bg-gray-50">
          <span className="text-xs text-gray-500">
            共 {groups.length} 个定价组，{localPrices.length} 条车型记录
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              确认
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
