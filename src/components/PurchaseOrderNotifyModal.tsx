"use client";

/* ============================================================
 * PurchaseOrderNotifyModal — 发起采购成功后的「通知供应商」弹窗（2026-08-20）
 * 展示刚生成的采购单文本（单号/明细/约定物流），一键复制发给供应商微信。
 * ============================================================ */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { copyText } from "@/lib/copyText";

export interface 采购通知明细 {
  name: string;
  alias_name: string | null;      /* 供应商那边的叫法（单据名称） */
  part_number: string | null;
  brand: string | null;
  specification: string | null;
  quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  vin: string | null;             /* VIN 码（供应商按 VIN 查件；无工单的暂存件为空） */
}

export interface 采购通知数据 {
  orderId: string;
  order_no: string;
  supplierName: string;
  logisticsName: string | null;   /* null = 本地送货 */
  items: 采购通知明细[];
}

interface Props {
  data: 采购通知数据 | null;
  onClose: () => void;
}

/* 生成发给供应商的纯文本（微信粘贴友好：无表格无表情） */
function 生成通知文本(d: 采购通知数据): string {
  const 行 = d.items.map((it, i) => {
    const 名称行 = `${i + 1}. ${it.alias_name || it.name}${it.alias_name && it.name && it.alias_name !== it.name ? `（${it.name}）` : ""}`;
    const 细节: string[] = [];
    if (it.part_number) 细节.push(`编码:${it.part_number}`);
    if (it.brand) 细节.push(`品牌:${it.brand}`);
    if (it.specification) 细节.push(`规格:${it.specification}`);
    细节.push(`数量:${it.quantity ?? "-"}${it.unit || ""}`);
    if (it.unit_cost != null) 细节.push(`单价:¥${it.unit_cost.toFixed(2)}`);
    if (it.vin) 细节.push(`VIN:${it.vin}`);
    return 细节.length > 0 ? `${名称行}\n   ${细节.join("  ")}` : 名称行;
  });
  const 合计 = d.items.reduce((s, it) => s + (it.quantity ?? 0) * (it.unit_cost ?? 0), 0);
  return [
    `【采购单】${d.order_no}`,
    `供应商：${d.supplierName}`,
    `物流：${d.logisticsName || "本地送货"}`,
    "——————————",
    ...行,
    "——————————",
    `共 ${d.items.length} 项 · 合计 ¥${合计.toFixed(2)}`,
    `请确认后按约定物流发货，谢谢！`,
  ].join("\n");
}

export default function PurchaseOrderNotifyModal({ data, onClose }: Props) {
  const [复制成功, set复制成功] = useState(false);

  const 文本 = useMemo(() => (data ? 生成通知文本(data) : ""), [data]);

  if (!data) return null;

  async function 复制() {
    /* copyText 内部已带 execCommand 老式兜底 */
    if (await copyText(文本)) {
      set复制成功(true);
      return;
    }
    alert("自动复制失败，请手动复制文本框内容");
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">采购单已生成 · 通知供应商</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500">
            复制下面文本，微信发给供应商「{data.supplierName}」：
          </p>
          <pre className="whitespace-pre-wrap break-all bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-800 font-sans">{文本}</pre>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-2">
          <Link
            href={`/procurement/${data.orderId}`}
            className="text-xs text-blue-600 hover:underline"
          >
            查看采购单详情 →
          </Link>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              稍后发
            </button>
            <button
              type="button"
              onClick={复制}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              {复制成功 ? "✓ 已复制，去微信粘贴" : "复制文本发给供应商"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
