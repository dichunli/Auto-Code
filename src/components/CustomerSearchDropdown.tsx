"use client";

import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { SearchDropdown } from "./SearchDropdown";

export interface CustomerTag {
  id: string;
  name: string;
  color: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  company?: string | null;
  star_level?: number;
  customer_tags?: { tags: CustomerTag }[] | null;
}

export function StarDisplay({ level }: { level?: number }) {
  if (!level || level < 1) return null;
  const stars = Array.from({ length: 5 }, (_, i) => (i < level ? "★" : "☆"));
  return (
    <span className="text-orange-400 text-xs tracking-tight">
      {stars.join("")}
    </span>
  );
}

export function TagDisplay({ tags }: { tags?: { tags: CustomerTag | CustomerTag[] }[] | null }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {tags.map((t) => {
        const tag = Array.isArray(t.tags) ? t.tags[0] : t.tags;
        if (!tag) return null;
        return (
          <span
            key={tag.id}
            className="inline-block px-1.5 py-0.5 rounded text-[10px] text-white"
            style={{ backgroundColor: tag.color || "#3b82f6" }}
          >
            {tag.name}
          </span>
        );
      })}
    </div>
  );
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
        .select("id, name, phone, company, star_level, customer_tags(tags(id, name, color))")
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10);
      return (data || []) as unknown as Customer[];
    },
    [supabase]
  );

  return (
    <SearchDropdown
      searchFn={searchFn}
      renderItem={(c: Customer) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{c.name}</span>
            <StarDisplay level={c.star_level} />
          </div>
          <div className="text-xs text-gray-500">
            {c.phone} {c.company ? `· ${c.company}` : ""}
          </div>
          <TagDisplay tags={c.customer_tags} />
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
