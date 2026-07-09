"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

// 扫码产出的配件形状，与 PartPickerModal 的 PickerPart 保持一致，供父组件直接复用
export interface ScannedPart {
  id: string;
  part_name_id: string | null;
  name: string;
  part_number: string | null;
  unit: string | null;
  part_brands: { name: string } | { name: string }[] | null;
  specification_text: string | null;
  part_specifications: { name: string } | null;
  unit_cost: number | null;
  unit_price: number | null;
  selectedQuantity?: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (parts: ScannedPart[]) => void;
}

// 扫码添加配件：连续扫码枪/手输编码，每扫一个入清单，重复扫同一个数量+1，
// 每条可手动改数量，扫完一次性确认加入。明确"扫码中"状态。
export default function ScanAddPartsModal({ open, onClose, onConfirm }: Props) {
  const supabase = createClient();
  const [code, setCode] = useState("");
  const [rows, setRows] = useState<{ part: ScannedPart; qty: number }[]>([]);
  const [msg, setMsg] = useState("");
  const [querying, setQuerying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时清空并聚焦输入框（扫码枪需要焦点在输入框）
  useEffect(() => {
    if (open) {
      setCode(""); setRows([]); setMsg("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const 处理编码 = useCallback(async (raw: string) => {
    const kw = raw.trim();
    if (!kw) return;
    setQuerying(true);
    setMsg("");
    // 精确优先：按 编码/条码 精确匹配；找到唯一才计入（连续扫码要求精确）
    const { data } = await supabase
      .from("parts")
      .select("id, part_number, oe_number, name, unit, unit_cost, unit_price, part_name_id, barcode, part_brands(name), specification_text, part_specifications(name)")
      .or(`part_number.eq.${kw},barcode.eq.${kw}`)
      .limit(2);
    setQuerying(false);
    setCode("");
    inputRef.current?.focus();
    if (!data || data.length === 0) { setMsg(`未找到编码「${kw}」的配件`); return; }
    if (data.length > 1) { setMsg(`编码「${kw}」匹配到多个配件，请用"选择配件"手动挑选`); return; }
    const p = data[0] as unknown as ScannedPart;
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.part.id === p.id);
      if (idx >= 0) {
        const next = [...prev]; next[idx] = { ...next[idx], qty: next[idx].qty + 1 }; return next;
      }
      return [...prev, { part: p, qty: 1 }];
    });
    setMsg(`已扫入：${data[0].name}`);
  }, [supabase]);

  function 改数量(id: string, qty: number) {
    setRows((prev) => prev.map((r) => (r.part.id === id ? { ...r, qty: Math.max(1, qty) } : r)));
  }
  function 移除(id: string) {
    setRows((prev) => prev.filter((r) => r.part.id !== id));
  }
  function 确认() {
    onConfirm(rows.map((r) => ({ ...r.part, selectedQuantity: r.qty })));
    onClose();
  }

  if (!open) return null;
  const 合计 = rows.reduce((s, r) => s + r.qty, 0);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">扫码添加配件</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">×</button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {/* 扫码中状态 + 输入框 */}
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 text-red-600">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              扫码中…
            </span>
            <span className="text-gray-400 text-xs">扫码枪对准即可，或手输编码后回车</span>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); 处理编码(code); } }}
            placeholder="扫码 / 输入编码后回车"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {querying && <p className="text-xs text-gray-400">查询中…</p>}
          {msg && <p className={`text-xs ${msg.startsWith("已扫入") ? "text-green-600" : "text-red-500"}`}>{msg}</p>}

          {/* 已扫清单 */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">已扫清单（{rows.length} 种）</span>
            <span className="text-gray-500">合计 {合计} 件</span>
          </div>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">还没扫入配件</p>
            ) : rows.map((r) => (
              <div key={r.part.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800 truncate">{r.part.name}</div>
                  <div className="text-xs text-gray-400 font-mono">{r.part.part_number}</div>
                </div>
                <button type="button" onClick={() => 改数量(r.part.id, r.qty - 1)} className="w-6 h-6 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">-</button>
                <input
                  type="number" min={1} value={r.qty}
                  onChange={(e) => 改数量(r.part.id, parseInt(e.target.value) || 1)}
                  className="w-12 px-1 py-0.5 border border-gray-200 rounded text-xs text-center"
                />
                <button type="button" onClick={() => 改数量(r.part.id, r.qty + 1)} className="w-6 h-6 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">+</button>
                <button type="button" onClick={() => 移除(r.part.id)} className="text-red-500 hover:text-red-700 ml-1">×</button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
          <button type="button" onClick={确认} disabled={rows.length === 0} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">确认添加（{rows.length}）</button>
        </div>
      </div>
    </div>
  );
}
