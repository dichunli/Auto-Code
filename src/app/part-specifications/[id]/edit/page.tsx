"use client";

import {useState, useEffect, useMemo} from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { 更新配件规格 } from "../../actions";
import { 清理搜索词 } from "@/lib/sanitizeQuery";
import { SearchDropdown } from "@/components/SearchDropdown";

export default function EditPartSpecificationPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  const [pnQuery, setPnQuery] = useState("");
  interface PartNameResult {
    id: string;
    name: string;
    part_categories: { name: string } | null;
  }

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
      interface LinkRow {
        part_name_id: string;
        part_names: { name: string; part_categories: { name: string } | null } | null;
      }
      setLinkedNames(
        ((links || []) as unknown as LinkRow[]).map((l) => ({
          id: l.part_name_id,
          name: l.part_names?.name ?? "",
          category_name: l.part_names?.part_categories?.name,
        }))
      );
      setLoading(false);
    }
    load();
  }, [id, supabase, router]);

  /* 配件名称联想查询（查询条件与原防抖块一致，仅换成 SearchDropdown 的 searchFn） */
  async function 搜索配件名称(q: string): Promise<PartNameResult[]> {
    const { data } = await supabase
      .from("part_names")
      .select("id, name, part_categories(name)")
      .or(`name.ilike.%${清理搜索词(q)}%,search_keywords.ilike.%${清理搜索词(q)}%`)
      .order("name")
      .limit(10);
    return (data || []) as unknown as PartNameResult[];
  }

  function addLinkedName(pn: PartNameResult) {
    if (linkedNames.some((n) => n.id === pn.id)) return;
    setLinkedNames((prev) => [
      ...prev,
      { id: pn.id, name: pn.name, category_name: pn.part_categories?.name },
    ]);
    setPnQuery("");
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

    /* 写库走 Server Action（改名 + 关联差量同步，服务端一次完成） */
    const result = await 更新配件规格({
      id,
      name,
      linkedPartNameIds: linkedNames.map((n) => n.id),
    });
    if (!result.success) {
      alert("保存失败: " + (result.error || "未知错误"));
      setSaving(false);
      return;
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
          <SearchDropdown<PartNameResult>
            value={pnQuery}
            onQueryChange={setPnQuery}
            searchFn={搜索配件名称}
            getKey={(pn) => pn.id}
            onSelect={addLinkedName}
            placeholder="搜索配件名称并添加..."
            renderItem={(pn) => (
              <div className={linkedNames.some((n) => n.id === pn.id) ? "opacity-40" : ""}>
                <div className="text-sm text-gray-900">{pn.name}</div>
                <div className="text-xs text-gray-400">{pn.part_categories?.name || "-"}</div>
              </div>
            )}
          />

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
