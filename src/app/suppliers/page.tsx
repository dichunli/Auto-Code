"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

interface Supplier {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  recommendation_level: number;
  parts?: { count: number }[];
}

export default function SuppliersPage() {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  async function loadSuppliers(search?: string) {
    setLoading(true);
    let q = supabase
      .from("suppliers")
      .select("*, parts(count)")
      .order("created_at", { ascending: false });
    if (search?.trim()) {
      q = q.or(`name.ilike.%${search.trim()}%,contact.ilike.%${search.trim()}%,phone.ilike.%${search.trim()}%`);
    }
    const { data, error } = await q;
    if (error) {
      console.error("供应商加载失败:", error);
      alert("加载失败: " + error.message);
    }
    setSuppliers((data as Supplier[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    loadSuppliers();
  }, [supabase]);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      loadSuppliers(query);
    }, 300);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query]);

  async function handleDelete(id: string, name: string, hasParts: boolean) {
    if (hasParts) {
      alert("该供应商有关联的配件信息，无法删除");
      return;
    }
    if (!confirm(`确定删除供应商「${name}」吗？`)) return;

    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    loadSuppliers(query);
  }

  return (
    <div>
      <PageHeader
        title="供应商管理"
        description="管理配件采购供应商"
        action={{ href: "/suppliers/new", label: "新增供应商" }}
      />

      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          placeholder="搜索供应商名称、联系人、电话..."
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() && (
          <button
            onClick={() => setQuery("")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            清空
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">供应商名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">联系人</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">电话</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">地址</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">推荐等级</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件数</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {suppliers?.map((s: any) => {
                const partCount = s.parts?.[0]?.count || 0;
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">
                    <Link href={`/suppliers/${s.id}`} className="hover:text-blue-600 hover:underline">
                      {s.name}
                    </Link>
                  </td>
                    <td className="px-6 py-4 text-gray-600">{s.contact || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{s.phone || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{s.address || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {s.recommendation_level > 0 ? (
                        <span className="text-amber-500">{"⭐".repeat(s.recommendation_level)}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{partCount}</td>
                    <td className="px-6 py-4 text-gray-500 max-w-xs truncate">{s.notes || "-"}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Link href={`/suppliers/${s.id}/edit`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">编辑</Link>
                        <button
                          onClick={() => handleDelete(s.id, s.name, partCount > 0)}
                          className={`text-xs ${partCount > 0 ? "text-gray-400 cursor-not-allowed" : "text-red-600 hover:text-red-800 hover:underline"}`}
                          disabled={partCount > 0}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(!suppliers || suppliers.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                    {loading ? "加载中..." : "暂无供应商数据"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
