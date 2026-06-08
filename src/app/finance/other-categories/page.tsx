"use client";

import {useState, useEffect, useCallback, useMemo} from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 分类 {
  id: string;
  name: string;
  type: string;
  sort_order: number;
  is_active: boolean;
}

function CategoryList({
  title,
  type,
  color,
  items,
  onReorder,
  onDelete,
  deletingId,
}: {
  title: string;
  type: string;
  color: string;
  items: 分类[];
  onReorder: (type: string, fromIndex: number, toIndex: number) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === toIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    onReorder(type, dragIndex, toIndex);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const bgColor = color === "green" ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100";
  const textColor = color === "green" ? "text-green-800" : "text-red-800";

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className={`px-4 py-3 ${bgColor}`}>
        <h3 className={`font-medium ${textColor}`}>{title}</h3>
      </div>
      <div className="divide-y divide-gray-100">
        {items.map((c, index) => (
          <div
            key={c.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            className={`flex items-center justify-between px-4 py-3 cursor-move transition-colors ${
              dragIndex === index ? "opacity-50" : ""
            } ${dragOverIndex === index ? "bg-blue-50" : "hover:bg-gray-50"}`}
          >
            <div className="flex items-center gap-3">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
              </svg>
              <span className="text-sm font-medium text-gray-900">{c.name}</span>
              {!c.is_active && (
                <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">已停用</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/finance/other-categories/${c.id}/edit`}
                className="text-xs text-blue-600 hover:underline"
              >
                编辑
              </Link>
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                disabled={deletingId === c.id}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                {deletingId === c.id ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">暂无分类</div>
        )}
      </div>
    </div>
  );
}

export default function OtherCategoriesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<分类[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  useEffect(() => {
    loadCategories();
  }, [supabase]);

  async function loadCategories() {
    setLoading(true);
    const { data } = await supabase
      .from("other_transaction_categories")
      .select("id, name, type, sort_order, is_active")
      .order("sort_order", { ascending: true })
      .order("name");
    setCategories(data || []);
    setLoading(false);
  }

  const handleReorder = useCallback(
    async (type: string, fromIndex: number, toIndex: number) => {
      const typeItems = categories.filter((c) => c.type === type);
      const otherItems = categories.filter((c) => c.type !== type);

      const newItems = [...typeItems];
      const [moved] = newItems.splice(fromIndex, 1);
      newItems.splice(toIndex, 0, moved);

      /* 重新分配 sort_order */
      const reordered = newItems.map((item, index) => ({
        ...item,
        sort_order: (index + 1) * 10,
      }));

      const allItems = [...otherItems, ...reordered].sort(
        (a, b) => a.sort_order - b.sort_order
      );
      setCategories(allItems);

      /* 批量更新数据库 */
      setSavingOrder(true);
      for (const item of reordered) {
        await supabase
          .from("other_transaction_categories")
          .update({ sort_order: item.sort_order })
          .eq("id", item.id);
      }
      setSavingOrder(false);
    },
    [categories, supabase]
  );

  async function handleDelete(id: string) {
    const { count } = await supabase
      .from("other_transactions")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id);

    if ((count || 0) > 0) {
      alert("该分类已被使用，不能删除");
      return;
    }

    if (!confirm("确定删除这个分类？")) return;

    setDeletingId(id);
    const { error } = await supabase
      .from("other_transaction_categories")
      .delete()
      .eq("id", id);
    setDeletingId(null);

    if (error) {
      alert("删除失败：" + error.message);
      return;
    }

    loadCategories();
  }

  const incomeCategories = categories.filter((c) => c.type === "income");
  const expenseCategories = categories.filter((c) => c.type === "expense");

  return (
    <div>
      <PageHeader
        title="其它收支分类"
        description="管理收入和支出的原因分类"
        action={{ href: "/finance/other-categories/new", label: "新建分类" }}
      />

      {savingOrder && (
        <div className="mb-4 text-sm text-blue-600">正在保存排序...</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : (
        <div className="space-y-6">
          <CategoryList
            title="收入原因"
            type="income"
            color="green"
            items={incomeCategories}
            onReorder={handleReorder}
            onDelete={handleDelete}
            deletingId={deletingId}
          />
          <CategoryList
            title="支出原因"
            type="expense"
            color="red"
            items={expenseCategories}
            onReorder={handleReorder}
            onDelete={handleDelete}
            deletingId={deletingId}
          />
        </div>
      )}
    </div>
  );
}
