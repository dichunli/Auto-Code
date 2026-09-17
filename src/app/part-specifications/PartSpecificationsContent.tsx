"use client";

import {useState, useEffect, useCallback, useRef, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { 清理搜索词 } from "@/lib/sanitizeQuery";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { SearchDropdown } from "@/components/SearchDropdown";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import { BatchLinkDialog } from "./BatchLinkDialog";
import { 新建规格并关联, 批量导入配件规格, 删除配件规格 } from "./actions";
import { toast } from "@/lib/globalToast";

interface PartName {
  id: string;
  name: string;
  part_categories?: { name?: string } | null;
}

interface Spec {
  id: string;
  name: string;
  usage_count?: number | null;
  part_name_specifications?: { part_names?: PartName | null }[] | null;
}

export default function PartSpecificationsContent({ initialSpecs, initialTotal, 每页数 }: { initialSpecs: unknown[]; initialTotal: number; 每页数: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [query, setQuery] = useState("");
  const [specs, setSpecs] = useState<Spec[]>(initialSpecs as Spec[]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialTotal);
  const [, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchLink, setShowBatchLink] = useState(false);

  const [name, setName] = useState("");
  const [pnQuery, setPnQuery] = useState("");
  const [linkedNames, setLinkedNames] = useState<{ id: string; name: string; category_name?: string }[]>([]);

  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 300);
  const 跳过首次查询 = useRef(true);

  /* 搜索下推到 SQL：规格名直接 ilike；关联配件名/分类名先查出名称 id，再反查关联表拿规格 id */
  const loadSpecs = useCallback(
    async (搜索词: string, 目标页: number) => {
      setSearching(true);
      const s = 清理搜索词(搜索词 || "");
      let 规格id过滤: string[] | null = null;
      if (s) {
        const [{ data: 名称命中 }, { data: 分类命中 }] = await Promise.all([
          supabase.from("part_names").select("id").ilike("name", `%${s}%`),
          supabase.from("part_names").select("id, part_categories!inner(name)").ilike("part_categories.name", `%${s}%`),
        ]);
        const 名称ids = [...new Set([...(名称命中 || []), ...(分类命中 || [])].map((r: { id: string }) => r.id))];
        if (名称ids.length > 0) {
          const { data: 关联行 } = await supabase.from("part_name_specifications").select("specification_id").in("part_name_id", 名称ids);
          规格id过滤 = [...new Set((关联行 || []).map((l: { specification_id: string }) => l.specification_id))];
        } else {
          规格id过滤 = [];
        }
      }

      let q = supabase
        .from("part_specifications")
        .select("*, part_name_specifications(part_names(id, name, part_categories(name)))", { count: "exact" })
        .order("usage_count", { ascending: false });
      if (s) {
        /* 名称命中为空时仅按规格名搜；有命中时规格名 OR 关联命中 */
        q = 规格id过滤 && 规格id过滤.length > 0
          ? q.or(`name.ilike.%${s}%,id.in.(${规格id过滤.join(",")})`)
          : q.ilike("name", `%${s}%`);
      }
      const from = (目标页 - 1) * 每页数;
      const { data, count } = await q.range(from, from + 每页数 - 1);
      setSpecs((data || []) as Spec[]);
      if (count !== null) setTotal(count);
      setPage(目标页);
      setLoading(false);
      setSearching(false);
    },
    [supabase, 每页数]
  );

  useEffect(() => {
    if (跳过首次查询.current) { 跳过首次查询.current = false; return; }
    /* 搜索词变化回到第一页 */
    loadSpecs(debouncedQuery, 1);
  }, [debouncedQuery, loadSpecs]);

  /* 配件名称联想查询（查询条件与原防抖块一致，仅换成 SearchDropdown 的 searchFn） */
  async function 搜索配件名称(q: string): Promise<PartName[]> {
    const { data } = await supabase
      .from("part_names")
      .select("id, name, part_categories(name)")
      .or(`name.ilike.%${清理搜索词(q)}%,search_keywords.ilike.%${清理搜索词(q)}%`)
      .order("name")
      .limit(10);
    return (data || []) as PartName[];
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function toggleSelectAll() {
    if (selectedIds.size === specs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(specs.map((s) => s.id)));
    }
  }

  function handleStartCreate() {
    setName(query.trim());
    setShowForm(true);
  }

  function addLinkedName(pn: PartName) {
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
      toast("请输入规格名称", "warning");
      return;
    }
    setSaving(true);

    /* 写库走 Server Action（建规格 + 关联配件名称，服务端一次完成） */
    const result = await 新建规格并关联({
      name: name.trim(),
      partNameIds: linkedNames.map((n) => n.id),
    });
    if (!result.success) {
      toast("保存失败: " + (result.error || "未知错误"), "error");
      setSaving(false);
      return;
    }

    setShowForm(false);
    setQuery("");
    setName("");
    setLinkedNames([]);
    setPnQuery("");
    loadSpecs("", 1);
    setSaving(false);
  }

  function formatLinkedNames(s: Spec) {
    const list = s.part_name_specifications?.map((l: { part_names?: PartName | null }) => l.part_names?.name).filter(Boolean);
    if (!list || list.length === 0) return "-";
    return list.join("、");
  }

  function formatLinkedCategories(s: Spec) {
    const set = new Set<string>();
    for (const l of s.part_name_specifications || []) {
      const cat = l.part_names?.part_categories?.name;
      if (cat) set.add(cat);
    }
    if (set.size === 0) return "-";
    return Array.from(set).join("、");
  }

  /* 导出语义是"全部规格"：分页后列表只剩当前页，导出时现查全量 */
  async function handleExport() {
    const { data } = await supabase.from("part_specifications").select("name").order("usage_count", { ascending: false });
    const rows = [["规格名称"], ...((data || []) as { name: string }[]).map((s) => [s.name])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `配件规格_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length <= 1) {
      toast("CSV 文件为空或只有表头", "warning");
      setImportLoading(false);
      return;
    }

    const namesToInsert: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      if (cols[0]) namesToInsert.push(cols[0]);
    }

    /* 逐条插入走 Server Action（允许部分失败，与原逻辑一致） */
    const result = await 批量导入配件规格({ names: namesToInsert });
    if (!result.success) {
      toast("导入失败: " + (result.error || "未知错误"), "error");
      setImportLoading(false);
      return;
    }

    toast(`导入完成：成功 ${result.成功 ?? 0} 条，失败 ${result.失败 ?? 0} 条`, "error");
    setImportOpen(false);
    setImportLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    loadSpecs(query, page);
  }

  return (
    <div>
      <PageHeader title="配件规格" description="管理配件规格，使用频次越高排序越靠前" />

      <div className="mb-4 flex gap-2 items-center">
        <input
          className="w-1/4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="搜索规格名称、关联配件名称或分类..."
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
        <div className="flex-1" />
        <button
          onClick={handleExport}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          导出
        </button>
        <button
          onClick={() => setImportOpen(true)}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          导入
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm text-blue-700">已选择 {selectedIds.size} 项</span>
          <button
            onClick={() => setShowBatchLink(true)}
            className="px-3 py-1 text-xs font-medium text-blue-700 bg-white border border-blue-300 rounded hover:bg-blue-100"
          >
            批量按分类关联
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="px-3 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-100"
          >
            取消选择
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={specs.length > 0 && selectedIds.size === specs.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4"
                  />
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">规格名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联配件名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联分类</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">使用频次</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {specs?.map((s: Spec) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleSelect(s.id)}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900">{s.name}</td>
                  <td className="px-6 py-4 text-gray-600 max-w-xs truncate">{formatLinkedNames(s)}</td>
                  <td className="px-6 py-4 text-gray-600 max-w-[160px] truncate">{formatLinkedCategories(s)}</td>
                  <td className="px-6 py-4 text-gray-600">{s.usage_count || 0}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link href={`/part-specifications/${s.id}/edit`} className="text-sm text-blue-600 hover:text-blue-700 font-medium">编辑</Link>
                      <DeleteButton id={s.id} 确认文案={`确定要删除规格「${s.name}」吗？`} 删除动作={删除配件规格} 按钮样式="text-sm text-red-600 hover:text-red-700 font-medium" />
                    </div>
                  </td>
                </tr>
              ))}
              {(!specs || specs.length === 0) && !showForm && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="text-gray-400 mb-4">
                      {searching ? "搜索中..." : query.trim() ? "未找到匹配的规格" : "暂无规格"}
                    </div>
                    <button
                      onClick={handleStartCreate}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      新建规格
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {total > 每页数 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-100">
            <div className="text-sm text-gray-500">
              共 {total} 条，第 {page}/{Math.ceil(total / 每页数)} 页
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadSpecs(query, page - 1)}
                disabled={page <= 1 || searching}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                上一页
              </button>
              <span className="text-sm text-gray-600 px-2">
                {page} / {Math.ceil(total / 每页数)}
              </span>
              <button
                type="button"
                onClick={() => loadSpecs(query, page + 1)}
                disabled={page >= Math.ceil(total / 每页数) || searching}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      <BatchLinkDialog
        open={showBatchLink}
        selectedSpecIds={Array.from(selectedIds)}
        onClose={() => { setShowBatchLink(false); setSelectedIds(new Set()); }}
        onSuccess={() => { setSelectedIds(new Set()); loadSpecs(query, page); }}
      />

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-gray-900 mb-2">批量导入规格</h3>
            <p className="text-sm text-gray-500 mb-4">
              请上传 CSV 文件，第一行为表头（name），每行一个规格名称。
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImportFile}
              disabled={importLoading}
              className="w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            <div className="flex gap-3 justify-end mt-4">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                disabled={importLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
          <h2 className="text-base font-semibold text-gray-900 mb-4">新建配件规格</h2>
          <form onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">规格名称 *</label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：5W-30 1L、D1109"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">关联配件名称（可选，可关联多个）</label>
              <SearchDropdown<PartName>
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
                onClick={() => {
                  setShowForm(false);
                  setLinkedNames([]);
                  setPnQuery("");
                }}
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
      )}
    </div>
  );
}
