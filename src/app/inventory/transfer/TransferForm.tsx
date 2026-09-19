"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import { ScanLocationButton } from "@/components/ScanLocationButton";
import { useConfirm } from "@/components/ConfirmDialog";
import { toast } from "@/lib/globalToast";
import { 仓位调拨 } from "@/app/inventory/actions";
import type { 调拨记录行 } from "./page";

interface 仓位选项 {
  warehouse_id: string;
  warehouse_name: string;
  location: string;
  quantity: number;
}

/* 仓位调拨表单（2026-09-19）：选配件 → 源仓位（有库存的）→ 目标仓库+仓位 → 数量 */
export default function TransferForm({
  最近记录,
  仓库列表,
}: {
  最近记录: 调拨记录行[];
  仓库列表: { id: string; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [配件id, 设配件id] = useState("");
  const [配件名, 设配件名] = useState("");
  const [编码查询, 设编码查询] = useState("");
  const [源仓位选项们, 设源仓位选项们] = useState<仓位选项[]>([]);
  const [源仓位值, 设源仓位值] = useState("");
  const [目标仓库id, 设目标仓库id] = useState("");
  const [目标仓位文本, 设目标仓位文本] = useState("");
  const [数量, 设数量] = useState("");
  const [备注, 设备注] = useState("");
  const [提交中, 设提交中] = useState(false);

  async function 选中配件(part: { id: string; name: string | null; part_number: string | null }) {
    设配件id(part.id);
    设配件名(part.name || part.part_number || "");
    设源仓位值("");
    const { data } = await supabase
      .from("part_stock_locations")
      .select("warehouse_id, location, quantity, warehouses(name)")
      .eq("part_id", part.id)
      .gt("quantity", 0);
    const 仓位们 = ((data || []) as unknown as { warehouse_id: string; location: string | null; quantity: number; warehouses: { name: string } | { name: string }[] | null }[]).map((w) => ({
      warehouse_id: w.warehouse_id,
      warehouse_name: Array.isArray(w.warehouses) ? w.warehouses[0]?.name || "" : w.warehouses?.name || "",
      location: w.location || "",
      quantity: w.quantity,
    }));
    设源仓位选项们(仓位们);
    if (仓位们.length === 1) 设源仓位值(`${仓位们[0].warehouse_id}|${仓位们[0].location}`);
  }

  function 清空配件() {
    设配件id("");
    设配件名("");
    设编码查询("");
    设源仓位选项们([]);
    设源仓位值("");
  }

  const 源仓位信息 = 源仓位选项们.find((w) => `${w.warehouse_id}|${w.location}` === 源仓位值);
  const 可提交 =
    !!配件id && !!源仓位值 && !!目标仓库id &&
    Number.isInteger(parseInt(数量, 10)) && parseInt(数量, 10) > 0;

  async function 提交() {
    if (!可提交 || 提交中) return;
    const 目标仓名 = 仓库列表.find((w) => w.id === 目标仓库id)?.name || "";
    const 目标显示 = 目标仓名 + (目标仓位文本.trim() ? ` · ${目标仓位文本.trim()}` : "");
    if (
      !(await 请求确认(
        `确认把「${配件名}」${数量} 件\n从 ${源仓位信息?.warehouse_name || ""}${源仓位信息?.location ? ` · ${源仓位信息.location}` : ""}\n调到 ${目标显示} 吗？`
      ))
    )
      return;
    设提交中(true);
    try {
      const [wid, loc] = 源仓位值.split("|");
      const res = await 仓位调拨({
        part_id: 配件id,
        from_warehouse_id: wid,
        from_location: loc || "",
        to_warehouse_id: 目标仓库id,
        to_location: 目标仓位文本.trim(),
        quantity: parseInt(数量, 10),
        notes: 备注.trim(),
      });
      if (!res.success) {
        toast("调拨失败: " + (res.error || "未知错误"), "error");
        return;
      }
      toast("调拨完成", "success");
      /* 源仓位数量变了，刷新选项 */
      await 选中配件({ id: 配件id, name: 配件名, part_number: null as string | null });
      设数量("");
      设备注("");
      router.refresh();
    } catch (err: unknown) {
      toast("调拨失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
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
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">
                    源仓位 <span className="text-red-500">*</span>
                  </label>
                  {/* 扫仓位码确认（2026-09-19 用户拍板） */}
                  <ScanLocationButton
                    on命中={(w) => {
                      const 选项 = 源仓位选项们.find(
                        (o) => o.warehouse_id === w.warehouse_id && o.location === w.location
                      );
                      if (!选项) {
                        toast(`该配件在「${w.warehouse_name}${w.location ? ` · ${w.location}` : ""}」没有库存`, "warning");
                        return;
                      }
                      设源仓位值(`${w.warehouse_id}|${w.location}`);
                    }}
                  />
                </div>
                <select
                  value={源仓位值}
                  onChange={(e) => 设源仓位值(e.target.value)}
                  className={`w-full px-3 py-2 text-sm rounded border bg-white focus:outline-none focus:border-blue-400 ${
                    !源仓位值 ? "border-red-400 bg-red-50" : "border-gray-300"
                  }`}
                >
                  <option value="">选择源仓位</option>
                  {源仓位选项们.map((w) => (
                    <option key={`${w.warehouse_id}|${w.location}`} value={`${w.warehouse_id}|${w.location}`}>
                      {w.warehouse_name}{w.location ? ` · ${w.location}` : ""}（存 {w.quantity}）
                    </option>
                  ))}
                </select>
                {源仓位选项们.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">该配件没有仓位库存记录</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  调拨数量 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={源仓位信息?.quantity}
                  value={数量}
                  onChange={(e) => 设数量(e.target.value)}
                  placeholder="必填"
                  className={`w-full px-3 py-2 text-sm text-right rounded border focus:outline-none focus:border-blue-400 ${
                    !数量 ? "border-red-400 bg-red-50" : "border-gray-300"
                  }`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  目标仓库 <span className="text-red-500">*</span>
                </label>
                <select
                  value={目标仓库id}
                  onChange={(e) => 设目标仓库id(e.target.value)}
                  className={`w-full px-3 py-2 text-sm rounded border bg-white focus:outline-none focus:border-blue-400 ${
                    !目标仓库id ? "border-red-400 bg-red-50" : "border-gray-300"
                  }`}
                >
                  <option value="">选择目标仓库</option>
                  {仓库列表.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">目标仓位</label>
                  {/* 扫目标仓位码：自动填目标仓库+仓位（2026-09-19） */}
                  <ScanLocationButton
                    on命中={(w) => {
                      设目标仓库id(w.warehouse_id);
                      设目标仓位文本(w.location);
                      toast(`目标仓位：${w.warehouse_name}${w.location ? ` · ${w.location}` : ""}`, "success");
                    }}
                  />
                </div>
                <input
                  type="text"
                  value={目标仓位文本}
                  onChange={(e) => 设目标仓位文本(e.target.value)}
                  placeholder="仓位（选填）"
                  className="w-full px-3 py-2 text-sm rounded border border-gray-300"
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
                className="px-6 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {提交中 ? "调拨中..." : "确认调拨"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 最近调拨记录 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-900">最近调拨记录</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-2 text-left font-medium text-gray-500">配件</th>
              <th className="px-6 py-2 text-left font-medium text-gray-500">从</th>
              <th className="px-6 py-2 text-left font-medium text-gray-500">到</th>
              <th className="px-6 py-2 text-right font-medium text-gray-500">数量</th>
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
                <td className="px-6 py-2.5 text-gray-600">
                  {r.from_warehouse?.name || "-"}{r.from_location ? ` · ${r.from_location}` : ""}
                </td>
                <td className="px-6 py-2.5 text-gray-600">
                  {r.to_warehouse?.name || "-"}{r.to_location ? ` · ${r.to_location}` : ""}
                </td>
                <td className="px-6 py-2.5 text-right text-gray-900 font-medium">{r.quantity}</td>
                <td className="px-6 py-2.5 text-gray-600">{r.profiles?.full_name || "-"}</td>
                <td className="px-6 py-2.5 text-gray-500 text-xs">{new Date(r.created_at).toLocaleString("zh-CN")}</td>
              </tr>
            ))}
            {最近记录.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-400">暂无调拨记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {确认弹窗}
    </div>
  );
}
