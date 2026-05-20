"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
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
  const supabase = createClient();
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
          data?.forEach((r: any) => existingPlates.add(r.plate_number));
        }
      }
      if (allVins.length > 0) {
        for (let i = 0; i < allVins.length; i += 500) {
          const batch = allVins.slice(i, i + 500);
          const { data } = await supabase.from("vehicles").select("vin").in("vin", batch);
          data?.forEach((r: any) => { if (r.vin) existingVins.add(r.vin); });
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

      // 缓存车主和单位
      const phoneToCustomerId = new Map<string, string>();
      const nameToCustomerId = new Map<string, string>();
      const companyNameToId = new Map<string, string>();

      // 收集需要查找的车主和单位
      const uniquePhones = [...new Set(newRows.map((r) => r.ownerPhone).filter(Boolean))];
      const uniqueNames = [...new Set(newRows.map((r) => r.ownerName).filter(Boolean))];
      const uniqueCompanies = [...new Set(newRows.map((r) => r.companyName).filter(Boolean))];

      // 批量查询车主（按电话）
      if (uniquePhones.length > 0) {
        for (let i = 0; i < uniquePhones.length; i += 500) {
          const batch = uniquePhones.slice(i, i + 500);
          const { data } = await supabase.from("customers").select("id, phone").in("phone", batch);
          data?.forEach((r: any) => phoneToCustomerId.set(r.phone, r.id));
        }
      }

      // 批量查询车主（按姓名）——只查还没有匹配到电话的
      const unmatchedNames = uniqueNames.filter((n) => {
        return !newRows.some((r) => r.ownerName === n && r.ownerPhone && phoneToCustomerId.has(r.ownerPhone));
      });
      if (unmatchedNames.length > 0) {
        for (let i = 0; i < unmatchedNames.length; i += 500) {
          const batch = unmatchedNames.slice(i, i + 500);
          const { data } = await supabase.from("customers").select("id, name").in("name", batch);
          data?.forEach((r: any) => {
            if (!nameToCustomerId.has(r.name)) nameToCustomerId.set(r.name, r.id);
          });
        }
      }

      // 批量查询单位
      if (uniqueCompanies.length > 0) {
        for (let i = 0; i < uniqueCompanies.length; i += 500) {
          const batch = uniqueCompanies.slice(i, i + 500);
          const { data } = await supabase.from("companies").select("id, name").in("name", batch);
          data?.forEach((r: any) => companyNameToId.set(r.name, r.id));
        }
      }

      // 为找不到车主的行创建新客户
      const customersToCreate: { name: string; phone: string }[] = [];
      const createdPhoneToId = new Map<string, string>();
      const createdNameToId = new Map<string, string>();

      for (const row of newRows) {
        if (!row.ownerPhone && !row.ownerName) continue;
        let foundId: string | null = null;
        if (row.ownerPhone) foundId = phoneToCustomerId.get(row.ownerPhone) || null;
        if (!foundId && row.ownerName) foundId = nameToCustomerId.get(row.ownerName) || null;
        if (!foundId && row.ownerPhone) {
          // 需要创建
          const key = `${row.ownerName}|${row.ownerPhone}`;
          if (!createdPhoneToId.has(key)) {
            customersToCreate.push({ name: row.ownerName || row.ownerPhone, phone: row.ownerPhone });
            createdPhoneToId.set(key, "pending");
          }
        }
      }

      if (customersToCreate.length > 0) {
        setImportMsg(`正在创建 ${customersToCreate.length} 个新客户...`);
        // 先过滤掉 phone 已存在的（可能刚才查询时遗漏了）
        const phonesToCreate = customersToCreate.map((c) => c.phone);
        const { data: existingPhoneData } = await supabase.from("customers").select("id, phone").in("phone", phonesToCreate);
        const existingPhoneSet = new Set(existingPhoneData?.map((r: any) => r.phone) || []);
        const filteredCreate = customersToCreate.filter((c) => !existingPhoneSet.has(c.phone));

        if (filteredCreate.length > 0) {
          const { data: insertedCustomers, error: custErr } = await supabase
            .from("customers")
            .insert(filteredCreate)
            .select("id, phone");
          if (custErr) {
            setImportMsg("创建车主失败: " + custErr.message);
            setImporting(false);
            return;
          }
          insertedCustomers?.forEach((r: any) => {
            createdPhoneToId.set(r.phone, r.id);
          });
        }
        // 把已有的也加入映射
        existingPhoneData?.forEach((r: any) => createdPhoneToId.set(r.phone, r.id));
      }

      // 为找不到单位的行创建新单位
      const companiesToCreate: { name: string }[] = [];
      const createdCompanyToId = new Map<string, string>();

      for (const row of newRows) {
        if (!row.companyName) continue;
        if (!companyNameToId.has(row.companyName)) {
          if (!createdCompanyToId.has(row.companyName)) {
            companiesToCreate.push({ name: row.companyName });
            createdCompanyToId.set(row.companyName, "pending");
          }
        }
      }

      if (companiesToCreate.length > 0) {
        setImportMsg(`正在创建 ${companiesToCreate.length} 个新单位...`);
        const { data: insertedCompanies, error: compErr } = await supabase
          .from("companies")
          .insert(companiesToCreate)
          .select("id, name");
        if (compErr) {
          setImportMsg("创建单位失败: " + compErr.message);
          setImporting(false);
          return;
        }
        insertedCompanies?.forEach((r: any) => {
          createdCompanyToId.set(r.name, r.id);
        });
      }

      // 组装车辆记录
      const vehicleRecords: any[] = [];
      for (const row of newRows) {
        let customerId: string | null = null;
        if (row.ownerPhone) {
          customerId = phoneToCustomerId.get(row.ownerPhone) || createdPhoneToId.get(row.ownerPhone) || null;
        }
        if (!customerId && row.ownerName) {
          customerId = nameToCustomerId.get(row.ownerName) || null;
        }

        let companyId: string | null = null;
        if (row.companyName) {
          companyId = companyNameToId.get(row.companyName) || createdCompanyToId.get(row.companyName) || null;
        }

        vehicleRecords.push({
          plate_number: row.plate,
          vin: row.vin || null,
          brand: row.brand || null,
          model: row.model || null,
          engine_no: row.engine_no || null,
          color: row.color || null,
          year: row.year,
          mileage: row.mileage,
          customer_id: customerId,
          company_id: companyId,
          notes: row.notes || null,
        });
      }

      setImportMsg(`正在导入 ${vehicleRecords.length} 条车辆数据...`);

      // 批量插入车辆
      const batchSize = 500;
      let inserted = 0;
      for (let i = 0; i < vehicleRecords.length; i += batchSize) {
        const batch = vehicleRecords.slice(i, i + batchSize);
        const { error } = await supabase.from("vehicles").insert(batch);
        if (error) {
          setImportMsg(`第 ${i + 1} 批导入失败: ${error.message}`);
          setImporting(false);
          return;
        }
        inserted += batch.length;
        setImportMsg(`已导入 ${inserted}/${vehicleRecords.length} 条...`);
      }

      setImportMsg(
        `导入完成：新增 ${inserted} 条车辆` +
          (skippedCount > 0 ? `，跳过 ${skippedCount} 条（车牌号或 VIN 已存在）` : "")
      );
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
