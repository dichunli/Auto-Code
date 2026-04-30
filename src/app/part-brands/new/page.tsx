"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewPartBrandPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("part_brands").insert({ name });

    if (error) {
      alert("保存失败: " + error.message);
      setLoading(false);
      return;
    }

    router.push("/part-brands");
    router.refresh();
  }

  return (
    <div>
      <PageHeader title="新建配件品牌" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">品牌名称 *</label>
          <input required className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="如：博世、壳牌、曼牌" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">保存</button>
        </div>
      </form>
    </div>
  );
}
