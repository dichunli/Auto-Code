"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewEmployeeGroupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("0");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) {
      alert("请填写分组名称");
      return;
    }

    setLoading(true);
    const { error } = await supabase.from("employee_groups").insert({
      name,
      description: description || null,
      sort_order: parseInt(sortOrder) || 0,
    });
    setLoading(false);

    if (error) {
      alert("保存失败：" + error.message);
      return;
    }

    router.push("/employee-groups");
    router.refresh();
  }

  return (
    <div className="max-w-xl mx-auto">
      <PageHeader title="新建分组" description="创建员工分组或部门" />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="如：维修部、接待部"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="分组职责描述"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">排序</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? "保存中..." : "保存"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/employee-groups")}
              className="px-5 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
