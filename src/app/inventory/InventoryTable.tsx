"use client";

import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import JsBarcode from "jsbarcode";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import DeletePartButton from "./DeletePartButton";
import { formatCurrency } from "@/lib/utils";
import { PriceValue } from "@/components/PriceVisibilityContext";

interface ColumnDef {
  key: string;
  label: string;
  width: number;
  visible: boolean;
  sticky?: boolean;
  stickyRight?: boolean;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: "checkbox", label: "", width: 50, visible: true, sticky: true },
  { key: "part_number", label: "配件编号", width: 120, visible: true, sticky: true },
  { key: "name", label: "名称", width: 150, visible: true, sticky: true },
  { key: "document_name", label: "单据名称", width: 120, visible: true },
  { key: "category", label: "分类", width: 80, visible: true },
  { key: "brand", label: "品牌", width: 80, visible: true },
  { key: "specs", label: "规格", width: 160, visible: true },
  { key: "stock", label: "库存", width: 100, visible: true },
  { key: "purchase_price", label: "采购价", width: 80, visible: true },
  { key: "unit_cost", label: "成本价", width: 80, visible: true },
  { key: "unit_price", label: "销售价", width: 80, visible: true },
  { key: "location", label: "存放位置", width: 100, visible: true },
  { key: "barcode", label: "条形码", width: 100, visible: true },
  { key: "actions", label: "操作", width: 120, visible: true, stickyRight: true },
];

const STORAGE_KEY = "inventory-table-config";

function computeStickyLeft(columns: ColumnDef[], targetKey: string): number {
  let left = 0;
  for (const c of columns) {
    if (c.key === targetKey) break;
    if (c.sticky && c.visible) {
      left += c.width;
    }
  }
  return left;
}

const importFields = [
  { key: "配件名称", required: true },
  { key: "配件编号", required: true },
  { key: "分类名称", required: false },
  { key: "品牌名称", required: false },
  { key: "规格名称", required: false },
  { key: "单位", required: false },
  { key: "库存数量", required: false },
  { key: "最低库存", required: false },
  { key: "成本价", required: false },
  { key: "销售价", required: false },
  { key: "供应商名称", required: false },
  { key: "存放位置", required: false },
  { key: "备注", required: false },
];

