"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import { useConfirm } from "@/components/ConfirmDialog";
import { toast } from "@/lib/globalToast";
import { 报废出库 } from "@/app/inventory/actions";
import type { 报废记录行 } from "./page";

interface 批次选项 {
  id: string;
  batch_no: string | null;
  remaining: number;
}

interface 仓位选项 {
  warehouse_id: string;
  warehouse_name: string;
  location: string;
  quantity: number;
}

/* 报废出库表单（2026-09-19）：选配件 → 自动带出有库存的批次/仓位 → 填数量原因 */
export default function ScrapForm({ 最近记录 }: { 最近记录: 报废记录行[] }) {
  const router = useRouter();
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [配件id, 设配件id] = useState("");
  const [配件名, 设配件名] = useState("");
  const [编码查询, 设编码查询] = useState("");
  const [批次选项们, 设批次选项们] = useState<批次选项[]>([]);
  const [仓位选项们, 设仓位选项们] = useState<仓位选项[]>([]);
  const [批次id, 设批次id] = useState("");
  const [仓位值, 设仓位值] = useState("");
  const [数量, 设数量] = useState("");
  const [原因, 设原因] = useState("");
  const [备注, 设备注] = useState("");
  const [提交中, 设提交中] = useState(false);

  async function 选中配件(part: { id: string; name: string | null; part_number: string | null }) {
    设配件id(part.id);
    设配件名(part.name || part.part_number || "");
    设批次id("");
    设仓位值("");
    /* 并查有库存的批次和仓位 */
    const [批次结果, 仓位结果] = await Promise.all([
      supabase
        .from("part_batches")
        .select("id, batch_no, remaining")
        .eq("part_id", part.id)
        .gt("remaining", 0)
        .order("inbound_at", { ascending: true }),
      supabase
        .from("part_stock_locations")
        .select("warehouse_id, location, quantity, warehouses(name)")
        .eq("part_id", part.id)
        .gt("quantity", 0),
    ]);
    const 批次们 = (批次结果.data || []) as 批次选项[];
    设批次选项们(批次们);
    if (批次们.length === 1) 设批次id(批次们[0].id);
    const 仓位们 = ((仓位结果.data || []) as unknown as { warehouse_id: string; location: string | null; quantity: number; warehouses: { name: string } | { name: string }[] | null }[]).map((w) => ({
      warehouse_id: w.warehouse_id,
      warehouse_name: Array.isArray(w.warehouses) ? w.warehouses[0]?.name || "" : w.warehouses?.name || "",
      location: w.location || "",
      quantity: w.quantity,
    }));
    设仓位选项们(仓位们);
    if (仓位们.length === 1) 设仓位值(`${仓位们[0].warehouse_id}|${仓位们[0].location}`);
  }

  function 清空配件() {
    设配件id("");
    设配件名("");
    设编码查询("");
    设批次选项们([]);
    设仓位选项们([]);
    设批次id("");
    设仓位值("");
  }

  const 可提交 =
    !!配件id && !!批次id && !!仓位值 &&
    Number.isInteger(parseInt(数量, 10)) && parseInt(数量, 10) > 0 && !!原因.trim();

  async function 提交() {
    if (!可提交 || 提交中) return;
    if (!(await 请求确认(`确认报废「${配件名}」${数量} 件吗？\n报废后批次/总库存/仓位数量同步扣减，不可恢复。`))) return;
    设提交中(true);
    try {
      const [wid, loc] = 仓位值.split("|");
      const res = await 报废出库({
        part_id: 配件id,
        batch_id: 批次id,
        warehouse_id: wid,
        location: loc || "",
        quantity: parseInt(数量, 10),
        reason: 原因.trim(),
        notes: 备注.trim(),
      });
      if (!res.success) {
        toast("报废失败: " + (res.error || "未知错误"), "error");
        return;
      }
      toast("报废出库完成", "success");
      清空配件();
      设数量("");
      设原因("");
      设备注("");
      router.refresh();
    } catch (err: unknown) {
      toast("报废失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      设提交中(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 max-w-2xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            配件 <span className="text-red-500">*</span>
          </label>
          {配件id ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-900 font-medium">{配件名}</span>
              <button type="button" onClick={清空配件} className="text-xs text-blue-600 hover:underline">
                重选
              </button>
            </div>
          ) : (
            <PartSearchDropdown
              value={编码查询}
              onChange={设编码查询}
              onSelect={选中配件}
              onCreateNew={() => {}}
              onClear={清空配件}
              placeholder="编码 / 条码 / 名称"
            />
          )}
        </div>

        {配件id && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  报废批次 <span className="text-red-500">*</span>
                </label>
                <select
                  value={批次id}
                  onChange={(e) => 设批次id(e.target.value)}
                  className={`w-full px-3 py-2 text-sm rounded border bg-white focus:outline-none focus:border-blue-400 ${
                    !批次id ? "border-red-400 bg-red-50" : "border-gray-300"
                  }`}
                >
                  <option value="">选择批次</option>
                  {批次选项们.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batch_no || "未命名批次"}（剩 {b.remaining}）
                    </option>
                  ))}
                </select>
                {批次选项们.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">该配件没有可用批次</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  报废仓位 <span className="text-red-500">*</span>
                </label>
                <select
                  value={仓位值}
                  onChange={(e) => 设仓位值(e.target.value)}
                  className={`w-full px-3 py-2 text-sm rounded border bg-white focus:outline-none focus:border-blue-400 ${
                    !仓位值 ? "border-red-400 bg-red-50" : "border-gray-300"
                  }`}
                >
                  <option value="">选择仓位</option>
                  {仓位选项们.map((w) => (
                    <option key={`${w.warehouse_id}|${w.location}`} value={`${w.warehouse_id}|${w.location}`}>
                      {w.warehouse_name}{w.location ? ` · ${w.location}` : ""}（存 {w.quantity}）
                    </option>
                  ))}
                </select>
                {仓位选项们.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">该配件没有仓位库存记录</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  报废数量 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={数量}
                  onChange={(e) => 设数量(e.target.value)}
                  placeholder="必填"
                  className={`w-full px-3 py-2 text-sm text-right rounded border focus:outline-none focus:border-blue-400 ${
                    !数量 ? "border-red-400 bg-red-50" : "border-gray-300"
                  }`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  报废原因 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={原因}
                  onChange={(e) => 设原因(e.target.value)}
                  placeholder="如：锈蚀损坏"
                  className={`w-full px-3 py-2 text-sm rounded border focus:outline-none focus:border-blue-400 ${
                    !原因.trim() ? "border-red-400 bg-red-50" : "border-gray-300"
                  }`}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
              <input
                type="text"
                value={备注}
                onChange={(e) => 设备注(e.target.value)}
                placeholder="选填"
                className="w-full px-3 py-2 text-sm rounded border border-gray-300"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={提交}
                disabled={!可提交 || 提交中}
                className="px-6 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {提交中 ? "报废中..." : "确认报废"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 最近报废记录 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-900">最近报废记录</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-2 text-left font-medium text-gray-500">配件</th>
              <th className="px-6 py-2 text-left font-medium text-gray-500">仓位</th>
              <th className="px-6 py-2 text-right font-medium text-gray-500">数量</th>
              <th className="px-6 py-2 text-left font-medium text-gray-500">原因</th>
              <th className="px-6 py-2 text-left font-medium text-gray-500">操作人</th>
              <th className="px-6 py-2 text-left font-medium text-gray-500">时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {最近记录.map((r) => (
              <tr key={r.id}>
                <td className="px-6 py-2.5 text-gray-900">
                  {r.parts?.name || "-"}
                  {r.parts?.part_number && <span className="ml-1 text-xs text-gray-400">{r.parts.part_number}</span>}
                </td>
                <td className="px-6 py-2.5 text-gray-600">{r.warehouses?.name || "-"}</td>
                <td className="px-6 py-2.5 text-right text-red-600 font-medium">{r.quantity}</td>
                <td className="px-6 py-2.5 text-gray-600">{r.reason || "-"}</td>
                <td className="px-6 py-2.5 text-gray-600">{r.profiles?.full_name || "-"}</td>
                <td className="px-6 py-2.5 text-gray-500 text-xs">{new Date(r.created_at).toLocaleString("zh-CN")}</td>
              </tr>
            ))}
            {最近记录.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-400">暂无报废记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {确认弹窗}
    </div>
  );
}
