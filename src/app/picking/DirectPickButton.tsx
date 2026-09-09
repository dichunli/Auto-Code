"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 直领开单 } from "@/app/picking-orders/actions";

interface Props {
  分支id: string;
  名称: string;
  剩余需领: number;
}

/* 急件直领按钮（待入库未入账的配件）：弹窗确认数量/领料人 → 直领开单 RPC。
   登记后库存不动，确认入库时自动即入即出轧平 */
export function DirectPickButton({ 分支id, 名称, 剩余需领 }: Props) {
  const router = useRouter();
  const [打开, set打开] = useState(false);
  const [数量, set数量] = useState("");
  const [领料人, set领料人] = useState("");
  const [备注, set备注] = useState("");
  const [loading, setLoading] = useState(false);

  function 打开弹窗() {
    set数量(String(剩余需领));
    set打开(true);
  }

  async function 提交() {
    const n = parseInt(数量);
    if (!Number.isInteger(n) || n <= 0) {
      alert("直领数量必须是大于 0 的整数");
      return;
    }
    if (n > 剩余需领) {
      alert(`该配件剩余需领 ${剩余需领} 件，不能超领`);
      return;
    }
    setLoading(true);
    try {
      const r = await 直领开单([{ work_order_item_part_id: 分支id, quantity: n }], 领料人, 备注);
      if (!r.success) {
        alert("直领失败: " + (r.error || "未知错误"));
        return;
      }
      set打开(false);
      set领料人("");
      set备注("");
      alert(`直领成功，领料单号 ${r.data?.no || ""}（入库确认时自动入账）`);
      router.refresh();
    } catch (err: unknown) {
      alert("直领失败: " + (err instanceof Error ? err.message : "网络异常"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={打开弹窗}
        className="text-xs px-2 py-1 rounded bg-orange-500 text-white hover:bg-orange-600 whitespace-nowrap"
      >
        急件直领
      </button>

      {/* 弹窗：固定定位 + 半透明遮罩 */}
      {打开 && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-base font-bold text-gray-900 mb-1">急件直领</h3>
            <p className="text-xs text-gray-500 mb-4">
              {名称} · 剩余需领 {剩余需领} 件。货在待入库还没入账，直领后直接给技师，
              等确认入库时库存账自动轧平。
            </p>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 w-16">数量</label>
                <input
                  type="number"
                  min={1}
                  max={剩余需领}
                  value={数量}
                  onChange={(e) => set数量(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 w-16">领料人</label>
                <input
                  type="text"
                  value={领料人}
                  onChange={(e) => set领料人(e.target.value)}
                  placeholder="谁领走的（可空）"
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 w-16">备注</label>
                <input
                  type="text"
                  value={备注}
                  onChange={(e) => set备注(e.target.value)}
                  placeholder="可空"
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => set打开(false)}
                disabled={loading}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={提交}
                disabled={loading}
                className="px-4 py-2 text-sm rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {loading ? "开单中..." : "确认直领"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
