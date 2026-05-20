"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import * as XLSX from "xlsx";

interface VehicleModel {
  id: number;
  厂商: string | null;
  进口标志: string | null;
  车辆类型: string | null;
  EPC编码: string | null;
  年款: number | null;
  品牌: string | null;
  品牌图标: string | null;
  品牌别名: string | null;
  车系: string | null;
  车型: string | null;
  销售版本: string | null;
  销售名称: string | null;
  排量: string | null;
  发动机型号: string | null;
  燃油类型: string | null;
  进气形式: string | null;
  排列形式: string | null;
  气门数: number | null;
  燃油标号: string | null;
  喷射方式: string | null;
  排放标准: string | null;
  功率: number | null;
  马力: number | null;
  驱动方式: string | null;
  变速箱详情: string | null;
  档位数: number | null;
  变速箱类型: string | null;
  变速箱代号: string | null;
  底盘代号: string | null;
  车门数: string | null;
  座位数: number | null;
  车身类型: string | null;
  转向类型: string | null;
  车身尺寸: string | null;
  前轮距: number | null;
  后轮距: number | null;
  轴距: number | null;
  整备质量: number | null;
  停产标志: string | null;
  前轮胎规格: string | null;
  后轮胎规格: string | null;
  ABS标志: string | null;
  开始日期: string | null;
  结束日期: string | null;
  厂商指导价: number | null;
  发动机燃油标号: string | null;
  改款标志: number | null;
  有配件标志: number | null;
}

const detailFields: { key: keyof VehicleModel; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "厂商", label: "厂商" },
  { key: "进口标志", label: "进口标志" },
  { key: "车辆类型", label: "车辆类型" },
  { key: "EPC编码", label: "EPC编码" },
  { key: "年款", label: "年款" },
  { key: "品牌", label: "品牌" },
  { key: "品牌图标", label: "品牌图标" },
  { key: "品牌别名", label: "品牌别名" },
  { key: "车系", label: "车系" },
  { key: "车型", label: "车型" },
  { key: "销售版本", label: "销售版本" },
  { key: "销售名称", label: "销售名称" },
  { key: "排量", label: "排量" },
  { key: "发动机型号", label: "发动机型号" },
  { key: "燃油类型", label: "燃油类型" },
  { key: "进气形式", label: "进气形式" },
  { key: "排列形式", label: "排列形式" },
  { key: "气门数", label: "气门数" },
  { key: "燃油标号", label: "燃油标号" },
  { key: "喷射方式", label: "喷射方式" },
  { key: "排放标准", label: "排放标准" },
  { key: "功率", label: "功率" },
  { key: "马力", label: "马力" },
  { key: "驱动方式", label: "驱动方式" },
  { key: "变速箱详情", label: "变速箱详情" },
  { key: "档位数", label: "档位数" },
  { key: "变速箱类型", label: "变速箱类型" },
  { key: "变速箱代号", label: "变速箱代号" },
  { key: "底盘代号", label: "底盘代号" },
  { key: "车门数", label: "车门数" },
  { key: "座位数", label: "座位数" },
  { key: "车身类型", label: "车身类型" },
  { key: "转向类型", label: "转向类型" },
  { key: "车身尺寸", label: "车身尺寸" },
  { key: "前轮距", label: "前轮距" },
  { key: "后轮距", label: "后轮距" },
  { key: "轴距", label: "轴距" },
  { key: "整备质量", label: "整备质量" },
  { key: "停产标志", label: "停产标志" },
  { key: "前轮胎规格", label: "前轮胎规格" },
  { key: "后轮胎规格", label: "后轮胎规格" },
  { key: "ABS标志", label: "ABS标志" },
  { key: "开始日期", label: "开始日期" },
  { key: "结束日期", label: "结束日期" },
  { key: "厂商指导价", label: "厂商指导价" },
  { key: "发动机燃油标号", label: "发动机燃油标号" },
  { key: "改款标志", label: "改款标志" },
  { key: "有配件标志", label: "有配件标志" },
];

