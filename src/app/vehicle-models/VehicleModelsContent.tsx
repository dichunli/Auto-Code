"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { 导入车型, 车型导入行 } from "./actions";
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

const tableColumns: { key: keyof VehicleModel; label: string; searchable?: boolean; numeric?: boolean }[] = [
  { key: "id", label: "ID", searchable: true, numeric: true },
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

const pageSize = 50;

interface Props {
  models: VehicleModel[];
  total: number;
  page: number;
  keyword: string;
  columnFilters: Record<string, string>;
  queryError: string | null;
}

export default function VehicleModelsContent({ models, total, page, keyword, columnFilters }: Props) {
  const router = useRouter();
  const [detailModel, setDetailModel] = useState<VehicleModel | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* 搜索输入 — 本地状态 + useDebounce 防抖后更新 URL */
  const [search, setSearch] = useState(keyword);
  const debouncedSearch = useDebounce(search, 400);
  /* 记录上次已提交到 URL 的搜索词，避免挂载时/外部同步时重复 replace */
  const lastSubmittedSearch = useRef(keyword);

  // 当外部 keyword 变化时同步本地状态（如清除筛选、URL 直接修改）
  useEffect(() => {
    setSearch(keyword);
    lastSubmittedSearch.current = keyword;
  }, [keyword]);

  useEffect(() => {
    if (debouncedSearch === lastSubmittedSearch.current) return;
    lastSubmittedSearch.current = debouncedSearch;
    const params = buildParams(debouncedSearch, columnFilters, 1);
    router.replace(`/vehicle-models?${params}`);
  }, [debouncedSearch, columnFilters, router]);

  function updateSearch(value: string) {
    setSearch(value);
  }

  /* 列筛选 — 本地状态 + useDebounce 防抖后更新 URL */
  const [localFilters, setLocalFilters] = useState<Record<string, string>>(columnFilters);
  const debouncedFilters = useDebounce(localFilters, 500);
  const lastSubmittedFilters = useRef(columnFilters);

  // 当外部 columnFilters 变化时同步本地状态
  useEffect(() => {
    setLocalFilters(columnFilters);
    lastSubmittedFilters.current = columnFilters;
  }, [columnFilters]);

  useEffect(() => {
    if (debouncedFilters === lastSubmittedFilters.current) return;
    lastSubmittedFilters.current = debouncedFilters;
    const params = buildParams(search, debouncedFilters, 1);
    router.replace(`/vehicle-models?${params}`);
  }, [debouncedFilters, search, router]);

  function updateColumnFilter(col: string, value: string) {
    const next = { ...localFilters, [col]: value };
    if (!value.trim()) delete next[col];
    setLocalFilters(next);
  }

  function clearAllFilters() {
    setSearch("");
    setLocalFilters({});
    router.replace("/vehicle-models");
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActiveFilters = search.trim() || Object.values(localFilters).some((v) => v.trim());

  /* 导出 Excel */
  function handleExport() {
    const headers = detailFields.map((f) => f.label);
    const rows = models.map((m) => detailFields.map((f) => m[f.key] ?? ""));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "车型库");
    XLSX.writeFile(wb, `车型库_${new Date().toISOString().split("T")[0]}.xlsx`);
  }

  /* 下载导入模板 */
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

  /* 导入 Excel */
  async function handleImportFile(file: File) {
    setImporting(true);
    setImportMsg("正在读取文件...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (rows.length < 2) {
        setImportMsg("文件中没有数据");
        setImporting(false);
        return;
      }
      const headers = rows[0].map((h) => String(h ?? ""));
      const dataRows = rows.slice(1);

      const allRecords: 车型导入行[] = [];
      for (const row of dataRows) {
        const record: 车型导入行 = {};
        for (let j = 0; j < headers.length; j++) {
          const key = headers[j];
          let value: unknown = row[j];
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
      }

      setImportMsg(`正在导入 ${allRecords.length} 条数据（服务端查重并写入）...`);

      /* ID 查重 + 分批插入全部在服务端完成 */
      const importResult = await 导入车型({ rows: allRecords });
      if (!importResult.success) {
        setImportMsg("导入失败: " + (importResult.error || "未知错误"));
        setImporting(false);
        return;
      }

      const inserted = importResult.inserted ?? 0;
      const skippedCount = importResult.skipped ?? 0;
      if (inserted === 0) {
        setImportMsg(`没有新数据可导入（已跳过 ${skippedCount} 条重复ID）`);
        setImporting(false);
        return;
      }

      setImportMsg(
        `导入完成：新增 ${inserted} 条` +
          (skippedCount > 0 ? `，跳过 ${skippedCount} 条（ID已存在）` : "")
      );
      // 导入成功后刷新页面以重新服务端查询
      router.refresh();
    } catch (err: unknown) {
      setImportMsg("导入出错: " + (err instanceof Error ? err.message : String(err)));
    }
    setImporting(false);
  }

  return (
    <div>
      <PageHeader title="车型库" description={`共 ${total} 款车型`} />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="搜索品牌、车系、车型、厂商、发动机型号..."
          className="flex-1 min-w-[280px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
        />
        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
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
                          value={localFilters[col.key] || ""}
                          onChange={(e) => updateColumnFilter(col.key, e.target.value)}
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
              {models.length === 0 && (
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
            {page > 1 && (
              <a
                href={`/vehicle-models?${buildParams(search, localFilters, page - 1)}`}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                上一页
              </a>
            )}
            {page < totalPages && (
              <a
                href={`/vehicle-models?${buildParams(search, localFilters, page + 1)}`}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                下一页
              </a>
            )}
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
                          loading="lazy"
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

/* 构建 URL 参数字符串 */
export function buildParams(
  keyword: string,
  filters: Record<string, string>,
  page: number
): string {
  const sp = new URLSearchParams();
  if (keyword.trim()) sp.set("keyword", keyword.trim());
  Object.entries(filters).forEach(([col, val]) => {
    if (val.trim()) sp.set(`cf_${col}`, val.trim());
  });
  if (page > 1) sp.set("page", String(page));
  return sp.toString();
}
