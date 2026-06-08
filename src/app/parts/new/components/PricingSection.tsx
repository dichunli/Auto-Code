"use client";

import {useState, useEffect, useRef, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";

interface SupplierItem {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface PricingSectionProps {
  purchasePrice: string;
  onPurchasePriceChange: (value: string) => void;
  referencePurchasePrice: string;
  onReferencePurchasePriceChange: (value: string) => void;
  unitPrice: string;
  onUnitPriceChange: (value: string) => void;
  standardPrice: string;
  onStandardPriceChange: (value: string) => void;
  vipPrice: string;
  onVipPriceChange: (value: string) => void;
  wholesalePrice: string;
  onWholesalePriceChange: (value: string) => void;
  minStock: string;
  onMinStockChange: (value: string) => void;
  selectedSupplier: SupplierItem | null;
  onSelectSupplier: React.Dispatch<React.SetStateAction<SupplierItem | null>>;
}

export default function PricingSection({
  purchasePrice,
  onPurchasePriceChange,
  referencePurchasePrice,
  onReferencePurchasePriceChange,
  unitPrice,
  onUnitPriceChange,
  standardPrice,
  onStandardPriceChange,
  vipPrice,
  onVipPriceChange,
  wholesalePrice,
  onWholesalePriceChange,
  minStock,
  onMinStockChange,
  selectedSupplier,
  onSelectSupplier,
}: PricingSectionProps) {
  const supabase = useMemo(() => createClient(), []);

  // Supplier search state (internal)
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierResults, setSupplierResults] = useState<SupplierItem[] | null>(null);
  const [supplierSearching, setSupplierSearching] = useState(false);
  const spTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Supplier debounced search
  useEffect(() => {
    if (spTimeoutRef.current) clearTimeout(spTimeoutRef.current);
    const value = supplierQuery.trim();
    if (!value) {
      setSupplierResults(null);
      setSupplierSearching(false);
      return;
    }
    setSupplierSearching(true);
    spTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("id, name")
        .ilike("name", "%" + value + "%")
        .limit(10);
      setSupplierResults(data || []);
      setSupplierSearching(false);
    }, 300);
    return () => {
      if (spTimeoutRef.current) clearTimeout(spTimeoutRef.current);
    };
  }, [supplierQuery, supabase]);

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">价格信息</h3>

      {/* 采购价 + 参考进价 + 报价供应商 + 查看采购记录 */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">采购价</label>
          <input
            id="purchase-price-input"
            type="number"
            min={0}
            step={0.01}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={purchasePrice}
            onChange={(e) => onPurchasePriceChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                document.getElementById("sales-price-input")?.focus();
              }
            }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">参考进价</label>
          <input
            type="number"
            min={0}
            step={0.01}
            placeholder="历史平均进价"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={referencePurchasePrice}
            onChange={(e) => onReferencePurchasePriceChange(e.target.value)}
          />
        </div>
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-1">报价供应商</label>
          {selectedSupplier ? (
            <div className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50">
              <span className="text-sm text-gray-900">{selectedSupplier.name}</span>
              <button
                type="button"
                onClick={() => {
                  onSelectSupplier(null);
                  setSupplierQuery("");
                }}
                className="text-gray-400 hover:text-gray-600 text-xs"
              >
                更换
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                placeholder="搜索供应商"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={supplierQuery}
                onChange={(e) => setSupplierQuery(e.target.value)}
              />
              {supplierSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
              {supplierResults && supplierResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {supplierResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        onSelectSupplier(s);
                        setSupplierQuery("");
                        setSupplierResults(null);
                      }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <button
            type="button"
            onClick={() => alert("采购记录功能开发中")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            查看采购记录
          </button>
        </div>
      </div>

      {/* 销售价、单位价、VIP价、批发价 */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            销售价 <span className="text-red-500">*</span>
          </label>
          <input
            id="sales-price-input"
            type="number"
            min={0}
            step={0.01}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={unitPrice}
            onChange={(e) => onUnitPriceChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                document.getElementById("standard-price-input")?.focus();
              }
            }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">单位价</label>
          <input
            id="standard-price-input"
            type="number"
            min={0}
            step={0.01}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={standardPrice}
            onChange={(e) => onStandardPriceChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                document.getElementById("vip-price-input")?.focus();
              }
            }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">VIP价</label>
          <input
            id="vip-price-input"
            type="number"
            min={0}
            step={0.01}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={vipPrice}
            onChange={(e) => onVipPriceChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                document.getElementById("wholesale-price-input")?.focus();
              }
            }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">批发价</label>
          <input
            id="wholesale-price-input"
            type="number"
            min={0}
            step={0.01}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={wholesalePrice}
            onChange={(e) => onWholesalePriceChange(e.target.value)}
          />
        </div>
      </div>

      {/* 安全库存 */}
      <div className="mt-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">安全库存（总数）</label>
        <input
          type="number"
          min={0}
          className="w-full sm:w-1/3 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          value={minStock}
          onChange={(e) => onMinStockChange(e.target.value)}
        />
      </div>
    </div>
  );
}