const tableColumns: { key: keyof VehicleModel; label: string; searchable?: boolean }[] = [
  { key: "id", label: "ID" },
  { key: "厂商", label: "厂商", searchable: true },
  { key: "品牌", label: "品牌", searchable: true },
  { key: "车系", label: "车系", searchable: true },
  { key: "车型", label: "车型", searchable: true },
  { key: "销售版本", label: "销售版本", searchable: true },
  { key: "年款", label: "年款", searchable: true },
  { key: "排量", label: "排量", searchable: true },
  { key: "发动机型号", label: "发动机", searchable: true },
  { key: "燃油类型", label: "燃油类型", searchable: true },
  { key: "进气形式", label: "进气形式", searchable: true },
  { key: "功率", label: "功率" },
  { key: "马力", label: "马力" },
  { key: "变速箱类型", label: "变速箱", searchable: true },
  { key: "档位数", label: "档位数" },
  { key: "驱动方式", label: "驱动", searchable: true },
  { key: "车身类型", label: "车身类型", searchable: true },
  { key: "车身尺寸", label: "车身尺寸", searchable: true },
  { key: "轴距", label: "轴距" },
  { key: "整备质量", label: "整备质量" },
  { key: "前轮胎规格", label: "前轮胎", searchable: true },
  { key: "后轮胎规格", label: "后轮胎", searchable: true },
  { key: "排放标准", label: "排放标准", searchable: true },
  { key: "厂商指导价", label: "指导价" },
  { key: "开始日期", label: "开始日期", searchable: true },
  { key: "结束日期", label: "结束日期", searchable: true },
  { key: "停产标志", label: "状态", searchable: true },
];

