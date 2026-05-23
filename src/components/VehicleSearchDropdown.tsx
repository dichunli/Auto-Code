"use client";

import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { SearchDropdown } from "./SearchDropdown";

export interface Vehicle {
  id: string;
  plate_number: string;
  brand: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
  customer_id: string | null;
  customers: { name: string; phone: string; company?: string | null } | null;
}

interface Props {
  onSelect: (vehicle: Vehicle) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export function VehicleSearchDropdown({
  onSelect,
  placeholder = "输入车牌号搜索",
  className = "",
  inputClassName = "",
}: Props) {
  const supabase = createClient();

  const searchFn = useCallback(
    async (query: string) => {
      const { data } = await supabase
        .from("vehicles")
        .select("id, plate_number, brand, model, vin, mileage, customer_id, customers(name, phone, company)")
        .ilike("plate_number", `%${query}%`)
        .limit(10);
      return (data || []).map((v) => ({
        ...v,
        customers: Array.isArray(v.customers) ? v.customers[0] || null : v.customers || null,
      })) as Vehicle[];
    },
    [supabase]
  );

  return (
    <SearchDropdown
      searchFn={searchFn}
      renderItem={(v: Vehicle) => (
        <div>
          <div className="font-medium text-gray-900">
            {v.plate_number} {v.brand && v.model ? `(${v.brand} ${v.model})` : ""}
          </div>
          <div className="text-xs text-gray-500">
            车主：{v.customers?.name || "-"} {v.customers?.phone || ""}
          </div>
        </div>
      )}
      getKey={(v: Vehicle) => v.id}
      onSelect={onSelect}
      placeholder={placeholder}
      className={className}
      inputClassName={inputClassName}
      emptyText="未找到车辆"
    />
  );
}
