"use client";

import { useState } from "react";
import { syncPartVin17Models } from "@/app/parts/actions";
import { useRouter } from "next/navigation";

interface Props {
  partId: string;
  oeNumber: string | null;
  vin17GroupId: string | null;
}

export default function Vin17SyncButton({ partId, oeNumber, vin17GroupId }: Props) {
  const router = useRouter();
  const [vin, setVin] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  async function handleSync() {
    if (!oeNumber) {
      alert("该配件没有OE号，无法同步17VIN车型");
      return;
    }
    const trimmedVin = vin.trim().toUpperCase();
    if (trimmedVin.length !== 17) {
      alert("VIN码必须为17位");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await syncPartVin17Models(partId, trimmedVin);
      setResult(res);
      if (res.success) {
        router.refresh();
      }
    } catch (err: unknown) {
      setResult({ success: false, error: err instanceof Error ? err.message : "同步失败" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">17VIN 车型适配</h2>
        {vin17GroupId && (
          <span className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-full">
            品牌分组已获取
          </span>
        )}
      </div>

      {oeNumber ? (
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            OE号: <span className="font-medium text-gray-900">{oeNumber}</span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={vin}
              onChange={(e) => setVin(e.target.value.toUpperCase())}
              placeholder="输入17位VIN码获取品牌分组"
              maxLength={17}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={handleSync}
              disabled={loading || vin.trim().length !== 17}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              {loading ? "同步中..." : "同步17VIN车型"}
            </button>
          </div>

          <p className="text-xs text-gray-500">
            输入该配件常用适用车型的一个VIN码，系统自动解码获取品牌分组，然后查询17VIN获取该OE号适配的全部车型。
          </p>

          {result && (
            <div className={`text-sm px-3 py-2 rounded-lg ${result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
              {result.message || result.error}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">该配件没有OE号，无法同步17VIN适配车型。</p>
      )}
    </div>
  );
}
