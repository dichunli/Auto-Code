"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import * as XLSX from "xlsx";
import { DeleteButton } from "./DeleteButton";

interface ServiceName {
  id: string;
  name: string;
  search_keywords: string | null;
  service_categories: { name: string } | null;
  service_name_part_names: any[];
}

const importFields = [
  { key: "项目名称", required: true },
  { key: "分类名称", required: true },
  { key: "搜索关键词", required: false },
];

export default function ServiceNamesPage() {
  const supabase = createClient();
  const [items, setItems] = useState<ServiceName[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("service_names")
      .select("*, service_categories(name), service_name_part_names(count)")
      .order("created_at", { ascending: false });

    if (searchName.trim()) {
      const s = searchName.trim();
      query = query.or(`name.ilike.%${s}%,search_keywords.ilike.%${s}%`);
    }

    const { data } = await query;
    setItems((data as ServiceName[]) || []);
    setLoading(false);
  }, [supabase, searchName]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  function handleDownloadTemplate() {
    const headers = importFields.map((f) => f.key);
    const example = ["更换机油", "常规保养", "机油 保养 小保养"];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "维修项目名称导入模板");
    XLSX.writeFile(wb, "维修项目名称导入模板.xlsx");
  }

  function handleExport() {
    const headers = ["项目名称", "所属分类", "搜索关键词", "关联配件数"];
    const rows = items.map((n) => [
      n.name,
      n.service_categories?.name || "",
      n.search_keywords || "",
      (n.service_name_part_names as any)?.[0]?.count ?? 0,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "维修项目名称");
    XLSX.writeFile(wb, `维修项目名称库_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
      const { data: categories } = await supabase.from("service_categories").select("id, name");
      const categoryMap = new Map((categories || []).map((c: any) => [c.name, c.id]));

      const records: any[] = [];
      const errors: string[] = [];
      const seenInFile = new Map<string, number>();
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
        if (!record["项目名称"]) {
          errors.push(`第 ${rowNum} 行: 项目名称不能为空`);
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

        const name = String(record["项目名称"]).trim();

        if (seenInFile.has(name)) {
          duplicateInFile++;
          errors.push(`第 ${rowNum} 行: 项目名称"${name}"与第 ${seenInFile.get(name)} 行重复，已跳过`);
          continue;
        }
        seenInFile.set(name, rowNum);

        records.push({
          name,
          category_id: categoryId,
          search_keywords: record["搜索关键词"] ? String(record["搜索关键词"]).trim() : null,
        });
      }

      if (records.length === 0) {
        setImportMsg("没有有效数据可导入\n" + errors.slice(0, 5).join("\n"));
        setImporting(false);
        return;
      }

      setImportMsg(`验证通过 ${records.length} 条，正在检查重复名称...`);
      const allNames = records.map((r) => r.name);
      const existingNames = new Set<string>();
      const queryBatchSize = 200;
      for (let i = 0; i < allNames.length; i += queryBatchSize) {
        const namesBatch = allNames.slice(i, i + queryBatchSize);
        const { data: existing } = await supabase
          .from("service_names")
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
        const { error } = await supabase.from("service_names").insert(batch);
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
      loadItems();
    } catch (err: any) {
      setImportMsg("导入出错: " + (err.message || String(err)));
    }
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div>
      <PageHeader
        title="维修项目名称库"
        description="标准化项目名称，支持分类关联和搜索关键词"
        action={{ href: "/service-names/new", label: "新建名称" }}
      />

      {/* 搜索栏 */}
      <div className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadItems();
            }}
            placeholder="搜索项目名称或关键词"
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button
            onClick={() => { setSearchName(""); loadItems(); }}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            重置
          </button>
          <button
            onClick={loadItems}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            搜索
          </button>
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
          <button
            type="button"
            onClick={handleExport}
            className="px-3 py-2 text-sm font-medium text-green-600 bg-white border border-green-300 rounded-lg hover:bg-green-50"
          >
            导出Excel
          </button>
          {importMsg && (
            <span className="text-sm text-gray-600">{importMsg}</span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">项目名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">所属分类</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">搜索关键词</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联配件</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items?.map((n: any) => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{n.name}</td>
                  <td className="px-6 py-4 text-gray-600">{n.service_categories?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">{n.search_keywords || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{(n.service_name_part_names as any)?.[0]?.count ?? 0}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link href={`/service-names/${n.id}/edit`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">编辑</Link>
                      <DeleteButton id={n.id} name={n.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!items || items.length === 0) && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">{loading ? "加载中..." : "暂无数据"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
