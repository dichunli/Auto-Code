"use client";

/* ============================================================
 * CustomPurchaseModal — 待采购页「自定义采购」弹窗（2026-08-14 需求）
 * 用途：采购与工单无关的配件（店里自用、提前备货等）
 *   - 系统里有的配件：按编码/条码/OE号/名称/品牌搜索，选中加入清单
 *   - 系统里没有的：现场新建配件（内嵌 PartForm），保存后自动加入清单
 *   - 清单按供应商分组生成采购单（草稿状态）
 * ============================================================ */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { 清理搜索词 } from "@/lib/sanitizeQuery";
import { useConfirm } from "./ConfirmDialog";
import PartForm from "@/app/parts/new/PartForm";
import { 添加采购暂存 } from "@/app/procurement/actions";

interface 搜索结果 {
  id: string;
  part_number: string | null;
  barcode: string | null;
  oe_number: string | null;
  name: string | null;
  unit: string | null;
  unit_cost: number | null;
  purchase_price: number | null;
  supplier_id: string | null;
  document_name: string | null;
  part_brands: { name: string | null } | null;
  part_specifications: { name: string | null } | null;
}

interface 清单行 {
  partId: string;
  partNumber: string;
  name: string;
  brand: string;
  spec: string;
  unit: string;
  documentName: string;
  unitCost: string;
  quantity: string;
  supplierId: string;
}

interface 供应商 {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  suppliers: 供应商[];
  /* 成功后由父级显示内联提示条（不用系统 alert 弹窗） */
  on成功?: (文字: string) => void;
}

