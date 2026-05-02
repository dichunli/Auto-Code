"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function EditPartSpecificationPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  const [pnQuery, setPnQuery] = useState("");
  const [pnResults, setPnResults] = useState<any[]>([]);
  const [pnSearching, setPnSearching] = useState(false);
  const [linkedNames, setLinkedNames] = useState<{ id: string; name: string; category_name?: string }[]>([]);

  useEffect(() => {
    async function load() {
      const [{ data: spec }, { data: links }] = await Promise.all([
        supabase.from("part_specifications").select("*").eq("id", id).single(),
        supabase
          .from("part_name_specifications")
          .select("part_name_id, part_names(id, name, part_categories(name))")
          .eq("specification_id", id),
      ]);

      if (!spec) {
        alert("规格不存在");
        router.push("/part-specifications");
        return;
      }

      setName(spec.name || "");
      setLinkedNames(
        (links || []).map((l: any) => ({
          id: l.part_name_id,
          name: l.part_names?.name,
          category_name: l.part_names?.part_categories?.name,
        }))
      );
      setLoading(false);
    }
    load();
  }, [id, supabase, router]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!pnQuery.trim()) {
        setPnResults([]);
        return;
      }
      setPnSearching(true);
      const { data } = await supabase
        .from("part_names")
        .select("id, name, part_categories(name)")
        .ilike("name", `%${pnQuery.trim()}%`)
        .order("name")
        .limit(10);
      setPnResults(data || []);
      setPnSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [pnQuery, supabase]);

  function addLinkedName(pn: any) {
    if (linkedNames.some((n) => n.id === pn.id)) return;
    setLinkedNames((prev) => [
      ...prev,
      { id: pn.id, name: pn.name, category_name: pn.part_categories?.name },
    ]);
    setPnQuery("");
    setPnResults([]);
  }

  function removeLinkedName(id: string) {
    setLinkedNames((prev) => prev.filter((n) => n.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      alert("请输入规格名称");
      return;
    }
    setSaving(true);

    const { error: updateError } = await supabase
      .from("part_specifications")
      .update({ name: name.trim() })
      .eq("id", id);

    if (updateError) {
      alert("保存失败: " + updateError.message);
      setSaving(false);
      return;
    }

    const { data: existing } = await supabase
      .from("part_name_specifications")
      .select("part_name_id")
      .eq("specification_id", id);

    const existingIds = new Set((existing || []).map((x: any) => x.part_name_id));
    const newIds = new Set(linkedNames.map((n) => n.id));

    const toDelete = Array.from(existingIds).filter((pid) => !newIds.has(pid));
    const toInsert = Array.from(newIds).filter((pid) => !existingIds.has(pid));

    if (toDelete.length > 0) {
      const { error: delError } = await supabase
        .from("part_name_specifications")
        .delete()
        .eq("specification_id", id)
        .in("part_name_id", toDelete);
      if (delError) {
        alert("更新关联失败: " + delError.message);
        setSaving(false);
        return;
      }
    }

    if (toInsert.length > 0) {
      const rows = toInsert.map((pid) => ({ specification_id: id, part_name_id: pid }));
      const { error: insError } = await supabase.from("part_name_specifications").insert(rows);
      if (insError) {
        alert("更新关联失败: " + insError.message);
        setSaving(false);
        return;
      }
    }

    router.push("/part-specifications");
    router.refresh();
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="编辑配件规格" />
        <div className="text-sm text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="编辑配件规格" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">规格名称 *</label>
          <input
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">关联配件名称（可选，可关联多个）</label>
          <div className="relative">
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="搜索配件名称并添加..."
              value={pnQuery}
              onChange={(e) => setPnQuery(e.target.value)}
            />
            {pnSearching && <div className="text-xs text-gray-400 mt-1">搜索中...</div>}
            {pnResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {pnResults.map((pn) => (
                  <button
                    key={pn.id}
                    type="button"
                    onClick={() => addLinkedName(pn)}
                    disabled={linkedNames.some((n) => n.id === pn.id)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 disabled:opacity-40 border-b border-gray-100 last:border-0"
                  >
                    <div className="text-sm text-gray-900">{pn.name}</div>
                    <div className="text-xs text-gray-400">{pn.part_categories?.name || "-"}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {linkedNames.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {linkedNames.map((n) => (
                <span
                  key={n.id}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-md border border-blue-200"
                >
                  {n.name}
                  <button
                    type="button"
                    onClick={() => removeLinkedName(n.id)}
                    className="text-blue-400 hover:text-blue-600"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.push("/part-specifications")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
