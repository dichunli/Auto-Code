"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

export interface SpecialPriceItem {
  id: string;
  company_id?: string;
  company_name?: string;
  customer_id?: string;
  customer_name?: string;
  vehicle_id?: string;
  vehicle_name?: string;
  price: string;
}

export interface VehicleModelPriceItem {
  vehicle_model_id: string;
  vehicle_name: string;
  brand: string;
  series: string;
  model_name: string;
  year_start?: number;
  year_end?: number;
  engine?: string;
  sales_price: string;
  vip_price: string;
  standard_price: string;
}

interface IdNameItem {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface SpecialPricingSectionProps {
  specialPrices: SpecialPriceItem[];
  onSpecialPricesChange: (value: SpecialPriceItem[]) => void;
  vehicleModelPrices: VehicleModelPriceItem[];
  onVehicleModelPricesChange: (value: VehicleModelPriceItem[]) => void;
}

export default function SpecialPricingSection({
  specialPrices,
  onSpecialPricesChange,
  vehicleModelPrices,
  onVehicleModelPricesChange,
}: SpecialPricingSectionProps) {
  const supabase = createClient();

  // Company search for special pricing
  const [spCompanyQuery, setSpCompanyQuery] = useState("");
  const [spCompanyResults, setSpCompanyResults] = useState<IdNameItem[]>([]);
  const [spCompanySearching, setSpCompanySearching] = useState(false);
  const [spCompanySelected, setSpCompanySelected] = useState<{ id: string; name: string } | null>(null);
  const spCompanyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Customer search for special pricing
  const [spCustomerQuery, setSpCustomerQuery] = useState("");
  const [spCustomerResults, setSpCustomerResults] = useState<IdNameItem[]>([]);
  const [spCustomerSearching, setSpCustomerSearching] = useState(false);
  const [spCustomerSelected, setSpCustomerSelected] = useState<{ id: string; name: string } | null>(null);
  const spCustomerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Vehicle search for special pricing
  const [spVehicleQuery, setSpVehicleQuery] = useState("");
  const [spVehicleResults, setSpVehicleResults] = useState<IdNameItem[]>([]);
  const [spVehicleSearching, setSpVehicleSearching] = useState(false);
  const [spVehicleSelected, setSpVehicleSelected] = useState<{ id: string; name: string } | null>(null);
  const spVehicleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [spNewPrice, setSpNewPrice] = useState("");

  // Vehicle model pricing search
  const [vmPriceQuery, setVmPriceQuery] = useState("");
  const [vmPriceResults, setVmPriceResults] = useState<IdNameItem[]>([]);
  const [vmPriceSearching, setVmPriceSearching] = useState(false);
  const [vmPriceSelected, setVmPriceSelected] = useState<{
    id: string;
    name: string;
    brand: string;
    series: string;
    model_name: string;
    year_start?: number;
    year_end?: number;
    engine?: string;
  } | null>(null);
  const [vmNewSalesPrice, setVmNewSalesPrice] = useState("");
  const [vmNewVipPrice, setVmNewVipPrice] = useState("");
  const [vmNewStandardPrice, setVmNewStandardPrice] = useState("");
  const vmPriceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const groupedVehiclePrices = useMemo(() => {
    const map = new Map<string, VehicleModelPriceItem[]>();
    for (const p of vehicleModelPrices) {
      const key = `${p.sales_price}|${p.vip_price}|${p.standard_price}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.values()).map((items) => ({
      sales_price: items[0].sales_price,
      vip_price: items[0].vip_price,
      standard_price: items[0].standard_price,
      items,
    }));
  }, [vehicleModelPrices]);

  // Special pricing - company search
  useEffect(() => {
    if (spCompanyTimeoutRef.current) clearTimeout(spCompanyTimeoutRef.current);
    const value = spCompanyQuery.trim();
    if (!value) {
      setSpCompanyResults([]);
      setSpCompanySearching(false);
      return;
    }
    setSpCompanySearching(true);
    spCompanyTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase.from("companies").select("id, name").ilike("name", "%" + value + "%").limit(10);
      setSpCompanyResults(data || []);
      setSpCompanySearching(false);
    }, 300);
    return () => {
      if (spCompanyTimeoutRef.current) clearTimeout(spCompanyTimeoutRef.current);
    };
  }, [spCompanyQuery, supabase]);

  // Special pricing - customer search
  useEffect(() => {
    if (spCustomerTimeoutRef.current) clearTimeout(spCustomerTimeoutRef.current);
    const value = spCustomerQuery.trim();
    if (!value) {
      setSpCustomerResults([]);
      setSpCustomerSearching(false);
      return;
    }
    setSpCustomerSearching(true);
    spCustomerTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone")
        .or("name.ilike.%" + value + "%,phone.ilike.%" + value + "%")
        .limit(10);
      setSpCustomerResults(data || []);
      setSpCustomerSearching(false);
    }, 300);
    return () => {
      if (spCustomerTimeoutRef.current) clearTimeout(spCustomerTimeoutRef.current);
    };
  }, [spCustomerQuery, supabase]);

  // Special pricing - vehicle search
  useEffect(() => {
    if (spVehicleTimeoutRef.current) clearTimeout(spVehicleTimeoutRef.current);
    const value = spVehicleQuery.trim();
    if (!value) {
      setSpVehicleResults([]);
      setSpVehicleSearching(false);
      return;
    }
    setSpVehicleSearching(true);
    spVehicleTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("id, plate_number, brand, model, vin, customers(name)")
        .or("plate_number.ilike.%" + value + "%,vin.ilike.%" + value + "%,brand.ilike.%" + value + "%,model.ilike.%" + value + "%")
        .limit(10);
      setSpVehicleResults(data || []);
      setSpVehicleSearching(false);
    }, 300);
    return () => {
      if (spVehicleTimeoutRef.current) clearTimeout(spVehicleTimeoutRef.current);
    };
  }, [spVehicleQuery, supabase]);

  // Vehicle model pricing search
  useEffect(() => {
    if (vmPriceTimeoutRef.current) clearTimeout(vmPriceTimeoutRef.current);
    const value = vmPriceQuery.trim();
    if (!value) {
      setVmPriceResults([]);
      setVmPriceSearching(false);
      return;
    }
    setVmPriceSearching(true);
    vmPriceTimeoutRef.current = setTimeout(async () => {
      const excludeIds = vehicleModelPrices.map((v) => v.vehicle_model_id);
      let query = supabase
        .from("vehicle_models")
        .select("id, 品牌, 车系, 车型, 年款, 发动机型号")
        .or(`品牌.ilike.%${value}%,车系.ilike.%${value}%,车型.ilike.%${value}%`)
        .limit(10);
      if (excludeIds.length > 0) query = query.not("id", "in", "(" + excludeIds.join(",") + ")");
      const { data } = await query;
      const mapped = (data || []).map((v: unknown) => ({
        id: String((v as Record<string, unknown>).id),
        brand: ((v as Record<string, unknown>).品牌 as string) || "",
        series: ((v as Record<string, unknown>).车系 as string) || "",
        model_name: ((v as Record<string, unknown>).车型 as string) || "",
        year_start: (v as Record<string, unknown>).年款,
        year_end: (v as Record<string, unknown>).年款,
        engine: (v as Record<string, unknown>).发动机型号,
      }));
      setVmPriceResults(mapped);
      setVmPriceSearching(false);
    }, 300);
    return () => {
      if (vmPriceTimeoutRef.current) clearTimeout(vmPriceTimeoutRef.current);
    };
  }, [vmPriceQuery, vehicleModelPrices, supabase]);

  function addSpecialPrice() {
    const company = spCompanySelected;
    const customer = spCustomerSelected;
    const vehicle = spVehicleSelected;
    const price = parseFloat(spNewPrice);

    if (!company && !customer && !vehicle) {
      alert("请至少选择单位、客户或车辆中的一个");
      return;
    }
    if (!price || price <= 0) {
      alert("请输入有效的价格");
      return;
    }
    const duplicate = specialPrices.some(
      (p) =>
        p.company_id === (company?.id || undefined) &&
        p.customer_id === (customer?.id || undefined) &&
        p.vehicle_id === (vehicle?.id || undefined)
    );
    if (duplicate) {
      alert("该组合已存在");
      return;
    }

    const item: SpecialPriceItem = {
      id: crypto.randomUUID(),
      price: spNewPrice,
    };
    if (company) {
      item.company_id = company.id;
      item.company_name = company.name;
    }
    if (customer) {
      item.customer_id = customer.id;
      item.customer_name = customer.name;
    }
    if (vehicle) {
      item.vehicle_id = vehicle.id;
      item.vehicle_name = vehicle.name;
    }

    onSpecialPricesChange([...specialPrices, item]);
    setSpCompanySelected(null);
    setSpCompanyQuery("");
    setSpCustomerSelected(null);
    setSpCustomerQuery("");
    setSpVehicleSelected(null);
    setSpVehicleQuery("");
    setSpNewPrice("");
  }

  function removeSpecialPrice(id: string) {
    onSpecialPricesChange(specialPrices.filter((p) => p.id !== id));
  }

  function addVehicleModelPrice() {
    if (!vmPriceSelected) {
      alert("请选择车型");
      return;
    }
    const salesVal = parseFloat(vmNewSalesPrice);
    if (!vmNewSalesPrice || isNaN(salesVal) || salesVal <= 0) {
      alert("销售价为必填项，请输入有效的价格");
      return;
    }
    if (vehicleModelPrices.some((p) => p.vehicle_model_id === vmPriceSelected.id)) {
      alert("该车型已存在");
      return;
    }
    onVehicleModelPricesChange([
      ...vehicleModelPrices,
      {
        vehicle_model_id: vmPriceSelected.id,
        vehicle_name: vmPriceSelected.name,
        brand: vmPriceSelected.brand,
        series: vmPriceSelected.series,
        model_name: vmPriceSelected.model_name,
        year_start: vmPriceSelected.year_start,
        year_end: vmPriceSelected.year_end,
        engine: vmPriceSelected.engine,
        sales_price: vmNewSalesPrice,
        vip_price: vmNewVipPrice,
        standard_price: vmNewStandardPrice,
      },
    ]);
    setVmPriceSelected(null);
    setVmPriceQuery("");
    setVmNewSalesPrice("");
    setVmNewVipPrice("");
    setVmNewStandardPrice("");
  }

  function removeVehicleModelPriceGroup(salesPrice: string, vipPrice: string, standardPrice: string) {
    onVehicleModelPricesChange(
      vehicleModelPrices.filter((p) => p.sales_price !== salesPrice || p.vip_price !== vipPrice || p.standard_price !== standardPrice)
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">特殊价格</h3>

      {/* 指定用户价格 */}
      <div className="mb-6">
        <h4 className="text-xs font-medium text-gray-500 mb-3">指定用户价格</h4>
        <div className="flex gap-2 items-end flex-wrap mb-3">
          <div className="relative flex-1 min-w-[140px]">
            <label className="block text-xs text-gray-500 mb-1">单位（可选）</label>
            <input
              type="text"
              placeholder="搜索单位..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={spCompanySelected ? spCompanySelected.name : spCompanyQuery}
              onChange={(e) => {
                setSpCompanyQuery(e.target.value);
                setSpCompanySelected(null);
              }}
            />
            {spCompanySearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
            {spCompanyResults.length > 0 && !spCompanySelected && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {spCompanyResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSpCompanySelected({ id: c.id, name: c.name });
                      setSpCompanyQuery("");
                      setSpCompanyResults([]);
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative flex-1 min-w-[140px]">
            <label className="block text-xs text-gray-500 mb-1">客户（可选）</label>
            <input
              type="text"
              placeholder="搜索客户..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={spCustomerSelected ? spCustomerSelected.name : spCustomerQuery}
              onChange={(e) => {
                setSpCustomerQuery(e.target.value);
                setSpCustomerSelected(null);
              }}
            />
            {spCustomerSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
            {spCustomerResults.length > 0 && !spCustomerSelected && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {spCustomerResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSpCustomerSelected({
                        id: c.id,
                        name: c.name + (c.phone ? " (" + c.phone + ")" : ""),
                      });
                      setSpCustomerQuery("");
                      setSpCustomerResults([]);
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                  >
                    {c.name} {c.phone ? `(${c.phone})` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative flex-1 min-w-[140px]">
            <label className="block text-xs text-gray-500 mb-1">车辆（可选）</label>
            <input
              type="text"
              placeholder="搜索车牌号..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={spVehicleSelected ? spVehicleSelected.name : spVehicleQuery}
              onChange={(e) => {
                setSpVehicleQuery(e.target.value);
                setSpVehicleSelected(null);
              }}
            />
            {spVehicleSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
            {spVehicleResults.length > 0 && !spVehicleSelected && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {spVehicleResults.map((v) => {
                  const vName =
                    v.plate_number +
                    (v.brand || v.model ? "·" + (v.brand || "") + " " + (v.model || "") : "");
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setSpVehicleSelected({ id: v.id, name: vName });
                        setSpVehicleQuery("");
                        setSpVehicleResults([]);
                      }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      {vName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="w-28">
            <label className="block text-xs text-gray-500 mb-1">价格</label>
            <input
              type="number"
              min={0}
              step={0.01}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={spNewPrice}
              onChange={(e) => setSpNewPrice(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addSpecialPrice();
              }}
            />
          </div>
          <button
            type="button"
            onClick={addSpecialPrice}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            添加
          </button>
        </div>

        {/* 统一列表 */}
        {specialPrices.length > 0 && (
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-100">
            {specialPrices.map((p) => {
              const parts: string[] = [];
              if (p.company_name) parts.push(`单位：${p.company_name}`);
              if (p.customer_name) parts.push(`客户：${p.customer_name}`);
              if (p.vehicle_name) parts.push(`车辆：${p.vehicle_name}`);
              return (
                <div key={p.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm text-gray-700">{parts.join("  ")}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-900">¥{p.price}</span>
                    <button
                      type="button"
                      onClick={() => removeSpecialPrice(p.id)}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 车型定价 */}
      <h4 className="text-xs font-medium text-gray-500 mb-3">车型定价</h4>
      <div className="relative mb-3">
        <input
          type="text"
          placeholder="搜索车型"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          value={vmPriceSelected ? vmPriceSelected.name : vmPriceQuery}
          onChange={(e) => {
            setVmPriceQuery(e.target.value);
            setVmPriceSelected(null);
          }}
        />
        {vmPriceSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
        {vmPriceResults.length > 0 && !vmPriceSelected && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {vmPriceResults.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setVmPriceSelected({
                    id: String(v.id),
                    name: String(v.brand) + " " + String(v.series) + " " + String(v.model_name),
                    brand: String(v.brand),
                    series: String(v.series),
                    model_name: String(v.model_name),
                    year_start: v.year_start as number | undefined,
                    year_end: v.year_end as number | undefined,
                    engine: v.engine as string | undefined,
                  });
                  setVmPriceQuery("");
                  setVmPriceResults([]);
                }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
              >
                <span className="font-medium">{String(v.brand)} {String(v.series)}</span>
                {v.model_name && <span className="text-gray-500 ml-1">{String(v.model_name)}</span>}
                {v.year_start && (
                  <span className="text-gray-400 text-xs ml-1">
                    ({String(v.year_start)}-{v.year_end ? String(v.year_end) : "今"})
                  </span>
                )}
                {v.engine && <span className="text-gray-400 text-xs ml-1">· 发动机:{String(v.engine)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <input
          type="number"
          min={0}
          step={0.01}
          placeholder="销售价 *"
          className="flex-1 min-w-[70px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          value={vmNewSalesPrice}
          onChange={(e) => setVmNewSalesPrice(e.target.value)}
        />
        <input
          type="number"
          min={0}
          step={0.01}
          placeholder="VIP价"
          className="flex-1 min-w-[70px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          value={vmNewVipPrice}
          onChange={(e) => setVmNewVipPrice(e.target.value)}
        />
        <input
          type="number"
          min={0}
          step={0.01}
          placeholder="单位价"
          className="flex-1 min-w-[70px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          value={vmNewStandardPrice}
          onChange={(e) => setVmNewStandardPrice(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addVehicleModelPrice();
          }}
        />
      </div>
      <button
        type="button"
        onClick={addVehicleModelPrice}
        disabled={!vmPriceSelected || !vmNewSalesPrice}
        className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        添加
      </button>
      {groupedVehiclePrices.length > 0 && (
        <div className="mt-3 space-y-2">
          {groupedVehiclePrices.map((group, idx) => (
            <div key={idx} className="bg-gray-50 rounded-lg p-2.5 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-3 text-gray-600">
                  <span>
                    销售:<span className="font-medium text-gray-900 ml-0.5">{group.sales_price || "-"}</span>
                  </span>
                  <span>
                    VIP:<span className="font-medium text-gray-900 ml-0.5">{group.vip_price || "-"}</span>
                  </span>
                  <span>
                    单位:<span className="font-medium text-gray-900 ml-0.5">{group.standard_price || "-"}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => removeVehicleModelPriceGroup(group.sales_price, group.vip_price, group.standard_price)}
                    className="text-red-600 hover:text-red-700"
                  >
                    删除整组
                  </button>
                </div>
              </div>
              {group.items.map((p) => (
                <div key={p.vehicle_model_id} className="text-gray-700">
                  <span className="text-gray-500">ID:{String(p.vehicle_model_id).slice(0, 8)}</span>
                  <span className="text-gray-400 mx-1">·</span>
                  {p.brand} {p.series} {p.model_name}
                  {p.year_start && (
                    <span className="text-gray-400 ml-0.5">
                      {p.year_start}
                      {p.year_end && p.year_end !== p.year_start ? `-${p.year_end}` : ""}款
                    </span>
                  )}
                  {p.engine && (
                    <>
                      <span className="text-gray-400 mx-1">·</span>
                      <span className="text-gray-500">发动机:{p.engine}</span>
                    </>
                  )}
                </div>
              ))}
              <div className="text-xs text-gray-500 mt-1">共 {group.items.length} 个车型</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
