"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { batchQueryVinFilters, VinQueryResult } from "./actions";
import { PageHeader } from "@/components/PageHeader";

interface ExcelRow {
  [key: string]: string | number | undefined;
}

export default function VinBatchQueryPage() {
  const [uploading, setUploading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<VinQueryResult[]>([]);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* 解析Excel文件 */
  function parseExcel(file: File): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];

          /* 找VIN列：第一行找包含"VIN"或"车架号"的列 */
          const header = rows[0] || [];
          let vinColIndex = header.findIndex(
            (h) =>
              String(h).toUpperCase().includes("VIN") ||
              String(h).includes("车架号") ||
              String(h).includes("车架")
          );

          /* 如果没找到VIN列标题，默认第一列 */
          if (vinColIndex === -1) vinColIndex = 0;

          /* 提取VIN（从第二行开始） */
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

  /* 上传并查询 */
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

      if (vins.length > 100) {
        setError(`VIN数量过多(${vins.length}个)，建议分批处理，每批不超过100个`);
        setUploading(false);
        return;
      }

      setUploading(false);
      setQuerying(true);

      /* 分批查询，每批10个 */
      const batchSize = 10;
      const allResults: VinQueryResult[] = [];

      for (let i = 0; i < vins.length; i += batchSize) {
        const batch = vins.slice(i, i + batchSize);
        const res = await batchQueryVinFilters(batch);
        if (res.success && res.data) {
          allResults.push(...res.data);
        }
        setProgress(Math.min(((i + batchSize) / vins.length) * 100, 100));
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

  /* 导出结果 */
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

  /* 统计 */
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
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title="VIN批量查三滤OE号" />

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">上传Excel</h2>
        <p className="text-sm text-gray-500 mb-4">
          Excel中需包含VIN码列（列标题含"VIN"或"车架号"即可），系统会自动提取有效的17位VIN码并批量查询三滤OE号。
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
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      </div>

      {/* 统计 */}
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

      {/* 结果表格 */}
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
                          {r.oil.fromCache && (
                            <span className="text-[10px] text-gray-400 ml-1">缓存</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.air ? (
                        <span className={r.air.fromCache ? "text-gray-700" : "text-blue-700"}>
                          {r.air.oeNumber}
                          {r.air.fromCache && (
                            <span className="text-[10px] text-gray-400 ml-1">缓存</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.cabin ? (
                        <span className={r.cabin.fromCache ? "text-gray-700" : "text-blue-700"}>
                          {r.cabin.oeNumber}
                          {r.cabin.fromCache && (
                            <span className="text-[10px] text-gray-400 ml-1">缓存</span>
                          )}
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
    </div>
  );
}
