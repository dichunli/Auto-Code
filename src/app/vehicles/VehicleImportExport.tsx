"use client";

import {useState, useRef, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { 导入车辆 } from "./actions";
import * as XLSX from "xlsx";

interface Vehicle {
  id: string;
  plate_number: string;
  vin?: string | null;
  brand?: string | null;
  model?: string | null;
  engine_no?: string | null;
  color?: string | null;
  year?: number | null;
  mileage?: number | null;
  notes?: string | null;
  customers?: { id: string; name: string; phone: string } | { id: string; name: string; phone: string }[] | null;
  companies?: { id: string; name: string } | { id: string; name: string }[] | null;
}

interface VehicleImportExportProps {
  vehicles: Vehicle[];
}

const exportHeaders = [
  { key: "plate_number", label: "车牌号" },
  { key: "vin", label: "VIN码" },
  { key: "brand", label: "品牌" },
  { key: "model", label: "型号" },
  { key: "engine_no", label: "发动机号" },
  { key: "color", label: "颜色" },
  { key: "year", label: "年份" },
  { key: "mileage", label: "里程" },
  { key: "owner_name", label: "车主姓名" },
  { key: "owner_phone", label: "车主电话" },
  { key: "company_name", label: "所属单位" },
  { key: "notes", label: "备注" },
];

function getCustomerInfo(v: Vehicle) {
  const c = v.customers;
  if (!c) return { name: "", phone: "" };
  if (Array.isArray(c)) {
    if (c.length === 0) return { name: "", phone: "" };
    return { name: c[0].name || "", phone: c[0].phone || "" };
  }
  return { name: c.name || "", phone: c.phone || "" };
}

function getCompanyName(v: Vehicle) {
  const c = v.companies;
  if (!c) return "";
  if (Array.isArray(c)) {
    if (c.length === 0) return "";
    return c[0].name || "";
  }
  return c.name || "";
}

export default function VehicleImportExport({ vehicles }: VehicleImportExportProps) {
  const supabase = useMemo(() => createClient(), []);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    const headers = exportHeaders.map((h) => h.label);
    const rows = vehicles.map((v) => {
      const customer = getCustomerInfo(v);
      const company = getCompanyName(v);
      return [
        v.plate_number || "",
        v.vin || "",
        v.brand || "",
        v.model || "",
        v.engine_no || "",
        v.color || "",
        v.year != null ? String(v.year) : "",
        v.mileage != null ? String(v.mileage) : "",
        customer.name,
        customer.phone,
        company,
        v.notes || "",
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "车辆列表");
    XLSX.writeFile(wb, `车辆列表_${new Date().toISOString().split("T")[0]}.xlsx`);
  }

  function handleDownloadTemplate() {
    const headers = exportHeaders.map((h) => h.label);
    const example = [
      "黑A12345", "LSVAG2180E2100000", "奥迪", "A4L", "DTA", "白色", "2024", "5000",
      "张三", "13800138000", "某某公司", "备注信息",
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "车辆导入模板");
    XLSX.writeFile(wb, "车辆导入模板.xlsx");
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportMsg("正在读取文件...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      /* 单元格统一按字符串处理（数字也会被 String/parseInt 正常转换） */
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];
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

      if (colMap["plate_number"] === undefined) {
        setImportMsg("导入失败：Excel 中缺少必填列「车牌号」");
        setImporting(false);
        return;
      }

      // 解析所有有效行
      const parsedRows: {
        plate: string;
        vin: string;
        brand: string;
        model: string;
        engine_no: string;
        color: string;
        year: number | null;
        mileage: number | null;
        ownerName: string;
        ownerPhone: string;
        companyName: string;
        notes: string;
      }[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const plate = String(row[colMap["plate_number"]] || "").trim().toUpperCase();
        if (!plate) continue;

        const vin = colMap["vin"] !== undefined ? String(row[colMap["vin"]] || "").trim().toUpperCase() : "";
        const brand = colMap["brand"] !== undefined ? String(row[colMap["brand"]] || "").trim() : "";
        const model = colMap["model"] !== undefined ? String(row[colMap["model"]] || "").trim() : "";
        const engine_no = colMap["engine_no"] !== undefined ? String(row[colMap["engine_no"]] || "").trim() : "";
        const color = colMap["color"] !== undefined ? String(row[colMap["color"]] || "").trim() : "";
        const year = colMap["year"] !== undefined ? parseInt(row[colMap["year"]]) : NaN;
        const mileage = colMap["mileage"] !== undefined ? parseInt(row[colMap["mileage"]]) : NaN;
        const ownerName = colMap["owner_name"] !== undefined ? String(row[colMap["owner_name"]] || "").trim() : "";
        const ownerPhone = colMap["owner_phone"] !== undefined ? String(row[colMap["owner_phone"]] || "").trim() : "";
        const companyName = colMap["company_name"] !== undefined ? String(row[colMap["company_name"]] || "").trim() : "";
        const notes = colMap["notes"] !== undefined ? String(row[colMap["notes"]] || "").trim() : "";

        parsedRows.push({
          plate,
          vin,
          brand,
          model,
          engine_no,
          color,
          year: isNaN(year) ? null : year,
          mileage: isNaN(mileage) ? null : mileage,
          ownerName,
          ownerPhone,
          companyName,
          notes,
        });
      }

      if (parsedRows.length === 0) {
        setImportMsg("没有有效的数据行（车牌号不能为空）");
        setImporting(false);
        return;
      }

      setImportMsg(`正在验证 ${parsedRows.length} 条数据...`);

      // 收集所有车牌和 VIN
      const allPlates = parsedRows.map((r) => r.plate).filter(Boolean);
      const allVins = parsedRows.map((r) => r.vin).filter(Boolean);

      // 检查车牌和 VIN 是否已存在
      const existingPlates = new Set<string>();
      const existingVins = new Set<string>();

      if (allPlates.length > 0) {
        for (let i = 0; i < allPlates.length; i += 500) {
          const batch = allPlates.slice(i, i + 500);
          const { data } = await supabase.from("vehicles").select("plate_number").in("plate_number", batch);
          data?.forEach((r: unknown) => existingPlates.add((r as Record<string, unknown>).plate_number as string));
        }
      }
      if (allVins.length > 0) {
        for (let i = 0; i < allVins.length; i += 500) {
          const batch = allVins.slice(i, i + 500);
          const { data } = await supabase.from("vehicles").select("vin").in("vin", batch);
          data?.forEach((r: unknown) => { const rv = (r as Record<string, unknown>).vin as string; if (rv) existingVins.add(rv); });
        }
      }

      const newRows = parsedRows.filter((r) => {
        if (existingPlates.has(r.plate)) return false;
        if (r.vin && existingVins.has(r.vin)) return false;
        return true;
      });
      const skippedCount = parsedRows.length - newRows.length;

      if (newRows.length === 0) {
        setImportMsg(`没有新数据可导入（已跳过 ${skippedCount} 条，车牌号或 VIN 已存在）`);
        setImporting(false);
        return;
      }

      setImportMsg(`正在导入 ${newRows.length} 条车辆数据（含查重、建车主/单位）...`);

      /* 查重、找/建车主、找/建单位、分批插入全部在服务端一次完成 */
      const 结果 = await 导入车辆({ rows: newRows });
      if (!结果.success) {
        setImportMsg("导入失败: " + (结果.error || "未知错误"));
        setImporting(false);
        return;
      }

      setImportMsg(
        `导入完成：新增 ${结果.inserted ?? 0} 条车辆` +
          ((结果.skipped ?? 0) > 0 ? `，跳过 ${结果.skipped} 条（车牌号或 VIN 已存在）` : "")
      );
      window.location.reload();
    } catch (err: unknown) {
      const e = err as Error;
      setImportMsg("导入出错: " + (e.message || String(err)));
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
