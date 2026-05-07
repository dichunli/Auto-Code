"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewMechanicLevelPage() {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [levelCode, setLevelCode] = useState("");
  const [coefficient, setCoefficient] = useState("1.00");
  const [commissionWeight, setCommissionWeight] = useState("1.00");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) {
      alert("请填写等级名称");
      return;
    }

    const numCoefficient = parseFloat(coefficient);
    if (isNaN(numCoefficient) || numCoefficient <= 0) {
      alert("个人分成系数必须大于 0");
      return;
    }
    const numWeight = parseFloat(commissionWeight);
    if (isNaN(numWeight) || numWeight < 0) {
      alert("团队分配权重不能为负数");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from("mechanic_levels").insert({
        name,
        level_code: levelCode || null,
        share_coefficient: numCoefficient,
        commission_weight: numWeight,
      });

      if (error) throw error;

      router.push("/mechanic-levels");
      router.refresh();
    } catch (err: any) {
      const raw = err?.message || err?.error_description || (typeof err === "object" ? JSON.stringify(err) : String(err));
      let msg = raw;
      if (raw.includes("mechanic_levels_level_code_key")) {
        msg = `等级编码「${levelCode}」已存在，请换一个`;
      } else if (raw.includes("mechanic_levels_name_key") || raw.toLowerCase().includes("duplicate") && raw.includes("name")) {
        msg = `等级名称「${name}」已存在，请换一个`;
      }
      alert("保存失败：" + msg);
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <PageHeader title="新建技师等级" description="添加新的技师等级与分成系数" />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">等级名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="如：资深技师"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">等级编码</label>
            <input
              type="text"
              value={levelCode}
              onChange={(e) => setLevelCode(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="如：L5"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">个人分成系数 *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={coefficient}
              onChange={(e) => setCoefficient(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="如：1.00"
              required
            />
            <p className="text-xs text-gray-400 mt-1">单干时的提成倍率。1.00 = 100%，1.20 = 120%</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">团队分配权重 *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={commissionWeight}
              onChange={(e) => setCommissionWeight(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="如：1.00"
              required
            />
            <p className="text-xs text-gray-400 mt-1">多人合作时的提成分配权重。权重越高，合作时分得越多。0 表示不参与团队分成</p>
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
              onClick={() => router.push("/mechanic-levels")}
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
