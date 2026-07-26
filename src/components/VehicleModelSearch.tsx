"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface VehicleModelOption {
  id: number;
  品牌: string | null;
  品牌别名: string | null;
  车系: string | null;
  车型: string | null;
  年款: number | null;
  排量: string | null;
  销售版本: string | null;
  底盘代号: string | null;
  发动机型号: string | null;
  变速箱类型: string | null;
  变速箱代号: string | null;
}

export interface VehicleModelDetail {
  id: number;
  厂商: string | null;
  品牌: string | null;
  车系: string | null;
  车型: string | null;
  销售版本: string | null;
  年款: number | null;
  排量: string | null;
  发动机型号: string | null;
  燃油类型: string | null;
  进气形式: string | null;
  排放标准: string | null;
  功率: number | null;
  马力: number | null;
  驱动方式: string | null;
  变速箱类型: string | null;
  变速箱代号: string | null;
  档位数: number | null;
  底盘代号: string | null;
  车身类型: string | null;
  车身尺寸: string | null;
  轴距: number | null;
  整备质量: number | null;
  前轮胎规格: string | null;
  后轮胎规格: string | null;
  停产标志: string | null;
  厂商指导价: number | null;
  品牌图标: string | null;
}

const detailFields: { key: keyof VehicleModelDetail; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "厂商", label: "厂商" },
  { key: "品牌", label: "品牌" },
  { key: "车系", label: "车系" },
  { key: "车型", label: "车型" },
  { key: "销售版本", label: "销售版本" },
  { key: "年款", label: "年款" },
  { key: "排量", label: "排量" },
  { key: "发动机型号", label: "发动机型号" },
  { key: "燃油类型", label: "燃油类型" },
  { key: "进气形式", label: "进气形式" },
  { key: "排放标准", label: "排放标准" },
  { key: "功率", label: "功率" },
  { key: "马力", label: "马力" },
  { key: "驱动方式", label: "驱动方式" },
  { key: "变速箱类型", label: "变速箱类型" },
  { key: "变速箱代号", label: "变速箱代号" },
  { key: "档位数", label: "档位数" },
  { key: "底盘代号", label: "底盘代号" },
  { key: "车身类型", label: "车身类型" },
  { key: "车身尺寸", label: "车身尺寸" },
  { key: "轴距", label: "轴距" },
  { key: "整备质量", label: "整备质量" },
  { key: "前轮胎规格", label: "前轮胎规格" },
  { key: "后轮胎规格", label: "后轮胎规格" },
  { key: "停产标志", label: "状态" },
  { key: "厂商指导价", label: "厂商指导价" },
];

interface Props {
  onSelect: (model: {
    vehicle_model_id: number;
    brand: string;
    model: string;
    chassis_code: string;
    engine_no: string;
    transmission_type: string;
    transmission_code: string;
  }) => void;
  placeholder?: string;
  className?: string;
  searchKeyword?: string;
  selectedModelId?: number | null;
}

export function VehicleModelSearch({ onSelect, placeholder = "搜索品牌、车系、车型...", className = "", searchKeyword, selectedModelId }: Props) {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VehicleModelOption[]>([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [detailModel, setDetailModel] = useState<VehicleModelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      const s = query.trim();
      /* 搜索词太短不查，避免结果过多 */
      if (s.length < 2) {
        setResults([]);
        return;
      }
      const { data } = await supabase
        .from("vehicle_models")
        .select("id,品牌,品牌别名,车系,车型,年款,排量,销售版本,底盘代号,发动机型号,变速箱类型,变速箱代号")
        .ilike("搜索字段", `%${s}%`)
        .limit(10);
      setResults(((data as unknown) as VehicleModelOption[]) || []);
      setOpen(true);
    }, 300);
    return () => clearTimeout(t);
  }, [query, supabase]);

  useEffect(() => {
    if (searchKeyword !== undefined && searchKeyword !== query) {
      setQuery(searchKeyword);
    }
  }, [searchKeyword, query]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function openDetail(modelId: number) {
    setDetailLoading(true);
    const { data } = await supabase
      .from("vehicle_models")
      .select("id,厂商,品牌,车系,车型,销售版本,年款,排量,发动机型号,燃油类型,进气形式,排放标准,功率,马力,驱动方式,变速箱类型,变速箱代号,档位数,底盘代号,车身类型,车身尺寸,轴距,整备质量,前轮胎规格,后轮胎规格,停产标志,厂商指导价,品牌图标")
      .eq("id", modelId)
      .single();
    setDetailModel((data as unknown as VehicleModelDetail) || null);
    setDetailLoading(false);
  }

  function handleSelect(m: VehicleModelOption) {
    /* 去重拼接，避免车系和车型相同时重复 */
    const modelParts = [...new Set([m.车系, m.车型].filter(Boolean))];
    onSelect({
      vehicle_model_id: m.id,
      brand: m.品牌 || "",
      model: modelParts.join(" ") || m.品牌 || "",
      chassis_code: m.底盘代号 || "",
      engine_no: m.发动机型号 || "",
      transmission_type: m.变速箱类型 || "",
      transmission_code: m.变速箱代号 || "",
    });
    /* 输入框显示详细信息 + 车型ID */
    const displayParts = [
      m.年款 ? `${m.年款}款` : null,
      m.品牌,
      m.车系,
      m.车型,
      m.销售版本,
      m.排量,
      m.发动机型号,
    ].filter(Boolean);
    setQuery(`${displayParts.join(" ")} [ID:${m.id}]`);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <input
        type="text"
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(false); }}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
      />

      {/* 已关联车型ID显示 */}
      {selectedModelId && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="text-gray-500">已关联车型:</span>
          <span className="text-blue-600 font-medium">ID:{selectedModelId}</span>
          <button
            type="button"
            onClick={() => openDetail(selectedModelId)}
            className="text-blue-600 hover:text-blue-800 hover:underline"
          >
            查看详情
          </button>
        </div>
      )}

      {open && results.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => handleSelect(m)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
            >
              <div className="font-medium text-gray-900">
                {[
                  m.年款 ? `${m.年款}款` : null,
                  m.品牌别名 || m.品牌,
                  m.车型,
                  m.销售版本,
                  m.排量,
                  m.发动机型号,
                  m.底盘代号,
                ].filter(Boolean).join(" ")}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 详情弹窗 */}
      {detailModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">
                {detailModel.品牌} {detailModel.车系} {detailModel.车型}
              </h3>
              <button
                onClick={() => setDetailModel(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto p-6">
              {detailLoading ? (
                <div className="text-center text-gray-500 py-8">加载中...</div>
              ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {detailFields.map((f) => {
                    const val = detailModel[f.key];
                    const displayVal = val === null || val === undefined || val === "" ? "-" : String(val);
                    return (
                      <div key={f.key} className="flex justify-between text-sm border-b border-gray-50 pb-1">
                        <span className="text-gray-500">{f.label}</span>
                        {f.key === "品牌图标" && displayVal !== "-" ? (
                          <img
                            src={displayVal}
                            alt={detailModel.品牌 || "品牌图标"}
                            loading="lazy"
                            className="h-8 object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <span className="text-gray-900 font-medium">{displayVal}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setDetailModel(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
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