export default function VehicleModelsPage() {
  const supabase = createClient();
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [detailModel, setDetailModel] = useState<VehicleModel | null>(null);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError("");
    let q = supabase.from("vehicle_models").select("*", { count: "exact" });

    if (search.trim()) {
      const s = search.trim();
      q = q.ilike("搜索字段", `%${s}%`);
    }

    Object.entries(columnFilters).forEach(([col, val]) => {
      if (val.trim()) {
        q = q.ilike(col, `%${val.trim()}%`);
      }
    });

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, count, error } = await q.order("id").range(from, to);

    if (error) {
      setError(error.message);
    } else {
      setModels((data as VehicleModel[]) || []);
      setTotal(count || 0);
    }
    setLoading(false);
  }, [supabase, search, columnFilters, page]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    setPage(1);
  }, [search, columnFilters]);

  function handleExport() {
    const headers = detailFields.map((f) => f.label);
    const rows = models.map((m: any) => detailFields.map((f) => m[f.key] ?? ""));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "车型库");
    XLSX.writeFile(wb, `车型库_${new Date().toISOString().split("T")[0]}.xlsx`);
  }

  function handleDownloadTemplate() {
    const headers = detailFields.map((f) => f.label);
    const example = [
      9999, "一汽奥迪", "合资", "乘用车", "audi_vw", 2024, "奥迪", "https://example.com/audi.jpg", "奥迪(一汽奥迪)",
      "A4L", "A4L 40 TFSI", "豪华型", "A4L 豪华版", "2.0T", "DTA", "汽油", "涡轮增压", "L",
      4, "95号", "直喷", "国Ⅵ", 140, 190, "前置前驱", "湿式-双离合变速器(DCT)", 7,
      "双离合", "DL382", "B9", "四门", 5, "三厢车", "电动助力", "4858*1847*1439",
      1567, 1549, 2908, 1610, "在售", "245/40 R18", "245/40 R18", "有",
      "2024-01-15", null, 343800, "95号", 0, 1,
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "车型库导入模板");
    XLSX.writeFile(wb, "车型库导入模板.xlsx");
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

      const allRecords: any[] = [];
      const allIds: number[] = [];
      for (const row of dataRows) {
        const record: any = {};
        for (let j = 0; j < headers.length; j++) {
          const key = headers[j];
          let value = row[j];
          if (value === undefined || value === "") value = null;
          if (key === "开始日期" || key === "结束日期") {
            if (value && typeof value === "number") {
              const date = new Date((value - 25569) * 86400 * 1000);
              value = date.toISOString().split("T")[0];
            } else if (value && typeof value === "string" && value.match(/^\d{4}-\d{2}$/)) {
              value = value + "-01";
            }
          }
          record[key] = value;
        }
        allRecords.push(record);
        if (record.id != null) allIds.push(record.id);
      }

      setImportMsg("正在验证数据唯一性...");
      const existingIds = new Set<number>();
      if (allIds.length > 0) {
        for (let i = 0; i < allIds.length; i += 1000) {
          const batchIds = allIds.slice(i, i + 1000);
          const { data } = await supabase
            .from("vehicle_models")
            .select("id")
            .in("id", batchIds);
          data?.forEach((r: any) => existingIds.add(r.id));
        }
      }

      const newRecords = allRecords.filter((r) => !existingIds.has(r.id));
      const skippedCount = allRecords.length - newRecords.length;

      if (newRecords.length === 0) {
        setImportMsg(`没有新数据可导入（已跳过 ${skippedCount} 条重复ID）`);
        setImporting(false);
        return;
      }

      const batchSize = 500;
      let inserted = 0;
      for (let i = 0; i < newRecords.length; i += batchSize) {
        const batch = newRecords.slice(i, i + batchSize);
        const { error } = await supabase.from("vehicle_models").insert(batch);
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
          (skippedCount > 0 ? `，跳过 ${skippedCount} 条（ID已存在）` : "")
      );
      loadModels();
    } catch (err: any) {
      setImportMsg("导入出错: " + (err.message || String(err)));
    }
    setImporting(false);
  }

  const totalPages = Math.ceil(total / pageSize);

  const hasActiveFilters = search.trim() || Object.values(columnFilters).some((v) => v.trim());

  return (
    <div>
      <PageHeader title="车型库" description={`共 ${total} 款车型`} />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="搜索品牌、车系、车型、厂商、发动机型号..."
          className="flex-1 min-w-[280px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {hasActiveFilters && (
          <button
            onClick={() => { setSearch(""); setColumnFilters({}); }}
            className="px-3 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            清除所有筛选
          </button>
        )}
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
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          查询出错: {error}
        </div>
      )}

      {importMsg && (
        <div className={`mb-4 px-4 py-3 border rounded-lg text-sm ${importMsg.includes("失败") || importMsg.includes("出错") ? "bg-red-50 border-red-200 text-red-700" : "bg-green-50 border-green-200 text-green-700"}`}>
          {importMsg}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500 sticky left-0 top-0 bg-gray-50 z-20 shadow-[1px_0_0_0_rgba(229,231,235)]">
                  <div className="flex flex-col gap-1">
                    <span>操作</span>
                  </div>
                </th>
                {tableColumns.map((col) => (
                  <th
                    key={col.key}
                    className="px-3 py-2 text-left font-medium text-gray-500 sticky top-0 bg-gray-50 z-10"
                  >
                    <div className="flex flex-col gap-1 min-w-[80px]">
                      <span>{col.label}</span>
                      {col.searchable && (
                        <input
                          type="text"
                          placeholder="筛选..."
                          className="w-full px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white placeholder-gray-300 focus:outline-none focus:border-blue-400"
                          value={columnFilters[col.key] || ""}
                          onChange={(e) =>
                            setColumnFilters((prev) => ({
                              ...prev,
                              [col.key]: e.target.value,
                            }))
                          }
                        />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {models.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 sticky left-0 bg-white z-10 shadow-[1px_0_0_0_rgba(229,231,235)]">
                    <button
                      onClick={() => setDetailModel(m)}
                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      详情
                    </button>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{m.id}</td>
                  <td className="px-3 py-2 text-gray-600">{m.厂商 || "-"}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">{m.品牌 || "-"}</td>
                  <td className="px-3 py-2 text-gray-700">{m.车系 || "-"}</td>
                  <td className="px-3 py-2 text-gray-700">{m.车型 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.销售版本 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.年款 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.排量 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.发动机型号 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.燃油类型 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.进气形式 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.功率 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.马力 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.变速箱类型 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.档位数 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.驱动方式 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.车身类型 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.车身尺寸 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.轴距 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.整备质量 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.前轮胎规格 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.后轮胎规格 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.排放标准 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.厂商指导价 ? `${m.厂商指导价.toLocaleString()}` : "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.开始日期 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{m.结束日期 || "-"}</td>
                  <td className="px-3 py-2">
                    {m.停产标志 === "停产" ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">停产</span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-600">在售</span>
                    )}
                  </td>
                </tr>
              ))}
              {models.length === 0 && !loading && (
                <tr>
                  <td colSpan={28} className="px-4 py-12 text-center text-gray-400">
                    暂无数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-500">
            共 {total} 条，第 {page}/{totalPages} 页
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              上一页
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {/* 详情弹窗 */}
      {detailModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">
                {detailModel.品牌} {detailModel.车系} {detailModel.车型}
              </h3>
              <button
                onClick={() => setDetailModel(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="overflow-y-auto p-6">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {detailFields.map((f) => {
                  const val = detailModel[f.key];
                  const displayVal = val === null || val === undefined || val === "" ? "-" : String(val);
                  return (
                    <div key={f.key} className="flex justify-between text-sm border-b border-gray-50 pb-1">
                      <span className="text-gray-500">{f.label}</span>
                      {f.key === "品牌图标" && displayVal !== "-" ? (
                        <img
                          src={displayVal}
                          alt={detailModel.品牌 || "品牌图标"}
                          className="h-8 object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <span className="text-gray-900 font-medium">{displayVal}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setDetailModel(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
