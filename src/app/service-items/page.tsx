"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import * as XLSX from "xlsx";
import { DeleteButton } from "./DeleteButton";

interface ServiceItem {
  id: string;
  code: string | null;
  name: string;
  standard_hours: number | null;
  default_price: number | null;
  is_vehicle_specific: boolean;
  service_categories: { name: string } | null;
  service_names: { name: string } | null;
}

const importFields = [
  { key: "项目名称", required: true },
  { key: "分类名称", required: true },
  { key: "标准工时", required: false },
  { key: "项目说明", required: false },
  { key: "销售价", required: false },
  { key: "VIP价", required: false },
  { key: "自带配件价", required: false },
  { key: "单位价", required: false },
];

export default function ServiceItemsPage() {
  const supabase = createClient();
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadItems() {
    setLoading(true);
    const { data } = await supabase
      .from("service_items")
      .select("*, service_categories(name), service_names(name)")
      .order("created_at", { ascending: false });
    setItems((data as ServiceItem[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    loadItems();
  }, [supabase]);

  function handleDownloadTemplate() {
    const headers = importFields.map((f) => f.key);
    const example = [
      "更换机油",
      "常规保养",
      0.5,
      "含机油滤芯更换",
      280,
      250,
      200,
      220,
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "维修项目导入模板");
    XLSX.writeFile(wb, "维修项目导入模板.xlsx");
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

      // 加载所有分类用于名称匹配
      setImportMsg("正在加载分类数据...");
      const { data: categories } = await supabase.from("service_categories").select("id, name");
      const categoryMap = new Map((categories || []).map((c: any) => [c.name, c.id]));

      const records: any[] = [];
      const errors: string[] = [];

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

        const autoCode = `XM-${Date.now().toString(36).toUpperCase().slice(-6)}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
        records.push({
          code: autoCode,
          category_id: categoryId,
          name: String(record["项目名称"]).trim(),
          standard_hours: record["标准工时"] ? parseFloat(record["标准工时"]) : null,
          description: record["项目说明"] ? String(record["项目说明"]).trim() : null,
          default_price: record["销售价"] ? parseFloat(record["销售价"]) : null,
          vip_price: record["VIP价"] ? parseFloat(record["VIP价"]) : null,
          customer_parts_price: record["自带配件价"] ? parseFloat(record["自带配件价"]) : null,
          company_price: record["单位价"] ? parseFloat(record["单位价"]) : null,
        });
      }

      if (records.length === 0) {
        setImportMsg("没有有效数据可导入\n" + errors.slice(0, 5).join("\n"));
        setImporting(false);
        return;
      }

      setImportMsg(`验证通过 ${records.length} 条，开始导入...`);
      const batchSize = 100;
      let inserted = 0;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error } = await supabase.from("service_items").insert(batch);
        if (error) {
          setImportMsg(`第 ${i + 1} 批导入失败: ${error.message}`);
          setImporting(false);
          return;
        }
        inserted += batch.length;
        setImportMsg(`已导入 ${inserted}/${records.length} 条...`);
      }

      let msg = `导入完成：新增 ${inserted} 条`;
      if (errors.length > 0) {
        msg += `，跳过 ${errors.length} 条（有错误）`;
      }
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
        title="维修项目"
        description="管理维修项目实例，关联分类和名称库"
        action={{ href: "/service-items/new", label: "新建项目" }}
      />

      {/* 导入工具栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
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

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">编码</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">项目名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">标准工时</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">默认价格</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车型定价</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items?.map((item: any) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-gray-600">{item.code || "-"}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                  <td className="px-6 py-4 text-gray-600">{item.service_categories?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{item.standard_hours || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{formatCurrency(item.default_price)}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-0.5 rounded ${item.is_vehicle_specific ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600"}`}>
                      {item.is_vehicle_specific ? "按车型定价" : "通用价格"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link href={`/service-items/${item.id}/edit`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">编辑</Link>
                      <DeleteButton id={item.id} name={item.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {(!items || items.length === 0) && (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">暂无维修项目</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
