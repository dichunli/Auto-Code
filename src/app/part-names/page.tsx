"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import * as XLSX from "xlsx";
import { DeleteButton } from "./DeleteButton";
import { BatchLinkDialog } from "./BatchLinkDialog";
import { BatchMergeDialog } from "./BatchMergeDialog";
import { SearchLinkSection } from "./SearchLinkSection";

interface LinkedItem {
  id: string;
  name: string;
}

const importFields = [
  { key: "配件名称", required: true },
  { key: "分类名称", required: true },
  { key: "单位", required: false },
  { key: "搜索关键词", required: false },
  { key: "自动关联车型", required: false },
  { key: "是否耗材", required: false },
];

export default function PartNamesPage() {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [names, setNames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchType, setBatchType] = useState<"brand" | "specification" | null>(null);
  const [showBatchMerge, setShowBatchMerge] = useState(false);

  const [categories, setCategories] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "",
    category_id: "",
    unit: "件",
    search_keywords: "",
    default_quantity: "",
    auto_link_vehicle_model: false,
    is_consumable: false,
    sales_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    sales_value: "",
    diagnosis_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    diagnosis_value: "",
    repair_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    repair_value: "",
    qc_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    qc_value: "",
    picking_type: "" as "" | "revenue_pct" | "profit_pct" | "fixed",
    picking_value: "",
  });

  const [linkedBrands, setLinkedBrands] = useState<LinkedItem[]>([]);
  const [linkedSpecs, setLinkedSpecs] = useState<LinkedItem[]>([]);

  const [brandQuery, setBrandQuery] = useState("");
  const [brandResults, setBrandResults] = useState<any[] | null>(null);
  const [brandSearching, setBrandSearching] = useState(false);

  const [specQuery, setSpecQuery] = useState("");
  const [specResults, setSpecResults] = useState<any[] | null>(null);
  const [specSearching, setSpecSearching] = useState(false);

  const loadNames = useCallback(
    async (search?: string) => {
      setSearching(!!search);
      let q = supabase
        .from("part_names")
        .select(
          "*, part_categories(name), part_name_brands(part_brands(id, name)), part_name_specifications(part_specifications(id, name))"
        )
        .order("created_at", { ascending: false });
      if (search?.trim()) {
        const s = search.trim();
        q = q.or(`name.ilike.%${s}%,search_keywords.ilike.%${s}%`);
      }
      const { data } = await q;
      setNames(data || []);
      setLoading(false);
      setSearching(false);
    },
    [supabase]
  );

  useEffect(() => {
    loadNames();
    supabase
      .from("part_categories")
      .select(
        "id, name, auto_link_vehicle_model, is_consumable, sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value, picking_commission_type, picking_commission_value"
      )
      .order("name")
      .then(({ data }) => setCategories(data || []));
  }, [supabase, loadNames]);

  useEffect(() => {
    const t = setTimeout(() => loadNames(query), 300);
    return () => clearTimeout(t);
  }, [query, loadNames]);

  useEffect(() => {
    setBrandResults(null);
    const t = setTimeout(async () => {
      if (!brandQuery.trim()) return;
      setBrandSearching(true);
      const { data } = await supabase.from("part_brands").select("id, name").ilike("name", `%${brandQuery.trim()}%`).order("name").limit(10);
      setBrandResults(data || []);
      setBrandSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [brandQuery, supabase]);

  useEffect(() => {
    setSpecResults(null);
    const t = setTimeout(async () => {
      if (!specQuery.trim()) return;
      setSpecSearching(true);
      const { data } = await supabase.from("part_specifications").select("id, name").ilike("name", `%${specQuery.trim()}%`).order("name").limit(10);
      setSpecResults(data || []);
      setSpecSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [specQuery, supabase]);

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function toggleSelectAll() {
    if (selectedIds.size === names.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(names.map((n) => n.id)));
    }
  }

  function handleStartCreate() {
    setForm((prev) => ({ ...prev, name: query.trim() }));
    setShowForm(true);
  }

  function handleDownloadTemplate() {
    const headers = importFields.map((f) => f.key);
    const example = [
      "机油",
      "常规保养",
      "升",
      "机油 润滑油 发动机油",
      "否",
      "否",
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "配件名称导入模板");
    XLSX.writeFile(wb, "配件名称导入模板.xlsx");
  }

  function parseBool(value: any): boolean {
    if (value === undefined || value === null || value === "") return false;
    const s = String(value).trim().toLowerCase();
    return s === "是" || s === "yes" || s === "true" || s === "1" || s === "y";
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportMsg("正在读取文件...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (rows.length < 2) {
        setImportMsg("文件中没有数据");
        setImporting(false);
        return;
      }

      const headers: string[] = rows[0];
      const dataRows = rows.slice(1);

      setImportMsg("正在加载分类数据...");
      const { data: categories } = await supabase.from("part_categories").select("id, name");
      const categoryMap = new Map((categories || []).map((c: any) => [c.name, c.id]));

      const records: any[] = [];
      const errors: string[] = [];
      const seenInFile = new Map<string, number>(); // 文件内重名记录:name -> 首次出现的行号
      let duplicateInFile = 0;

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const record: any = {};
        for (let j = 0; j < headers.length; j++) {
          const key = headers[j];
          let value = row[j];
          if (value === undefined || value === "") value = null;
          record[key] = value;
        }

        const rowNum = i + 2;
        if (!record["配件名称"]) {
          errors.push(`第 ${rowNum} 行: 配件名称不能为空`);
          continue;
        }
        if (!record["分类名称"]) {
          errors.push(`第 ${rowNum} 行: 分类名称不能为空`);
          continue;
        }

        const categoryId = categoryMap.get(record["分类名称"]);
        if (!categoryId) {
          errors.push(`第 ${rowNum} 行: 分类"${record["分类名称"]}"不存在，请先创建该分类`);
          continue;
        }

        const name = String(record["配件名称"]).trim();

        // 文件内重名检查
        if (seenInFile.has(name)) {
          duplicateInFile++;
          errors.push(`第 ${rowNum} 行: 配件名称"${name}"与第 ${seenInFile.get(name)} 行重复，已跳过`);
          continue;
        }
        seenInFile.set(name, rowNum);

        records.push({
          name,
          category_id: categoryId,
          unit: record["单位"] ? String(record["单位"]).trim() : "件",
          search_keywords: record["搜索关键词"] ? String(record["搜索关键词"]).trim() : null,
          auto_link_vehicle_model: parseBool(record["自动关联车型"]),
          is_consumable: parseBool(record["是否耗材"]),
        });
      }

      if (records.length === 0) {
        setImportMsg("没有有效数据可导入\n" + errors.slice(0, 5).join("\n"));
        setImporting(false);
        return;
      }

      // 查询数据库中已存在的名称,过滤重复
      setImportMsg(`验证通过 ${records.length} 条，正在检查重复名称...`);
      const allNames = records.map((r) => r.name);
      const existingNames = new Set<string>();
      // 分批查询,避免 in() 参数过多
      const queryBatchSize = 200;
      for (let i = 0; i < allNames.length; i += queryBatchSize) {
        const namesBatch = allNames.slice(i, i + queryBatchSize);
        const { data: existing } = await supabase
          .from("part_names")
          .select("name")
          .in("name", namesBatch);
        (existing || []).forEach((row: any) => existingNames.add(row.name));
      }

      const toInsert = records.filter((r) => !existingNames.has(r.name));
      const duplicateInDb = records.length - toInsert.length;

      if (toInsert.length === 0) {
        let msg = `导入完成：新增 0 条`;
        if (duplicateInDb > 0) msg += `，${duplicateInDb} 条名称已存在`;
        if (duplicateInFile > 0) msg += `，文件内重名 ${duplicateInFile} 条`;
        const otherErrors = errors.length - duplicateInFile;
        if (otherErrors > 0) msg += `，${otherErrors} 条有错误`;
        setImportMsg(msg);
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      setImportMsg(`将导入 ${toInsert.length} 条（跳过 ${duplicateInDb} 条已存在），开始导入...`);
      const batchSize = 100;
      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += batchSize) {
        const batch = toInsert.slice(i, i + batchSize);
        const { error } = await supabase.from("part_names").insert(batch);
        if (error) {
          setImportMsg(`第 ${i + 1} 批导入失败: ${error.message}`);
          setImporting(false);
          return;
        }
        inserted += batch.length;
        setImportMsg(`已导入 ${inserted}/${toInsert.length} 条...`);
      }

      let msg = `导入完成：新增 ${inserted} 条`;
      if (duplicateInDb > 0) msg += `，跳过 ${duplicateInDb} 条（名称已存在）`;
      if (duplicateInFile > 0) msg += `，文件内重名 ${duplicateInFile} 条`;
      const otherErrors = errors.length - duplicateInFile;
      if (otherErrors > 0) msg += `，${otherErrors} 条有错误`;
      setImportMsg(msg);
      loadNames(query);
    } catch (err: any) {
      setImportMsg("导入出错: " + (err.message || String(err)));
    }
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleCategoryChange(categoryId: string) {
    const cat = categories.find((c) => c.id === categoryId);
    if (cat) {
      setForm((prev) => ({
        ...prev,
        category_id: categoryId,
        auto_link_vehicle_model: cat.auto_link_vehicle_model || false,
        is_consumable: cat.is_consumable || false,
        sales_type: cat.sales_commission_type || "",
        sales_value: cat.sales_commission_value?.toString() || "",
        diagnosis_type: cat.diagnosis_commission_type || "",
        diagnosis_value: cat.diagnosis_commission_value?.toString() || "",
        repair_type: cat.repair_commission_type || "",
        repair_value: cat.repair_commission_value?.toString() || "",
        qc_type: cat.qc_commission_type || "",
        qc_value: cat.qc_commission_value?.toString() || "",
        picking_type: cat.picking_commission_type || "",
        picking_value: cat.picking_commission_value?.toString() || "",
      }));
    } else {
      setForm((prev) => ({ ...prev, category_id: categoryId }));
    }
  }

  async function createBrandAndLink() {
    if (!brandQuery.trim()) return;
    const { data, error } = await supabase.from("part_brands").insert({ name: brandQuery.trim() }).select("id, name").single();
    if (error || !data) { alert("创建品牌失败: " + (error?.message || "未知错误")); return; }
    addBrand({ id: data.id, name: data.name });
    setBrandQuery("");
  }

  async function createSpecAndLink() {
    if (!specQuery.trim()) return;
    const { data, error } = await supabase.from("part_specifications").insert({ name: specQuery.trim() }).select("id, name").single();
    if (error || !data) { alert("创建规格失败: " + (error?.message || "未知错误")); return; }
    addSpec({ id: data.id, name: data.name });
    setSpecQuery("");
  }

  function addBrand(b: LinkedItem) {
    if (linkedBrands.some((x) => x.id === b.id)) return;
    setLinkedBrands((prev) => [...prev, b]);
    setBrandQuery("");
    setBrandResults(null);
  }

  function removeBrand(id: string) {
    setLinkedBrands((prev) => prev.filter((x) => x.id !== id));
  }

  function addSpec(s: LinkedItem) {
    if (linkedSpecs.some((x) => x.id === s.id)) return;
    setLinkedSpecs((prev) => [...prev, s]);
    setSpecQuery("");
    setSpecResults(null);
  }

  function removeSpec(id: string) {
    setLinkedSpecs((prev) => prev.filter((x) => x.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.category_id) {
      alert("请填写配件名称和所属分类");
      return;
    }
    setSaving(true);

    // 检查名称是否重复
    const trimmedName = form.name.trim();
    const { data: existed } = await supabase
      .from("part_names")
      .select("id")
      .eq("name", trimmedName)
      .limit(1);
    if (existed && existed.length > 0) {
      alert(`配件名称"${trimmedName}"已存在，请使用其他名称`);
      setSaving(false);
      return;
    }

    const { data: inserted, error } = await supabase.from("part_names").insert({
      name: trimmedName,
      category_id: form.category_id,
      unit: form.unit,
      search_keywords: form.search_keywords || null,
      default_quantity: form.default_quantity ? parseInt(form.default_quantity) : null,
      auto_link_vehicle_model: form.auto_link_vehicle_model,
      is_consumable: form.is_consumable,
      sales_commission_type: form.sales_type || null,
      sales_commission_value: form.sales_value ? parseFloat(form.sales_value) : null,
      diagnosis_commission_type: form.diagnosis_type || null,
      diagnosis_commission_value: form.diagnosis_value ? parseFloat(form.diagnosis_value) : null,
      repair_commission_type: form.repair_type || null,
      repair_commission_value: form.repair_value ? parseFloat(form.repair_value) : null,
      qc_commission_type: form.qc_type || null,
      qc_commission_value: form.qc_value ? parseFloat(form.qc_value) : null,
      picking_commission_type: form.picking_type || null,
      picking_commission_value: form.picking_value ? parseFloat(form.picking_value) : null,
    }).select("id").single();

    if (error || !inserted) {
      alert("保存失败: " + (error?.message || "未知错误"));
      setSaving(false);
      return;
    }

    const newId = inserted.id;
    if (linkedBrands.length > 0) {
      await supabase.from("part_name_brands").insert(linkedBrands.map((b) => ({ part_name_id: newId, brand_id: b.id })));
    }
    if (linkedSpecs.length > 0) {
      await supabase.from("part_name_specifications").insert(linkedSpecs.map((s) => ({ part_name_id: newId, specification_id: s.id })));
    }

    setShowForm(false);
    setQuery("");
    setForm({
      name: "",
      category_id: "",
      unit: "件",
      search_keywords: "",
      default_quantity: "",
      auto_link_vehicle_model: false,
      is_consumable: false,
      sales_type: "",
      sales_value: "",
      diagnosis_type: "",
      diagnosis_value: "",
      repair_type: "",
      repair_value: "",
      qc_type: "",
      qc_value: "",
      picking_type: "",
      picking_value: "",
    });
    setLinkedBrands([]);
    setLinkedSpecs([]);
    setBrandQuery("");
    setSpecQuery("");
    loadNames("");
    setSaving(false);
  }

  function CommissionField({
    label,
    typeValue,
    valueValue,
    onTypeChange,
    onValueChange,
  }: {
    label: string;
    typeValue: string;
    valueValue: string;
    onTypeChange: (v: string) => void;
    onValueChange: (v: string) => void;
  }) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">{label}方式</label>
          <select
            className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
            value={typeValue}
            onChange={(e) => onTypeChange(e.target.value)}
          >
            <option value="">无提成</option>
            <option value="revenue_pct">按产值(%)</option>
            <option value="profit_pct">按毛利(%)</option>
            <option value="fixed">固定金额</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{label}数值</label>
          <input
            type="number"
            className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
            value={valueValue}
            onChange={(e) => onValueChange(e.target.value)}
            disabled={!typeValue}
          />
        </div>
      </div>
    );
  }

  function formatLinkedBrands(n: any) {
    const list = n.part_name_brands?.map((b: any) => b.part_brands?.name).filter(Boolean);
    if (!list || list.length === 0) return "-";
    return list.join("、");
  }

  function formatLinkedSpecs(n: any) {
    const list = n.part_name_specifications?.map((s: any) => s.part_specifications?.name).filter(Boolean);
    if (!list || list.length === 0) return "-";
    return list.join("、");
  }

  return (
    <div>
      <PageHeader title="配件名称库" description="管理标准配件名称，新建配件时自动带入" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="w-1/4 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="搜索配件名称..."
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
        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="px-3 py-2 text-sm font-medium text-blue-600 bg-white border border-blue-300 rounded-lg hover:bg-blue-50"
        >
          下载导入模板
        </button>
        <label className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer disabled:opacity-50">
          {importing ? "导入中..." : "批量导入"}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
            }}
          />
        </label>
        {importMsg && (
          <span className="text-sm text-gray-600">{importMsg}</span>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm text-blue-700">已选择 {selectedIds.size} 项</span>
          <button
            onClick={() => setBatchType("brand")}
            className="px-3 py-1 text-xs font-medium text-blue-700 bg-white border border-blue-300 rounded hover:bg-blue-100"
          >
            批量关联品牌
          </button>
          <button
            onClick={() => setBatchType("specification")}
            className="px-3 py-1 text-xs font-medium text-blue-700 bg-white border border-blue-300 rounded hover:bg-blue-100"
          >
            批量关联规格
          </button>
          {selectedIds.size >= 2 && (
            <button
              onClick={() => setShowBatchMerge(true)}
              className="px-3 py-1 text-xs font-medium text-orange-700 bg-white border border-orange-300 rounded hover:bg-orange-50"
            >
              合并
            </button>
          )}
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
                    checked={names.length > 0 && selectedIds.size === names.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4"
                  />
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联品牌</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联规格</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">单位</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">默认数量</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {names?.map((n: any) => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(n.id)}
                      onChange={() => toggleSelect(n.id)}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900">{n.name}</td>
                  <td className="px-6 py-4 text-gray-600">{n.part_categories?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600 max-w-[140px] truncate">{formatLinkedBrands(n)}</td>
                  <td className="px-6 py-4 text-gray-600 max-w-[140px] truncate">{formatLinkedSpecs(n)}</td>
                  <td className="px-6 py-4 text-gray-600">{n.unit || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{n.default_quantity ?? "-"}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link href={`/part-names/${n.id}/edit`} className="text-sm text-blue-600 hover:text-blue-700 font-medium">编辑</Link>
                      <DeleteButton id={n.id} name={n.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!names || names.length === 0) && !showForm && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <div className="text-gray-400 mb-4">
                      {searching ? "搜索中..." : query.trim() ? "未找到匹配的名称" : "暂无名称"}
                    </div>
                    <button
                      onClick={handleStartCreate}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      新建名称
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <BatchLinkDialog
        open={batchType !== null}
        type={batchType || "brand"}
        selectedIds={Array.from(selectedIds)}
        onClose={() => setBatchType(null)}
        onSuccess={() => { setSelectedIds(new Set()); loadNames(); }}
      />

      <BatchMergeDialog
        open={showBatchMerge}
        selectedNames={names.filter((n) => selectedIds.has(n.id)).map((n) => ({ id: n.id, name: n.name }))}
        onClose={() => setShowBatchMerge(false)}
        onSuccess={() => { setSelectedIds(new Set()); setShowBatchMerge(false); loadNames(); }}
      />

      {showForm && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
          <h2 className="text-base font-semibold text-gray-900 mb-4">新建配件名称</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">配件名称 *</label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：机油、空气滤芯"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">所属分类 *</label>
              <select
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.category_id}
                onChange={(e) => handleCategoryChange(e.target.value)}
              >
                <option value="">请选择</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">单位</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：件、升、个"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">搜索关键词</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：机油 润滑油 发动机油"
                value={form.search_keywords}
                onChange={(e) => setForm({ ...form, search_keywords: e.target.value })}
              />
              <p className="text-xs text-gray-400 mt-1">用于模糊搜索，多个词用空格分隔</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">默认数量</label>
              <input
                type="number"
                min={1}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="关联到维修项目时的默认使用数量，留空则为1"
                value={form.default_quantity}
                onChange={(e) => setForm({ ...form, default_quantity: e.target.value })}
              />
            </div>

            <SearchLinkSection
              label="关联品牌"
              query={brandQuery}
              setQuery={setBrandQuery}
              results={brandResults}
              searching={brandSearching}
              linked={linkedBrands}
              onAdd={addBrand}
              onRemove={removeBrand}
              onCreate={createBrandAndLink}
            />

            <SearchLinkSection
              label="关联规格"
              query={specQuery}
              setQuery={setSpecQuery}
              results={specResults}
              searching={specSearching}
              linked={linkedSpecs}
              onAdd={addSpec}
              onRemove={removeSpec}
              onCreate={createSpecAndLink}
            />

            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">分类属性（选择分类后自动带入，可修改）</h3>
              <div className="flex gap-6 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.auto_link_vehicle_model}
                    onChange={(e) => setForm({ ...form, auto_link_vehicle_model: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">自动关联车型</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_consumable}
                    onChange={(e) => setForm({ ...form, is_consumable: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">耗材（出库不计入营业额）</span>
                </label>
              </div>
              <div className="space-y-4">
                <CommissionField
                  label="销售提成"
                  typeValue={form.sales_type}
                  valueValue={form.sales_value}
                  onTypeChange={(v) => setForm({ ...form, sales_type: v as any, sales_value: v ? form.sales_value : "" })}
                  onValueChange={(v) => setForm({ ...form, sales_value: v })}
                />
                <CommissionField
                  label="诊断提成"
                  typeValue={form.diagnosis_type}
                  valueValue={form.diagnosis_value}
                  onTypeChange={(v) => setForm({ ...form, diagnosis_type: v as any, diagnosis_value: v ? form.diagnosis_value : "" })}
                  onValueChange={(v) => setForm({ ...form, diagnosis_value: v })}
                />
                <CommissionField
                  label="施工提成"
                  typeValue={form.repair_type}
                  valueValue={form.repair_value}
                  onTypeChange={(v) => setForm({ ...form, repair_type: v as any, repair_value: v ? form.repair_value : "" })}
                  onValueChange={(v) => setForm({ ...form, repair_value: v })}
                />
                <CommissionField
                  label="质检提成"
                  typeValue={form.qc_type}
                  valueValue={form.qc_value}
                  onTypeChange={(v) => setForm({ ...form, qc_type: v as any, qc_value: v ? form.qc_value : "" })}
                  onValueChange={(v) => setForm({ ...form, qc_value: v })}
                />
                <CommissionField
                  label="领料提成"
                  typeValue={form.picking_type}
                  valueValue={form.picking_value}
                  onTypeChange={(v) => setForm({ ...form, picking_type: v as any, picking_value: v ? form.picking_value : "" })}
                  onValueChange={(v) => setForm({ ...form, picking_value: v })}
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-4">
              <button
                type="button"
                onClick={() => setShowForm(false)}
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
