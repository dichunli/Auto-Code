"use client";

import { useState } from "react";
import { syncOeFromVin } from "@/app/parts/actions";
import { PageHeader } from "@/components/PageHeader";

export default function VinTestPage() {
  const [vin, setVin] = useState("");
  const [brand, setBrand] = useState("博世");
  const [filterName, setFilterName] = useState("机油滤");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    oeNumber?: string;
    brandPartNumber?: string;
    filterType?: string;
    matchedModelIds?: string[];
    error?: string;
  } | null>(null);

  async function handleTest() {
    const normalizedVin = vin.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalizedVin)) {
      alert("请输入17位VIN码");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await syncOeFromVin(normalizedVin, filterName, brand);
      setResult(res);
    } catch (err: unknown) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    setLoading(false);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <PageHeader title="VIN单条测试" />

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">VIN码</label>
            <input
              type="text"
              value={vin}
              onChange={(e) => setVin(e.target.value.toUpperCase())}
              placeholder="输入17位VIN码"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
              maxLength={17}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">品牌</label>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="博世">博世</option>
              <option value="马勒">马勒</option>
              <option value="曼牌">曼牌</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">三滤类型</label>
            <select
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="机油滤">机油滤</option>
              <option value="空气滤">空气滤</option>
              <option value="空调滤">空调滤</option>
            </select>
          </div>
        </div>
        <button
          onClick={handleTest}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "查询中..." : "查询"}
        </button>
      </div>

      {result && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">查询结果</h2>
          {result.success ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-20">状态：</span>
                <span className="text-green-600 font-medium">成功</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-20">OE号：</span>
                <span className="font-mono text-gray-900">{result.oeNumber || "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-20">品牌编码：</span>
                <span className="font-mono text-gray-900">{result.brandPartNumber || "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-20">匹配车型：</span>
                <span className="text-gray-900">{result.matchedModelIds?.length || 0} 个</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500 w-20">状态：</span>
              <span className="text-red-600 font-medium">失败</span>
              <span className="text-red-500">{result.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
