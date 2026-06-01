"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { batchQueryVinFilters, VinQueryResult } from "./actions";
import { batchCreatePartsFromVin, autoCreateFiltersByVin, CreatePartResult } from "./createActions";
import { PageHeader } from "@/components/PageHeader";

export default function VinBatchQueryPage() {
  const [activeTab, setActiveTab] = useState<"query" | "create">("query");

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title="VIN批量工具" />

      {/* Tab切换 */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab("query")}
          className={`px-4 py-2 text-sm font-medium rounded-lg ${
            activeTab === "query"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          批量查OE号
        </button>
        <button
          onClick={() => setActiveTab("create")}
          className={`px-4 py-2 text-sm font-medium rounded-lg ${
            activeTab === "create"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          批量创建配件
        </button>
      </div>

      {activeTab === "query" ? <QueryTab /> : <CreateTab />}
    </div>
  );
}

/* ==================== 查OE号Tab ==================== */
function QueryTab() {
  const [uploading, setUploading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<VinQueryResult[]>([]);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function parseExcel(file: File): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];

          const header = rows[0] || [];
          let vinColIndex = header.findIndex(
            (h) =>
              String(h).toUpperCase().includes("VIN") ||
              String(h).includes("车架号") ||
              String(h).includes("车架")
          );
          if (vinColIndex === -1) vinColIndex = 0;

          const vins: string[] = [];
          for (let i = 1; i < rows.length; i++) {
            const vin = String(rows[i][vinColIndex] || "").trim().toUpperCase();
            if (/^[A-HJ-NPR-Z0-9]{17}$/.test(vin) && !vins.includes(vin)) {
              vins.push(vin);
            }
          }
          resolve(vins);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    setResults([]);
    setProgress(0);

    try {
      const vins = await parseExcel(file);
      if (vins.length === 0) {
        setError("未在Excel中找到有效的17位VIN码");
        setUploading(false);
        return;
      }

      setUploading(false);
      setQuerying(true);

      /* 自动分批，每批最多10个（避免Server Action超时） */
      const batchSize = 10;
      const allResults: VinQueryResult[] = [];
      for (let i = 0; i < vins.length; i += batchSize) {
        const batch = vins.slice(i, i + batchSize);
        const res = await batchQueryVinFilters(batch);
        if (res.success && res.data) {
          allResults.push(...res.data);
        }
        setProgress(Math.min(((i + batch.length) / vins.length) * 100, 100));
      }

      setResults(allResults);
      setQuerying(false);
    } catch (err: unknown) {
      setError("解析失败：" + (err instanceof Error ? err.message : String(err)));
      setUploading(false);
      setQuerying(false);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function exportResults() {
    if (results.length === 0) return;
    const rows = results.map((r) => ({
      VIN: r.vin,
      机油滤OE号: r.oil?.oeNumber || "",
      机油滤来源: r.oil ? (r.oil.fromCache ? "缓存" : "17VIN") : "未找到",
      空气滤OE号: r.air?.oeNumber || "",
      空气滤来源: r.air ? (r.air.fromCache ? "缓存" : "17VIN") : "未找到",
      空调滤OE号: r.cabin?.oeNumber || "",
      空调滤来源: r.cabin ? (r.cabin.fromCache ? "缓存" : "17VIN") : "未找到",
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "三滤OE号查询结果");
    const now = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    XLSX.writeFile(workbook, `三滤OE号查询结果_${now}.xlsx`);
  }

  const total = results.length;
  const foundOil = results.filter((r) => r.oil).length;
  const foundAir = results.filter((r) => r.air).length;
  const foundCabin = results.filter((r) => r.cabin).length;
  const fromCache = results.reduce(
    (sum, r) => sum + (r.oil?.fromCache ? 1 : 0) + (r.air?.fromCache ? 1 : 0) + (r.cabin?.fromCache ? 1 : 0),
    0
  );
  const fromApi = results.reduce(
    (sum, r) =>
      sum +
      (r.oil && !r.oil.fromCache ? 1 : 0) +
      (r.air && !r.air.fromCache ? 1 : 0) +
      (r.cabin && !r.cabin.fromCache ? 1 : 0),
    0
  );

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">上传Excel</h2>
        <p className="text-sm text-gray-500 mb-4">
          Excel中需包含VIN码列（列标题含&apos;VIN&apos;或&apos;车架号&apos;即可），系统会自动提取有效的17位VIN码并批量查询三滤OE号。
        </p>
        <div className="flex items-center gap-4">
          <label className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 cursor-pointer inline-block">
            {uploading ? "解析中..." : "选择Excel文件"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              disabled={uploading || querying}
              className="hidden"
            />
          </label>
          {querying && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>查询中...{Math.round(progress)}%</span>
              <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      </div>

      {total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">查询结果</h2>
            <button
              onClick={exportResults}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
            >
              导出Excel
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-900">{total}</div>
              <div className="text-gray-500">VIN总数</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-700">{foundOil}</div>
              <div className="text-blue-600">机油滤</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-700">{foundAir}</div>
              <div className="text-blue-600">空气滤</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-700">{foundCabin}</div>
              <div className="text-blue-600">空调滤</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-700">{fromCache}</div>
              <div className="text-green-600">来自缓存</div>
            </div>
          </div>
          {fromApi > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              其中 {fromApi} 条通过17VIN接口实时查询，其余来自本地缓存
            </p>
          )}
        </div>
      )}

      {total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">VIN</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">机油滤OE号</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">空气滤OE号</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">空调滤OE号</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-900">{r.vin}</td>
                    <td className="px-4 py-3">
                      {r.oil ? (
                        <span className={r.oil.fromCache ? "text-gray-700" : "text-blue-700"}>
                          {r.oil.oeNumber}
                          {r.oil.fromCache && <span className="text-[10px] text-gray-400 ml-1">缓存</span>}
                        </span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.air ? (
                        <span className={r.air.fromCache ? "text-gray-700" : "text-blue-700"}>
                          {r.air.oeNumber}
                          {r.air.fromCache && <span className="text-[10px] text-gray-400 ml-1">缓存</span>}
                        </span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.cabin ? (
                        <span className={r.cabin.fromCache ? "text-gray-700" : "text-blue-700"}>
                          {r.cabin.oeNumber}
                          {r.cabin.fromCache && <span className="text-[10px] text-gray-400 ml-1">缓存</span>}
                        </span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ==================== 创建配件Tab ==================== */
function CreateTab() {
  const [createMode, setCreateMode] = useState<"full" | "vin-only">("full");
  const [selectedBrand, setSelectedBrand] = useState("博世");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<CreatePartResult[]>([]);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* 解析完整模式Excel（需包含编码、名称、品牌、成本价、VIN） */
  function parseCreateExcel(file: File): Promise<Array<{ partNumber: string; name: string; brand: string; unitCost: string; vin: string }>> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as (string | number)[][];

          const header = rows[0] || [];
          const getColIndex = (keywords: string[]) => {
            return header.findIndex((h) => keywords.some((k) => String(h).includes(k)));
          };

          const partNumberIdx = getColIndex(["零件编码", "编码", "part_number", "零件号"]);
          const nameIdx = getColIndex(["零件名称", "名称", "name"]);
          const brandIdx = getColIndex(["品牌", "brand"]);
          const costIdx = getColIndex(["成本价", "成本", "cost", "unit_cost"]);
          const vinIdx = getColIndex(["VIN", "车架号", "vin"]);

          if (partNumberIdx === -1 || nameIdx === -1 || vinIdx === -1) {
            throw new Error("Excel缺少必要的列：零件编码、零件名称、VIN");
          }

          const items: Array<{ partNumber: string; name: string; brand: string; unitCost: string; vin: string }> = [];
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const partNumber = String(row[partNumberIdx] || "").trim();
            const name = String(row[nameIdx] || "").trim();
            const brand = brandIdx >= 0 ? String(row[brandIdx] || "").trim() : "";
            const unitCost = costIdx >= 0 ? String(row[costIdx] || "").trim() : "";
            const vin = String(row[vinIdx] || "").trim().toUpperCase();

            if (!partNumber || !name || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) continue;

            items.push({ partNumber, name, brand: brand || "未知", unitCost, vin });
          }

          resolve(items);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /* 解析仅VIN模式Excel（只需VIN列） */
  function parseVinOnlyExcel(file: File): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];

          const header = rows[0] || [];
          let vinColIndex = header.findIndex(
            (h) =>
              String(h).toUpperCase().includes("VIN") ||
              String(h).includes("车架号") ||
              String(h).includes("车架")
          );
          if (vinColIndex === -1) vinColIndex = 0;

          const vins: string[] = [];
          for (let i = 1; i < rows.length; i++) {
            const vin = String(rows[i][vinColIndex] || "").trim().toUpperCase();
            if (/^[A-HJ-NPR-Z0-9]{17}$/.test(vin) && !vins.includes(vin)) {
              vins.push(vin);
            }
          }
          resolve(vins);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /* 完整模式上传处理 */
  async function handleCreateUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    setResults([]);
    setProgress(0);

    try {
      const rows = await parseCreateExcel(file);
      if (rows.length === 0) {
        setError("未找到有效的数据行，请检查Excel格式");
        setUploading(false);
        return;
      }
      setUploading(false);
      setCreating(true);

      /* 自动分批，每批最多10个（避免Server Action超时） */
      const batchSize = 10;
      const allResults: CreatePartResult[] = [];
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const res = await batchCreatePartsFromVin(batch);
        if (res.success && res.data) {
          allResults.push(...res.data);
        }
        setProgress(Math.min(((i + batch.length) / rows.length) * 100, 100));
      }

      setResults(allResults);
      setCreating(false);
    } catch (err: unknown) {
      setError("解析失败：" + (err instanceof Error ? err.message : String(err)));
      setUploading(false);
      setCreating(false);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /* 仅VIN模式上传处理 */
  async function handleVinOnlyUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    setResults([]);
    setProgress(0);

    try {
      const vins = await parseVinOnlyExcel(file);
      if (vins.length === 0) {
        setError("未在Excel中找到有效的17位VIN码");
        setUploading(false);
        return;
      }
      setUploading(false);
      setCreating(true);

      /* 每批最多10个VIN（避免Server Action超时） */
      const batchSize = 10;
      const allResults: CreatePartResult[] = [];
      for (let i = 0; i < vins.length; i += batchSize) {
        const batch = vins.slice(i, i + batchSize);
        const res = await autoCreateFiltersByVin(batch, selectedBrand);
        if (res.success && res.data) {
          allResults.push(...res.data);
        }
        setProgress(Math.min(((i + batch.length) / vins.length) * 100, 100));
      }

      setResults(allResults);
      setCreating(false);
    } catch (err: unknown) {
      setError("解析失败：" + (err instanceof Error ? err.message : String(err)));
      setUploading(false);
      setCreating(false);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function exportCreateResults() {
    if (results.length === 0) return;
    const rows = results.map((r) => ({
      零件编码: r.partNumber,
      零件名称: r.name,
      品牌: r.brand || "",
      VIN: r.vin,
      OE号: r.oeNumber || "",
      品牌编码: r.brandPartNumber || "",
      状态: r.success ? "创建成功" : "失败",
      关联车型数: r.matchedModels || 0,
      失败原因: r.error || "",
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "创建结果");
    const now = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    XLSX.writeFile(workbook, `批量创建配件结果_${now}.xlsx`);
  }

  const total = results.length;
  const successCount = results.filter((r) => r.success).length;
  const failCount = total - successCount;
  const totalModels = results.reduce((sum, r) => sum + (r.matchedModels || 0), 0);

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        {/* 模式切换 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => { setCreateMode("full"); setResults([]); setError(""); }}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
              createMode === "full"
                ? "bg-orange-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            完整模式（Excel含编码/名称/品牌/VIN）
          </button>
          <button
            onClick={() => { setCreateMode("vin-only"); setResults([]); setError(""); }}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
              createMode === "vin-only"
                ? "bg-orange-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            仅VIN模式（只传VIN，自动创建三滤）
          </button>
        </div>

        {createMode === "full" ? (
          <>
            <h2 className="text-base font-semibold text-gray-900 mb-4">上传Excel创建配件</h2>
            <p className="text-sm text-gray-500 mb-2">
              Excel需包含以下列：<strong>零件编码、零件名称、品牌、成本价、VIN</strong>
            </p>
            <p className="text-xs text-gray-400 mb-4">
              零件名称必须是&apos;机油滤&apos;/&apos;空气滤&apos;/&apos;空调滤&apos;之一。系统会用VIN查OE号并自动关联车型。
            </p>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-gray-900 mb-4">仅上传VIN，自动创建三滤</h2>
            <p className="text-sm text-gray-500 mb-2">
              Excel中只需包含<strong>VIN码</strong>列（列标题含&apos;VIN&apos;或&apos;车架号&apos;即可）
            </p>
            <p className="text-xs text-gray-400 mb-4">
              系统会自动为每个VIN创建机油滤、空气滤、空调滤（{selectedBrand}品牌），编码自动生成。
            </p>
            {/* 品牌选择 */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm text-gray-700">选择品牌：</span>
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="博世">博世</option>
                <option value="马勒">马勒</option>
                <option value="曼牌">曼牌</option>
              </select>
            </div>
          </>
        )}

        <div className="flex items-center gap-4">
          <label className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 cursor-pointer inline-block">
            {uploading ? "解析中..." : creating ? "创建中..." : "选择Excel文件"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={createMode === "full" ? handleCreateUpload : handleVinOnlyUpload}
              disabled={uploading || creating}
              className="hidden"
            />
          </label>
          {creating && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>创建中...{Math.round(progress)}%</span>
              <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-orange-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      </div>

      {total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">创建结果</h2>
            <button
              onClick={exportCreateResults}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
            >
              导出结果
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-900">{total}</div>
              <div className="text-gray-500">总记录</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-700">{successCount}</div>
              <div className="text-green-600">创建成功</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-700">{failCount}</div>
              <div className="text-red-600">失败</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-700">{totalModels}</div>
              <div className="text-blue-600">关联车型</div>
            </div>
          </div>
        </div>
      )}

      {total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">零件编码</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">零件名称</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">品牌</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">VIN</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">OE号</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">品牌编码</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-900">{r.partNumber}</td>
                    <td className="px-4 py-3">{r.name}</td>
                    <td className="px-4 py-3">{r.brand || "-"}</td>
                    <td className="px-4 py-3 font-mono text-gray-700">{r.vin}</td>
                    <td className="px-4 py-3">{r.oeNumber || "-"}</td>
                    <td className="px-4 py-3 font-mono text-gray-700">{r.brandPartNumber || "-"}</td>
                    <td className="px-4 py-3">
                      {r.success ? (
                        <span className="text-green-600">
                          成功{r.matchedModels ? `(${r.matchedModels}车型)` : ""}
                        </span>
                      ) : (
                        <span className="text-red-500" title={r.error}>
                          失败
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
