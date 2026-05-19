"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface VehicleModelOption {
  id: number;
  品牌: string | null;
  车系: string | null;
  车型: string | null;
  年款: number | null;
  排量: string | null;
  底盘代号: string | null;
  发动机型号: string | null;
  变速箱类型: string | null;
  变速箱代号: string | null;
}

interface Props {
  onSelect: (model: {
    id: number;
    brand: string;
    model: string;
    chassis_code: string;
    engine_no: string;
    transmission_type: string;
    transmission_code: string;
  }) => void;
  placeholder?: string;
  className?: string;
}

export function VehicleModelSearch({ onSelect, placeholder = "搜索品牌、车系、车型...", className = "" }: Props) {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VehicleModelOption[]>([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

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
        .select("id,品牌,车系,车型,年款,排量,底盘代号,发动机型号,变速箱类型,变速箱代号")
        .ilike("搜索字段", `%${s}%`)
        .limit(10);
      setResults(((data as unknown) as VehicleModelOption[]) || []);
      setOpen(true);
    }, 300);
    return () => clearTimeout(t);
  }, [query, supabase]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(m: VehicleModelOption) {
    onSelect({
      id: m.id,
      brand: m.品牌 || "",
      model: [m.车系, m.车型].filter(Boolean).join(" ") || m.品牌 || "",
      chassis_code: m.底盘代号 || "",
      engine_no: m.发动机型号 || "",
      transmission_type: m.变速箱类型 || "",
      transmission_code: m.变速箱代号 || "",
    });
    setQuery([m.品牌, m.车系, m.车型].filter(Boolean).join(" "));
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
                {m.品牌} {m.车系} {m.车型}
              </div>
              <div className="text-xs text-gray-500">
                {m.年款 ? `${m.年款}款 ` : ""}{m.排量 || ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
