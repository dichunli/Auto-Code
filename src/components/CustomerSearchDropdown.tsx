"use client";

import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { SearchDropdown } from "./SearchDropdown";

export interface Customer {
  id: string;
  name: string;
  phone: string;
  company?: string | null;
}

interface Props {
  onSelect: (customer: Customer) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  emptyRender?: React.ReactNode;
}

export function CustomerSearchDropdown({
  onSelect,
  placeholder = "搜索客户姓名或手机号",
  className = "",
  inputClassName = "",
  emptyRender,
}: Props) {
  const supabase = createClient();

  const searchFn = useCallback(
    async (query: string) => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone, company")
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10);
      return (data || []) as Customer[];
    },
    [supabase]
  );

  return (
    <SearchDropdown
      searchFn={searchFn}
      renderItem={(c: Customer) => (
        <div>
          <div className="font-medium text-gray-900">{c.name}</div>
          <div className="text-xs text-gray-500">
            {c.phone} {c.company ? `· ${c.company}` : ""}
          </div>
        </div>
      )}
      getKey={(c: Customer) => c.id}
      onSelect={onSelect}
      placeholder={placeholder}
      className={className}
      inputClassName={inputClassName}
      emptyText="未找到客户"
      emptyRender={emptyRender}
    />
  );
}
