"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { DeleteButton } from "./DeleteButton";
import { BatchLinkDialog } from "./BatchLinkDialog";

function normalize(str: string) {
  return str.toLowerCase().replace(/[\s\p{P}]/gu, "");
}

export default function PartSpecificationsPage() {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [allSpecs, setAllSpecs] = useState<any[]>([]);
  const [filteredSpecs, setFilteredSpecs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchLink, setShowBatchLink] = useState(false);

  const [name, setName] = useState("");
  const [pnQuery, setPnQuery] = useState("");
  const [pnResults, setPnResults] = useState<any[]>([]);
  const [pnSearching, setPnSearching] = useState(false);
  const [linkedNames, setLinkedNames] = useState<{ id: string; name: string; category_name?: string }[]>([]);

  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadSpecs = useCallback(
    async () => {
      setSearching(true);
      const { data } = await supabase
        .from("part_specifications")
        .select("*, part_name_specifications(part_names(id, name, part_categories(name)))")
        .order("usage_count", { ascending: false });
      const list = data || [];
      setAllSpecs(list);
      setFilteredSpecs(list);
      setLoading(false);
      setSearching(false);
    },
    [supabase]
  );

  useEffect(() => {
    loadSpecs();
  }, [loadSpecs]);

  useEffect(() => {
    if (!query.trim()) {
      setFilteredSpecs(allSpecs);
      return;
    }
    const nq = normalize(query);
    const filtered = allSpecs.filter((s) => {
      const links = s.part_name_specifications || [];
      const names = links.map((l: any) => l.part_names?.name).filter(Boolean);
      const categories = links.map((l: any) => l.part_names?.part_categories?.name).filter(Boolean);
      const searchable = [s.name, ...names, ...categories].join(" ");
      return normalize(searchable).includes(nq);
    });
    setFilteredSpecs(filtered);
  }, [query, allSpecs]);

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
        .or(`name.ilike.%${pnQuery.trim()}%,search_keywords.ilike.%${pnQuery.trim()}%`)
        .order("name")
        .limit(10);
      setPnResults(data || []);
      setPnSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [pnQuery, supabase]);

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredSpecs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSpecs.map((s) => s.id)));
    }
  }

  function handleStartCreate() {
    setName(query.trim());
    setShowForm(true);
  }

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

    const { data: specData, error: specError } = await supabase
      .from("part_specifications")
      .insert({ name: name.trim() })
      .select("id")
      .single();

    if (specError || !specData) {
      alert("保存失败: " + (specError?.message || "未知错误"));
      setSaving(false);
      return;
    }

    const specId = specData.id;
    if (linkedNames.length > 0) {
      const rows = linkedNames.map((n) => ({
        specification_id: specId,
        part_name_id: n.id,
      }));
      const { error: linkError } = await supabase.from("part_name_specifications").insert(rows);
      if (linkError) {
        alert("规格创建成功，但关联配件名称失败: " + linkError.message);
        setSaving(false);
        return;
      }
    }

    setShowForm(false);
    setQuery("");
    setName("");
    setLinkedNames([]);
    setPnQuery("");
    setPnResults([]);
    loadSpecs();
    setSaving(false);
  }

  function formatLinkedNames(s: any) {
    const list = s.part_name_specifications?.map((l: any) => l.part_names?.name).filter(Boolean);
    if (!list || list.length === 0) return "-";
    return list.join("、");
  }

  function formatLinkedCategories(s: any) {
    const set = new Set<string>();
    for (const l of s.part_name_specifications || []) {
      const cat = l.part_names?.part_categories?.name;
      if (cat) set.add(cat);
    }
    if (set.size === 0) return "-";
    return Array.from(set).join("、");
  }

  function handleExport() {
    const rows = [["规格名称"], ...allSpecs.map((s) => [s.name])];
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
      alert("CSV 文件为空或只有表头");
      setImportLoading(false);
      return;
    }

    const namesToInsert: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      if (cols[0]) namesToInsert.push(cols[0]);
    }

    let success = 0;
    let failed = 0;
    for (const n of namesToInsert) {
      const { error } = await supabase.from("part_specifications").insert({ name: n });
      if (error) failed++;
      else success++;
    }

    alert(`导入完成：成功 ${success} 条，失败 ${failed} 条`);
    setImportOpen(false);
    setImportLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    loadSpecs();
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
                    checked={filteredSpecs.length > 0 && selectedIds.size === filteredSpecs.length}
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
              {filteredSpecs?.map((s: any) => (
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
                      <DeleteButton id={s.id} name={s.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!filteredSpecs || filteredSpecs.length === 0) && !showForm && (
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
      </div>

      <BatchLinkDialog
        open={showBatchLink}
        selectedSpecIds={Array.from(selectedIds)}
        onClose={() => { setShowBatchLink(false); setSelectedIds(new Set()); }}
        onSuccess={() => { setSelectedIds(new Set()); loadSpecs(); }}
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
              <div className="relative">
                <input
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="搜索配件名称并添加..."
                  value={pnQuery}
                  onChange={(e) => setPnQuery(e.target.value)}
                />
                {pnSearching && (
                  <div className="text-xs text-gray-400 mt-1">搜索中...</div>
                )}
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
                onClick={() => {
                  setShowForm(false);
                  setLinkedNames([]);
                  setPnQuery("");
                  setPnResults([]);
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
