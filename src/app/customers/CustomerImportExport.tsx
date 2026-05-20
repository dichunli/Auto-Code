"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

interface Customer {
  id: string;
  name: string;
  phone: string;
  gender?: string | null;
  company?: string | null;
  address?: string | null;
  star_level?: number | null;
  id_card?: string | null;
  notes?: string | null;
}

interface CustomerImportExportProps {
  customers: Customer[];
}

const exportHeaders = [
  { key: "name", label: "客户姓名" },
  { key: "phone", label: "电话" },
  { key: "gender", label: "性别" },
  { key: "company", label: "所属单位" },
  { key: "address", label: "地址" },
  { key: "id_card", label: "身份证号" },
  { key: "star_level", label: "星级" },
  { key: "notes", label: "备注" },
];

export default function CustomerImportExport({ customers }: CustomerImportExportProps) {
  const supabase = createClient();
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    const headers = exportHeaders.map((h) => h.label);
    const rows = customers.map((c) =>
      exportHeaders.map((h) => {
        const val = (c as any)[h.key];
        return val === null || val === undefined ? "" : String(val);
      })
    );
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "客户列表");
    XLSX.writeFile(wb, `客户列表_${new Date().toISOString().split("T")[0]}.xlsx`);
  }

  function handleDownloadTemplate() {
    const headers = exportHeaders.map((h) => h.label);
    const example = ["张三", "13800138000", "男", "某某公司", "北京市朝阳区", "110101199001011234", "5", "VIP客户"];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "客户导入模板");
    XLSX.writeFile(wb, "客户导入模板.xlsx");
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

      // 建立列名映射
      const colMap: Record<string, number> = {};
      headers.forEach((h, idx) => {
        const label = String(h).trim();
        const found = exportHeaders.find((eh) => eh.label === label);
        if (found) colMap[found.key] = idx;
      });

      if (colMap["name"] === undefined || colMap["phone"] === undefined) {
        setImportMsg("导入失败：Excel 中缺少必填列「客户姓名」或「电话」");
        setImporting(false);
        return;
      }

      const records: any[] = [];
      const phones: string[] = [];
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const name = String(row[colMap["name"]] || "").trim();
        const phone = String(row[colMap["phone"]] || "").trim();
        if (!name || !phone) continue;

        const record: any = { name, phone };
        if (colMap["gender"] !== undefined) {
          const g = String(row[colMap["gender"]] || "").trim();
          if (g === "男" || g === "女") record.gender = g;
        }
        if (colMap["company"] !== undefined) {
          record.company = String(row[colMap["company"]] || "").trim() || null;
        }
        if (colMap["address"] !== undefined) {
          record.address = String(row[colMap["address"]] || "").trim() || null;
        }
        if (colMap["id_card"] !== undefined) {
          record.id_card = String(row[colMap["id_card"]] || "").trim() || null;
        }
        if (colMap["star_level"] !== undefined) {
          const s = parseInt(row[colMap["star_level"]]);
          record.star_level = isNaN(s) ? null : Math.max(1, Math.min(5, s));
        }
        if (colMap["notes"] !== undefined) {
          record.notes = String(row[colMap["notes"]] || "").trim() || null;
        }
        records.push(record);
        phones.push(phone);
      }

      if (records.length === 0) {
        setImportMsg("没有有效的数据行（客户姓名和电话不能为空）");
        setImporting(false);
        return;
      }

      setImportMsg(`正在检查 ${records.length} 条数据的电话唯一性...`);

      // 检查电话是否已存在
      const existingPhones = new Set<string>();
      for (let i = 0; i < phones.length; i += 500) {
        const batch = phones.slice(i, i + 500);
        const { data } = await supabase.from("customers").select("phone").in("phone", batch);
        data?.forEach((r: any) => existingPhones.add(r.phone));
      }

      const newRecords = records.filter((r) => !existingPhones.has(r.phone));
      const skippedCount = records.length - newRecords.length;

      if (newRecords.length === 0) {
        setImportMsg(`没有新数据可导入（已跳过 ${skippedCount} 条，电话已存在）`);
        setImporting(false);
        return;
      }

      // 批量插入
      const batchSize = 500;
      let inserted = 0;
      for (let i = 0; i < newRecords.length; i += batchSize) {
        const batch = newRecords.slice(i, i + batchSize);
        const { error } = await supabase.from("customers").insert(batch);
        if (error) {
          setImportMsg(`第 ${i + 1} 批导入失败: ${error.message}`);
          setImporting(false);
          return;
        }
        inserted += batch.length;
        setImportMsg(`已导入 ${inserted}/${newRecords.length} 条...`);
      }

      setImportMsg(
        `导入完成：新增 ${inserted} 条` +
          (skippedCount > 0 ? `，跳过 ${skippedCount} 条（电话已存在）` : "")
      );
      // 刷新页面
      window.location.reload();
    } catch (err: any) {
      setImportMsg("导入出错: " + (err.message || String(err)));
    }
    setImporting(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={handleExport}
        className="px-3 py-2 text-sm text-green-700 bg-white border border-green-300 rounded-lg hover:bg-green-50"
      >
        导出Excel
      </button>
      <button
        onClick={handleDownloadTemplate}
        className="px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
      >
        下载模板
      </button>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        className="px-3 py-2 text-sm text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50"
      >
        {importing ? "导入中..." : "导入Excel"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
          e.target.value = "";
        }}
      />
      {importMsg && (
        <div
          className={`px-3 py-2 text-sm border rounded-lg ${
            importMsg.includes("失败") || importMsg.includes("出错")
              ? "bg-red-50 border-red-200 text-red-700"
              : "bg-green-50 border-green-200 text-green-700"
          }`}
        >
          {importMsg}
        </div>
      )}
    </div>
  );
}