export default function CustomPurchaseModal({ open, onClose, suppliers, on成功 }: Props) {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();

  const [搜索词, set搜索词] = useState("");
  const [搜索结果, set搜索结果] = useState<搜索结果[]>([]);
  const [搜索中, set搜索中] = useState(false);
  const [清单, set清单] = useState<清单行[]>([]);
  const [提交中, set提交中] = useState(false);
  const [新建弹窗开, set新建弹窗开] = useState(false);
  /* 弹窗内联错误提示（替代系统 alert，2026-08-14 用户要求） */
  const [错误提示, set错误提示] = useState("");

  const 防抖搜索词 = useDebounce(搜索词, 300);

  /* 打开弹窗时重置状态 */
  useEffect(() => {
    if (open) {
      set搜索词("");
      set搜索结果([]);
      set清单([]);
      set新建弹窗开(false);
      set错误提示("");
    }
  }, [open]);

  /* 搜索：编码/条码/OE号/名称 直查 + 品牌名命中后按品牌查配件，合并去重 */
  useEffect(() => {
    const kw = 清理搜索词(防抖搜索词);
    if (kw.length < 1) {
      set搜索结果([]);
      return;
    }
    let 已取消 = false;
    (async () => {
      set搜索中(true);
      const 字段 = `id, part_number, barcode, oe_number, name, unit, unit_cost, purchase_price, supplier_id, document_name,
        part_brands(name), part_specifications(name)`;
      const [{ data: 直查 }, { data: 品牌命中 }] = await Promise.all([
        supabase
          .from("parts")
          .select(字段)
          .or(`part_number.ilike.%${kw}%,barcode.ilike.%${kw}%,oe_number.ilike.%${kw}%,name.ilike.%${kw}%`)
          .limit(10),
        supabase.from("part_brands").select("id").ilike("name", `%${kw}%`).limit(5),
      ]);
      let 品牌查: 搜索结果[] = [];
      const 品牌ids = (品牌命中 || []).map((b: { id: string }) => b.id);
      if (品牌ids.length > 0) {
        const { data } = await supabase
          .from("parts")
          .select(字段)
          .in("brand_id", 品牌ids)
          .limit(10);
        品牌查 = (data || []) as unknown as 搜索结果[];
      }
      if (已取消) return;
      const 合并 = new Map<string, 搜索结果>();
      for (const p of [...((直查 || []) as unknown as 搜索结果[]), ...品牌查]) {
        if (!合并.has(p.id)) 合并.set(p.id, p);
      }
      set搜索结果(Array.from(合并.values()).slice(0, 12));
      set搜索中(false);
    })();
    return () => {
      已取消 = true;
    };

  }, [防抖搜索词]);

  function 加入清单(p: 搜索结果) {
    if (清单.some((r) => r.partId === p.id)) return;
    set清单((prev) => [
      ...prev,
      {
        partId: p.id,
        partNumber: p.part_number || p.barcode || "",
        name: p.name || "",
        brand: p.part_brands?.name || "",
        spec: p.part_specifications?.name || "",
        unit: p.unit || "件",
        documentName: p.document_name || "",
        unitCost: p.purchase_price != null ? String(p.purchase_price) : p.unit_cost != null ? String(p.unit_cost) : "",
        quantity: "1",
        supplierId: p.supplier_id || "",
      },
    ]);
  }

  function 移除行(partId: string) {
    set清单((prev) => prev.filter((r) => r.partId !== partId));
  }

  function 改行(partId: string, 字段: "quantity" | "supplierId" | "unitCost", 值: string) {
    set清单((prev) => prev.map((r) => (r.partId === partId ? { ...r, [字段]: 值 } : r)));
  }

  /* 新建配件保存后：查出来加入清单 */
  async function 新建保存后(partId: string) {
    const { data } = await supabase
      .from("parts")
      .select(`id, part_number, barcode, oe_number, name, unit, unit_cost, purchase_price, supplier_id, document_name,
        part_brands(name), part_specifications(name)`)
      .eq("id", partId)
      .single();
    set新建弹窗开(false);
    if (data) 加入清单(data as unknown as 搜索结果);
  }

  const 缺供应商行 = useMemo(() => 清单.filter((r) => !r.supplierId), [清单]);

  /* 数量是否有效（大于 0 的整数） */
  function 数量有效(q: string): boolean {
    if (q.trim() === "") return false;
    const n = Number(q);
    return Number.isInteger(n) && n > 0;
  }

  /* 可提交 = 清单非空 + 每行都选了供应商 + 每行数量有效；不满足时按钮置灰（不用弹窗拦截） */
  const 可提交 = 清单.length > 0 && 缺供应商行.length === 0 && 清单.every((r) => 数量有效(r.quantity));

  async function 添加到待采购() {
    if (!可提交) return;
    set错误提示("");
    if (!(await 请求确认(`将把 ${清单.length} 条配件添加到「待采购」列表，之后与工单配件一起统一发起采购，是否继续？`))) return;

    set提交中(true);
    try {
      const res = await 添加采购暂存(
        清单.map((r) => ({
          part_id: r.partId,
          part_number: r.partNumber || null,
          name: r.name,
          brand: r.brand || null,
          specification: r.spec || null,
          document_name: r.documentName || null,
          unit: r.unit || null,
          unit_cost: r.unitCost.trim() === "" ? null : Number(r.unitCost),
          quantity: Number(r.quantity),
          supplier_id: r.supplierId,
          source: "custom" as const,
        }))
      );
      if (!res.success) throw new Error(res.error || "添加失败");
      on成功?.(`已添加 ${res.count ?? 清单.length} 条配件到「待采购」列表，勾选后可统一发起采购。`);
      onClose();
    } catch (err: unknown) {
      set错误提示("添加失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      set提交中(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-3xl max-h-[85vh] flex flex-col">
        <h3 className="text-base font-semibold text-gray-900 mb-1">自定义采购</h3>
        <p className="text-xs text-gray-400 mb-3">采购与工单无关的配件：搜索系统已有配件加入清单，搜不到可现场新建</p>
        {错误提示 && (
          <div className="mb-3 px-3 py-2 text-xs bg-red-50 text-red-700 rounded-lg flex items-center justify-between">
            <span>{错误提示}</span>
            <button type="button" onClick={() => set错误提示("")} className="text-gray-400 hover:text-gray-600">×</button>
          </div>
        )}

        {/* 搜索区 */}
        <input
          type="text"
          value={搜索词}
          onChange={(e) => set搜索词(e.target.value)}
          placeholder="按编码 / 条码 / OE号 / 名称 / 品牌搜索配件..."
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-blue-500 focus:outline-none"
        />
        <div className="mt-2 border border-gray-100 rounded-lg max-h-44 overflow-y-auto">
          {搜索中 && <div className="px-3 py-3 text-xs text-gray-400 text-center">搜索中...</div>}
          {!搜索中 && 搜索词.trim() && 搜索结果.length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-400 text-center">
              没有找到匹配配件，可点击下方「新建配件」
            </div>
          )}
          {!搜索中 && 搜索结果.map((p) => {
            const 已在清单 = 清单.some((r) => r.partId === p.id);
            return (
              <div key={p.id} className="px-3 py-2 flex items-center justify-between gap-2 border-b border-gray-50 last:border-b-0 text-xs">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">{p.part_number || p.barcode || "无编码"}</span>
                  <span className="ml-2 text-gray-700">{p.name || "-"}</span>
                  <span className="ml-2 text-gray-400">
                    {[p.part_brands?.name, p.part_specifications?.name].filter(Boolean).join(" ")}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={已在清单}
                  onClick={() => 加入清单(p)}
                  className="shrink-0 px-2.5 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-40"
                >
                  {已在清单 ? "已添加" : "添加"}
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => set新建弹窗开(true)}
          className="mt-2 self-start px-3 py-1.5 text-xs rounded-lg border border-dashed border-blue-400 text-blue-600 hover:bg-blue-50"
        >
          + 新建配件（系统里没有的）
        </button>

        {/* 采购清单 */}
        <div className="mt-4 flex-1 overflow-y-auto border border-gray-200 rounded-lg">
          {清单.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm">清单为空，先搜索或新建配件</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">配件</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">单据名称</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">采购价</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">供应商 *</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">数量 *</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {清单.map((r) => (
                  <tr key={r.partId}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{r.name}</div>
                      <div className="text-gray-400">{[r.partNumber, r.brand, r.spec].filter(Boolean).join(" ")}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{r.documentName || "-"}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={r.unitCost}
                        onChange={(e) => 改行(r.partId, "unitCost", e.target.value)}
                        placeholder="选填"
                        className="w-20 px-1.5 py-1 text-right rounded border border-gray-300"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {/* 未选供应商红框，选了变黄（2026-08-14 用户要求） */}
                      <select
                        value={r.supplierId}
                        onChange={(e) => 改行(r.partId, "supplierId", e.target.value)}
                        className={`rounded border px-1.5 py-1 text-xs max-w-[9rem] ${
                          r.supplierId ? "border-yellow-400 bg-yellow-50" : "border-red-300 bg-red-50 text-red-600"
                        }`}
                      >
                        <option value="">请选择</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* 数量无效红框，有效变黄 */}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={r.quantity}
                        onChange={(e) => 改行(r.partId, "quantity", e.target.value)}
                        className={`w-16 px-1.5 py-1 text-right rounded border ${
                          数量有效(r.quantity) ? "border-yellow-400 bg-yellow-50" : "border-red-300 bg-red-50 text-red-600"
                        }`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => 移除行(r.partId)}
                        className="text-red-500 hover:text-red-600"
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={添加到待采购}
            disabled={!可提交 || 提交中}
            title={可提交 ? "" : "每行都要选供应商、填数量才能添加"}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {提交中 ? "添加中..." : `添加到待采购 (${清单.length})`}
          </button>
        </div>
      </div>

      {/* 新建配件弹窗（嵌套）：保存后自动加入清单 */}
      {新建弹窗开 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-6xl max-h-[90vh] overflow-y-auto m-4">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-lg font-semibold text-gray-900">新建配件</h3>
              <button
                type="button"
                onClick={() => set新建弹窗开(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="p-6">
              <PartForm
                onSaved={新建保存后}
                onCancel={() => set新建弹窗开(false)}
                prefillData={{ part_number: 搜索词.trim(), name: "" }}
              />
            </div>
          </div>
        </div>
      )}
      {确认弹窗}
    </div>
  );
}
