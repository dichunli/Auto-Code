"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface StockLocationRow {
  id: string;
  warehouseName: string;
  location: string;
  quantity: string;
  min_stock: string;
  max_stock: string;
}

interface WarehouseItem {
  id: string;
  name: string;
}

interface LocationItem {
  id: string;
  name: string;
}

interface StockLocationSectionProps {
  value: StockLocationRow[];
  onChange: (value: StockLocationRow[]) => void;
}

export default function StockLocationSection({ value, onChange }: StockLocationSectionProps) {
  const supabase = createClient();
  const [allWarehouses, setAllWarehouses] = useState<WarehouseItem[]>([]);
  const [whResultsMap, setWhResultsMap] = useState<Record<string, WarehouseItem[]>>({});
  const [warehouseLocationMap, setWarehouseLocationMap] = useState<Record<string, LocationItem[]>>({});

  const totalQuantity = value.reduce((sum, row) => sum + (parseInt(row.quantity) || 0), 0);

  useEffect(() => {
    async function loadWarehouses() {
      const { data } = await supabase.from("warehouses").select("id, name").order("name").limit(100);
      setAllWarehouses(data || []);
    }
    loadWarehouses();
  }, [supabase]);

  function updateStockLocation(id: string, field: keyof StockLocationRow, val: string) {
    onChange(value.map((row) => (row.id === id ? { ...row, [field]: val } : row)));
  }

  async function loadLocationsForWarehouse(warehouseName: string) {
    const wh = allWarehouses.find((w) => w.name === warehouseName);
    if (!wh || warehouseLocationMap[wh.id]) return;
    const { data } = await supabase
      .from("warehouse_locations")
      .select("*")
      .eq("warehouse_id", wh.id)
      .order("name")
      .limit(100);
    setWarehouseLocationMap((prev) => ({ ...prev, [wh.id]: data || [] }));
  }

  async function createNewLocation(warehouseName: string, locationName: string) {
    const wh = allWarehouses.find((w) => w.name === warehouseName);
    if (!wh) {
      alert("请先选择仓库");
      return;
    }
    if (!locationName.trim()) return;
    const name = locationName.trim().toUpperCase().replace(/[^一-龥A-Z0-9-]/g, "");
    if (!name) {
      alert("仓位名称只能包含中文、英文、数字和-");
      return;
    }
    const { error } = await supabase.from("warehouse_locations").insert({ warehouse_id: wh.id, name });
    if (error) {
      alert("创建仓位失败：" + error.message);
      return;
    }
    await loadLocationsForWarehouse(warehouseName);
  }

  function addStockLocation() {
    onChange([
      ...value,
      {
        id: crypto.randomUUID(),
        warehouseName: "",
        location: "",
        quantity: "0",
        min_stock: "0",
        max_stock: "",
      },
    ]);
  }

  function removeStockLocation(id: string) {
    onChange(value.filter((row) => row.id !== id));
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">库存分布</h3>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-gray-700">库存分布</label>
        <span className="text-xs text-gray-500">
          合计库存：<span className="font-medium text-gray-900">{totalQuantity}</span>
        </span>
      </div>
      <div className="space-y-2">
        {value.map((row) => {
          const wh = allWarehouses.find((w) => w.name === row.warehouseName);
          const whResults = whResultsMap[row.id] || allWarehouses.filter((w) => w.name.toLowerCase().includes(row.warehouseName.toLowerCase()));
          const locList = wh ? (warehouseLocationMap[wh.id] || []) : [];
          const locResults = locList.filter((l) => l.name.toLowerCase().includes(row.location.toLowerCase()));
          const showWhDropdown = row.warehouseName && whResults.length > 0 && (!wh || wh.name !== row.warehouseName);
          const showLocDropdown = wh && row.location && locResults.length > 0;
          const showNewLoc = wh && row.location.trim() && locResults.length === 0;
          return (
            <div key={row.id} className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-start">
              <div className="relative">
                <input
                  type="text"
                  placeholder="搜索仓库"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                  value={row.warehouseName}
                  onChange={(e) => {
                    updateStockLocation(row.id, "warehouseName", e.target.value);
                    setWhResultsMap((prev) => ({
                      ...prev,
                      [row.id]: allWarehouses.filter((w) => w.name.toLowerCase().includes(e.target.value.toLowerCase())),
                    }));
                  }}
                  onBlur={() =>
                    setTimeout(() => setWhResultsMap((prev) => { const next = { ...prev }; delete next[row.id]; return next; }), 200)
                  }
                />
                {showWhDropdown && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                    {whResults.slice(0, 5).map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => {
                          updateStockLocation(row.id, "warehouseName", w.name);
                          updateStockLocation(row.id, "location", "");
                          loadLocationsForWarehouse(w.name);
                          setWhResultsMap((prev) => { const next = { ...prev }; delete next[row.id]; return next; });
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        {w.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <input
                  type="text"
                  placeholder="搜索仓位"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                  value={row.location}
                  onChange={(e) => updateStockLocation(row.id, "location", e.target.value)}
                  onFocus={() => {
                    if (row.warehouseName) loadLocationsForWarehouse(row.warehouseName);
                  }}
                  onBlur={() => setTimeout(() => {}, 200)}
                />
                {showLocDropdown && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                    {locResults.slice(0, 5).map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          updateStockLocation(row.id, "location", l.name);
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                )}
                {showNewLoc && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                    <button
                      type="button"
                      onClick={() => createNewLocation(row.warehouseName, row.location)}
                      className="w-full text-left px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
                    >
                      + 新建仓位 {'"'}{row.location}{'"'}
                    </button>
                  </div>
                )}
              </div>
              <input
                type="number"
                min={0}
                placeholder="数量"
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                value={row.quantity}
                onChange={(e) => updateStockLocation(row.id, "quantity", e.target.value)}
              />
              <input
                type="number"
                min={0}
                placeholder="安全下限"
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                value={row.min_stock}
                onChange={(e) => updateStockLocation(row.id, "min_stock", e.target.value)}
              />
              <input
                type="number"
                min={0}
                placeholder="安全上限"
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                value={row.max_stock}
                onChange={(e) => updateStockLocation(row.id, "max_stock", e.target.value)}
              />
              <div className="flex items-center gap-2">
                {value.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStockLocation(row.id)}
                    className="px-3 py-2 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={addStockLocation}
        className="mt-2 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
      >
        + 添加仓位
      </button>
    </div>
  );
}