export default function InventoryTable({ items }: { items: any[] }) {
  const supabase = createClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    if (typeof window === "undefined") return DEFAULT_COLUMNS;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return DEFAULT_COLUMNS.map((def) => {
          const savedCol = parsed.find((c: ColumnDef) => c.key === def.key);
          return savedCol ? { ...def, ...savedCol } : def;
        });
      }
    } catch {}
    return DEFAULT_COLUMNS;
  });

  const [colSettingsOpen, setColSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
    } catch {}
  }, [columns]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setColSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const [resizing, setResizing] = useState<{ key: string; startX: number; startWidth: number } | null>(null);

  const startResize = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const col = columns.find((c) => c.key === key);
    if (!col) return;
    setResizing({ key, startX: e.clientX, startWidth: col.width });
  }, [columns]);

  useEffect(() => {
    if (!resizing) return;
    const { key, startX, startWidth } = resizing;
    function onMove(e: MouseEvent) {
      const delta = e.clientX - startX;
      setColumns((prev) =>
        prev.map((c) =>
          c.key === key ? { ...c, width: Math.max(50, startWidth + delta) } : c
        )
      );
    }
    function onUp() {
      setResizing(null);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  const [draggingCol, setDraggingCol] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) =>
      (item.part_number || "").toLowerCase().includes(q) ||
      (item.name || "").toLowerCase().includes(q) ||
      (item.barcode || "").toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === items.length && items.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  }

  function handleDownloadTemplate() {
    const headers = importFields.map((f) => f.key);
    const example = [
      "机油滤芯",
      "LF-001",
      "常规保养",
      "原厂",
      "标准",
      "个",
      50,
      10,
      45,
      68,
      "某某汽配",
      "A区-01架",
      "适用于大多数日系车",
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "配件信息导入模板");
    XLSX.writeFile(wb, "配件信息导入模板.xlsx");
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

      setImportMsg("正在加载关联数据...");
      const [
        { data: categories },
        { data: partNames },
        { data: brands },
        { data: specs },
        { data: suppliers },
      ] = await Promise.all([
        supabase.from("part_categories").select("id, name"),
        supabase.from("part_names").select("id, name"),
        supabase.from("part_brands").select("id, name"),
        supabase.from("part_specifications").select("id, name"),
        supabase.from("suppliers").select("id, name"),
      ]);

      const categoryMap = new Map((categories || []).map((c: any) => [c.name, c.id]));
      const partNameMap = new Map((partNames || []).map((p: any) => [p.name, p.id]));
      const brandMap = new Map((brands || []).map((b: any) => [b.name, b.id]));
      const specMap = new Map((specs || []).map((s: any) => [s.name, s.id]));
      const supplierMap = new Map((suppliers || []).map((s: any) => [s.name, s.id]));

      const newPartNames: { name: string }[] = [];
      const newBrands: { name: string }[] = [];
      const newSpecs: { name: string }[] = [];

      const records: any[] = [];
      const errors: string[] = [];
      const seenCodeInFile = new Map<string, number>(); // 文件内重复的配件编号:code -> 首次行号
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
        if (!record["配件编号"]) {
          errors.push(`第 ${rowNum} 行: 配件编号不能为空`);
          continue;
        }

        const nameStr = String(record["配件名称"]).trim();
        const pnStr = String(record["配件编号"]).trim();

        // 文件内编号重复检查
        if (seenCodeInFile.has(pnStr)) {
          duplicateInFile++;
          errors.push(`第 ${rowNum} 行: 配件编号"${pnStr}"与第 ${seenCodeInFile.get(pnStr)} 行重复，已跳过`);
          continue;
        }
        seenCodeInFile.set(pnStr, rowNum);

        let partNameId = partNameMap.get(nameStr);
        if (!partNameId) {
          if (!newPartNames.some((p) => p.name === nameStr)) {
            newPartNames.push({ name: nameStr });
          }
        }

        let brandId: string | null = null;
        if (record["品牌名称"]) {
          const brandName = String(record["品牌名称"]).trim();
          brandId = brandMap.get(brandName) || null;
          if (!brandId && !newBrands.some((b) => b.name === brandName)) {
            newBrands.push({ name: brandName });
          }
        }

        let specId: string | null = null;
        if (record["规格名称"]) {
          const specName = String(record["规格名称"]).trim();
          specId = specMap.get(specName) || null;
          if (!specId && !newSpecs.some((s) => s.name === specName)) {
            newSpecs.push({ name: specName });
          }
        }

        let categoryId: string | null = null;
        if (record["分类名称"]) {
          categoryId = categoryMap.get(String(record["分类名称"]).trim()) || null;
          if (!categoryId) {
            errors.push(`第 ${rowNum} 行: 分类"${record["分类名称"]}"不存在，请先创建`);
            continue;
          }
        }

        let supplierId: string | null = null;
        if (record["供应商名称"]) {
          supplierId = supplierMap.get(String(record["供应商名称"]).trim()) || null;
        }

        records.push({
          rowNum,
          name: nameStr,
          part_number: pnStr,
          part_name_id: partNameId || nameStr,
          category_id: categoryId,
          brand_id: brandId,
          brand_name: record["品牌名称"] ? String(record["品牌名称"]).trim() : null,
          spec_id: specId,
          spec_name: record["规格名称"] ? String(record["规格名称"]).trim() : null,
          unit: record["单位"] ? String(record["单位"]).trim() : "件",
          quantity: record["库存数量"] ? parseInt(record["库存数量"]) : 0,
          min_stock: record["最低库存"] ? parseInt(record["最低库存"]) : 10,
          unit_cost: record["成本价"] ? parseFloat(record["成本价"]) : null,
          unit_price: record["销售价"] ? parseFloat(record["销售价"]) : null,
          supplier_id: supplierId,
          location: record["存放位置"] ? String(record["存放位置"]).trim() : null,
          notes: record["备注"] ? String(record["备注"]).trim() : null,
        });
      }

      if (records.length === 0) {
        setImportMsg("没有有效数据可导入\n" + errors.slice(0, 5).join("\n"));
        setImporting(false);
        return;
      }

      // 查询数据库中已存在的配件编号,过滤重复
      setImportMsg(`验证通过 ${records.length} 条，正在检查配件编号是否重复...`);
      const allCodes = records.map((r) => r.part_number);
      const existingCodes = new Set<string>();
      const queryBatchSize = 200;
      for (let i = 0; i < allCodes.length; i += queryBatchSize) {
        const codesBatch = allCodes.slice(i, i + queryBatchSize);
        const { data: existing } = await supabase
          .from("parts")
          .select("part_number")
          .in("part_number", codesBatch);
        (existing || []).forEach((row: any) => existingCodes.add(row.part_number));
      }

      const filteredRecords = records.filter((r) => !existingCodes.has(r.part_number));
      const duplicateInDb = records.length - filteredRecords.length;

      if (filteredRecords.length === 0) {
        let msg = `导入完成：新增 0 条`;
        if (duplicateInDb > 0) msg += `，${duplicateInDb} 条配件编号已存在`;
        if (duplicateInFile > 0) msg += `，文件内编号重复 ${duplicateInFile} 条`;
        const otherErrors = errors.length - duplicateInFile;
        if (otherErrors > 0) msg += `，${otherErrors} 条有错误`;
        setImportMsg(msg);
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      // 用过滤后的记录替换原 records,后续逻辑只处理 filteredRecords
      records.length = 0;
      records.push(...filteredRecords);

      setImportMsg("正在创建缺失的关联数据...");

      // 创建缺失的配件名称
      if (newPartNames.length > 0) {
        const { data: insertedNames, error: nameErr } = await supabase
          .from("part_names")
          .insert(newPartNames)
          .select("id, name");
        if (nameErr) {
          setImportMsg("创建配件名称失败: " + nameErr.message);
          setImporting(false);
          return;
        }
        (insertedNames || []).forEach((p: any) => partNameMap.set(p.name, p.id));
      }

      // 创建缺失的品牌
      if (newBrands.length > 0) {
        const { data: insertedBrands, error: brandErr } = await supabase
          .from("part_brands")
          .insert(newBrands)
          .select("id, name");
        if (brandErr) {
          setImportMsg("创建品牌失败: " + brandErr.message);
          setImporting(false);
          return;
        }
        (insertedBrands || []).forEach((b: any) => brandMap.set(b.name, b.id));
      }

      // 创建缺失的规格
      if (newSpecs.length > 0) {
        const { data: insertedSpecs, error: specErr } = await supabase
          .from("part_specifications")
          .insert(newSpecs)
          .select("id, name");
        if (specErr) {
          setImportMsg("创建规格失败: " + specErr.message);
          setImporting(false);
          return;
        }
        (insertedSpecs || []).forEach((s: any) => specMap.set(s.name, s.id));
      }

      // 构建最终插入数据
      const insertData = records.map((r) => {
        const data: any = {
          name: r.name,
          part_number: r.part_number,
          part_name_id: typeof r.part_name_id === "string" && r.part_name_id.length === 36
            ? r.part_name_id
            : partNameMap.get(r.part_name_id),
          category_id: r.category_id,
          unit: r.unit,
          quantity: r.quantity,
          min_stock: r.min_stock,
          unit_cost: r.unit_cost,
          unit_price: r.unit_price,
          supplier_id: r.supplier_id,
          location: r.location,
          notes: r.notes,
        };
        if (r.brand_name) {
          data.brand_id = brandMap.get(r.brand_name) || null;
        }
        return data;
      });

      setImportMsg(`验证通过 ${insertData.length} 条，开始导入...`);
      const batchSize = 50;
      let inserted = 0;
      const insertedPartIds: string[] = [];

      for (let i = 0; i < insertData.length; i += batchSize) {
        const batch = insertData.slice(i, i + batchSize);
        const { data: insertedParts, error } = await supabase
          .from("parts")
          .insert(batch)
          .select("id");
        if (error) {
          setImportMsg(`第 ${i + 1} 批导入失败: ${error.message}`);
          setImporting(false);
          return;
        }
        (insertedParts || []).forEach((p: any) => insertedPartIds.push(p.id));
        inserted += batch.length;
        setImportMsg(`已导入 ${inserted}/${insertData.length} 条...`);
      }

      // 创建规格关联
      const specLinks = records
        .filter((r, idx) => r.spec_name && insertedPartIds[idx])
        .map((r, idx) => ({
          part_id: insertedPartIds[idx],
          specification_id: specMap.get(r.spec_name),
        }))
        .filter((l) => l.specification_id);

      if (specLinks.length > 0) {
        await supabase.from("parts_specifications").insert(specLinks);
      }

      let msg = `导入完成：新增 ${inserted} 条`;
      if (duplicateInDb > 0) msg += `，跳过 ${duplicateInDb} 条（编号已存在）`;
      if (duplicateInFile > 0) msg += `，文件内编号重复 ${duplicateInFile} 条`;
      const otherErrors = errors.length - duplicateInFile;
      if (otherErrors > 0) msg += `，${otherErrors} 条有错误`;
      setImportMsg(msg);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      setImportMsg("导入出错: " + (err.message || String(err)));
    }
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function printSingle(part: any) {
    const code = part.barcode || part.part_number || part.id;
    if (!canvasRef.current) return;
    try {
      JsBarcode(canvasRef.current, code, {
        format: "CODE128",
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 14,
      });
    } catch {
      alert("生成条形码失败");
      return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("请允许弹出窗口以打印条形码");
      return;
    }
    const imgData = canvasRef.current.toDataURL("image/png");
    printWindow.document.write(`
      <html><head><title>打印条形码</title></head>
      <body style="text-align:center;padding:40px 20px;">
        <div style="margin-bottom:16px;font-size:16px;font-weight:500;">${part.name}</div>
        <img src="${imgData}" style="max-width:100%;" />
        <div style="margin-top:8px;font-size:13px;color:#666;">${code}</div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  }

  function printBatch() {
    const selected = items.filter((i) => selectedIds.has(i.id));
    if (selected.length === 0) {
      alert("请先选择要打印的配件");
      return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("请允许弹出窗口以打印条形码");
      return;
    }
    const canvas = document.createElement("canvas");
    let html = `<html><head><title>批量打印条形码</title><style>
      body { font-family: sans-serif; padding: 20px; }
      .barcode-grid { display: flex; flex-wrap: wrap; gap: 16px; }
      .barcode-item { width: 200px; text-align: center; border: 1px solid #e5e7eb; padding: 12px; border-radius: 8px; }
      .barcode-name { font-size: 13px; font-weight: 500; margin-bottom: 8px; color: #111; }
      .barcode-code { font-size: 11px; color: #666; margin-top: 4px; }
      img { max-width: 100%; }
    </style></head><body><div class="barcode-grid">`;
    for (const part of selected) {
      const code = part.barcode || part.part_number || part.id;
      try {
        JsBarcode(canvas, code, {
          format: "CODE128",
          width: 2,
          height: 50,
          displayValue: true,
          fontSize: 12,
        });
      } catch {
        continue;
      }
      const imgData = canvas.toDataURL("image/png");
      html += `<div class="barcode-item"><div class="barcode-name">${part.name}</div><img src="${imgData}" /><div class="barcode-code">${code}</div></div>`;
    }
    html += `</div></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  }

  function getSpecsText(item: any) {
    const specs = item.parts_specifications;
    if (!specs || specs.length === 0) return "-";
    return specs
      .map((s: any) => s.part_specifications?.name || "")
      .filter(Boolean)
      .join(", ");
  }

  function renderCell(item: any, col: ColumnDef) {
    switch (col.key) {
      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={selectedIds.has(item.id)}
            onChange={() => toggleSelect(item.id)}
            className="rounded border-gray-300"
          />
        );
      case "part_number":
        return <span className="font-medium text-gray-900">{item.part_number}</span>;
      case "name":
        return <span className="text-gray-900">{item.name}</span>;
      case "document_name":
        return item.document_name || "-";
      case "category":
        return item.part_names?.part_categories?.name || "-";
      case "brand":
        return item.part_brands?.name || "-";
      case "specs": {
        const text = getSpecsText(item);
        return <span className="truncate">{text === "-" ? "-" : text.slice(0, 20)}</span>;
      }
      case "stock":
        return (
          <>
            <span className={`font-medium ${item.quantity <= item.min_stock ? "text-red-600" : "text-gray-900"}`}>
              {item.quantity}
            </span>
            {item.quantity <= item.min_stock && (
              <span className="ml-2 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">库存不足</span>
            )}
          </>
        );
      case "purchase_price":
        return <PriceValue value={item.purchase_price} />;
      case "unit_cost":
        return <PriceValue value={item.unit_cost} />;
      case "unit_price":
        return <PriceValue value={item.unit_price} />;
      case "location":
        return item.location || "-";
      case "barcode":
        return item.barcode || "-";
      case "actions":
        return (
          <div className="space-x-3 whitespace-nowrap">
            <Link href={`/parts/${item.id}`} className="text-xs text-blue-600 hover:text-blue-700">
              查看
            </Link>
            <button onClick={() => printSingle(item)} className="text-xs text-gray-600 hover:text-gray-900">
              打印条码
            </button>
            <DeletePartButton partId={item.id} />
          </div>
        );
      default:
        return "-";
    }
  }

  const visibleColumns = columns.filter((c) => c.visible);
  const tableMinWidth = visibleColumns.reduce((sum, c) => sum + c.width, 0);

  const isDraggable = (key: string) => {
    const col = columns.find((c) => c.key === key);
    if (!col) return false;
    return !col.sticky && key !== "actions";
  };

  return (
    <div>
      {/* 搜索框 + 列设置 + 导入 */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="搜索配件编号、名称、条形码"
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
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
        <div className="relative" ref={settingsRef}>
          <button
            type="button"
            onClick={() => setColSettingsOpen((v) => !v)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            列设置
          </button>
          {colSettingsOpen && (
            <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3">
              <div className="text-sm font-medium text-gray-700 mb-2">显示列</div>
              <div className="space-y-1.5">
                {columns
                  .filter((c) => c.key !== "checkbox" && c.key !== "actions")
                  .map((col) => (
                    <label key={col.key} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={col.visible}
                        onChange={() =>
                          setColumns((prev) =>
                            prev.map((c) => (c.key === col.key ? { ...c, visible: !c.visible } : c))
                          )
                        }
                        className="rounded border-gray-300"
                      />
                      <span className="text-gray-700">{col.label}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 批量操作栏 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 ? (
            <>
              <span className="text-sm text-gray-600">已选 {selectedIds.size} 项</span>
              <button
                onClick={printBatch}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                批量打印条码
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                取消选择
              </button>
            </>
          ) : (
            <span className="text-sm text-gray-400">勾选配件可进行批量打印条码</span>
          )}
        </div>
        <span className="text-sm text-gray-500">
          共 {filteredItems.length} 条，第 {safePage}/{totalPages} 页
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse" style={{ minWidth: tableMinWidth }}>
          <thead className="bg-gray-50">
            <tr>
              {visibleColumns.map((col) => {
                const stickyLeft = col.sticky ? computeStickyLeft(columns, col.key) : undefined;
                const style: React.CSSProperties = {};
                if (stickyLeft !== undefined) {
                  style.position = "sticky";
                  style.left = stickyLeft;
                  style.zIndex = 10;
                } else if (col.stickyRight) {
                  style.position = "sticky";
                  style.right = 0;
                  style.zIndex = 10;
                }
                style.width = col.width;
                style.minWidth = col.width;

                return (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-left font-medium text-gray-500 whitespace-nowrap ${
                      col.sticky || col.stickyRight ? "bg-gray-50" : ""
                    } ${draggingCol === col.key ? "opacity-50" : ""}`}
                    style={style}
                    draggable={isDraggable(col.key)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("col-key", col.key);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingCol(col.key);
                    }}
                    onDragEnd={() => setDraggingCol(null)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromKey = e.dataTransfer.getData("col-key");
                      if (!fromKey || fromKey === col.key || !isDraggable(fromKey)) return;
                      setColumns((prev) => {
                        const fromIndex = prev.findIndex((c) => c.key === fromKey);
                        const toIndex = prev.findIndex((c) => c.key === col.key);
                        if (fromIndex === -1 || toIndex === -1) return prev;
                        const frozenCount = prev.filter((c) => c.sticky).length;
                        const actionsIndex = prev.findIndex((c) => c.key === "actions");
                        const minIndex = frozenCount;
                        const maxIndex = actionsIndex >= 0 ? actionsIndex - 1 : prev.length - 1;
                        let newToIndex = toIndex;
                        if (newToIndex < minIndex) newToIndex = minIndex;
                        if (newToIndex > maxIndex) newToIndex = maxIndex;
                        if (fromIndex === newToIndex) return prev;
                        const next = [...prev];
                        const [removed] = next.splice(fromIndex, 1);
                        next.splice(newToIndex, 0, removed);
                        return next;
                      });
                    }}
                  >
                    <div className="relative flex items-center">
                      <span>{col.label}</span>
                      {col.key !== "checkbox" && col.key !== "actions" && (
                        <div
                          className="absolute right-[-6px] top-0 bottom-0 w-[6px] cursor-col-resize z-20"
                          onMouseDown={(e) => startResize(col.key, e)}
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginatedItems.map((item: any) => (
              <tr key={item.id} className="hover:bg-gray-50">
                {visibleColumns.map((col) => {
                  const stickyLeft = col.sticky ? computeStickyLeft(columns, col.key) : undefined;
                  const style: React.CSSProperties = {};
                  if (stickyLeft !== undefined) {
                    style.position = "sticky";
                    style.left = stickyLeft;
                    style.zIndex = 10;
                  } else if (col.stickyRight) {
                    style.position = "sticky";
                    style.right = 0;
                    style.zIndex = 10;
                  }
                  style.width = col.width;
                  style.minWidth = col.width;

                  return (
                    <td
                      key={col.key}
                      className={`px-4 py-4 whitespace-nowrap ${col.sticky || col.stickyRight ? "bg-white" : ""}`}
                      style={style}
                    >
                      {renderCell(item, col)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {paginatedItems.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-6 py-12 text-center text-gray-400">
                  暂无配件数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            上一页
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                page === safePage ? "bg-blue-600 text-white" : "border border-gray-300 hover:bg-gray-50"
              }`}
            >
              {page}
            </button>
          ))}
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
