"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 退回已入库 } from "@/app/procurement/actions";
import { 新建采购退货 } from "@/app/inventory/actions";
import { PriceValue } from "@/components/PriceVisibilityContext";
import { useConfirm, useAlert } from "./ConfirmDialog";
import { useToast } from "@/components/Toast";
import { DocumentNameInput } from "./DocumentNameInput";
import { useDebounce } from "@/lib/useDebounce";
import { toast } from "@/lib/globalToast";

interface PurchaseOrderItem {
  id: string;
  name: string;
  brand: string | null;
  specification: string | null;
  quantity: number;
  unit_cost: number | null;
  received_qty: number | null;
  part_id: string | null;
  work_order_item_part_id: string | null;
  part_number: string | null;
  supplier_part_name: string | null;
  unit: string | null;
  category: string | null;
  license_plate: string | null;
  photos: string[] | null;
  notes: string | null;
  /* 联配件档案（2026-09-13 商品搜索）：按条形码也能搜到该单 */
  parts: { barcode: string | null } | null;
}

interface InboundOrder {
  id: string;
  inbound_no: string;
  total_quantity: number;
  total_amount: number | null;
  created_at: string;
}

/* 订单类型导出给采购看板 page.tsx：服务端首屏查询结果作为 props 传入用（待办清单第9项） */
export interface PurchaseOrder {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  status: string;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
  suppliers: { id: string; name: string } | null;
  purchase_order_items: PurchaseOrderItem[];
  inbound_orders: InboundOrder[] | null;
}

/* 首屏数据 props（服务端查询注入，待办清单第9项）：
   有 initialOrders 时首屏直接渲染、跳过 useEffect 里的 loadData，
   避免 SPA 软导航时 session 未就绪导致整页空白；后续操作照常走 loadData 刷新 */
interface CompletedStorageListProps {
  initialOrders?: PurchaseOrder[];
}

/* 入库时间（日期范围筛选用）：取该单入库单里最新的一张，没有则用采购单创建时间兜底 */
function 取入库时间(o: PurchaseOrder): string {
  const 入库时间们 = (o.inbound_orders || []).map((io) => io.created_at);
  return 入库时间们.length > 0 ? 入库时间们.reduce((a, b) => (a > b ? a : b)) : o.created_at;
}

/* 库存批次（批量退货弹窗用）：只看还有剩余的批次 */
interface 库存批次 {
  id: string;
  part_id: string;
  batch_no: string | null;
  remaining: number;
}

/* 批量退货弹窗（2026-09-13 用户拍板：可单退也可批量退）：
   每行选批次（按剩余量过滤）、填退货数量，原因全单共用一个；
   逐行调 新建采购退货（每行本身是事务），失败的行汇总弹窗告知，成功的不回滚。
   批次数据由父组件在打开弹窗前查好传入（null=还在加载），弹窗内不再发请求。
   组件名用英文 PascalCase：中文名调用 Hook 会被 react-hooks/rules-of-hooks 误伤 */
function BatchReturnModal({
  单号,
  行们,
  批次Map,
  onClose,
  on完成,
}: {
  单号: string;
  行们: PurchaseOrderItem[];
  批次Map: Map<string, 库存批次[]> | null;
  onClose: () => void;
  on完成: () => void;
}) {
  const { showToast } = useToast();
  const { 请求提示, 提示弹窗 } = useAlert();
  /* 每行表单：批次id + 数量（字符串存储，提交转 number，遵守表单规范） */
  const [表单, set表单] = useState(() =>
    行们.map((it) => ({ itemId: it.id, batch_id: "", qty: String(it.received_qty ?? it.quantity) }))
  );
  const [原因, set原因] = useState("");
  const [提交中, set提交中] = useState(false);

  function 改行(itemId: string, patch: Partial<{ batch_id: string; qty: string }>) {
    set表单((prev) => prev.map((r) => (r.itemId === itemId ? { ...r, ...patch } : r)));
  }

  async function 提交() {
    /* 前端先校验：批次必选、数量 1..批次剩余 */
    for (const r of 表单) {
      const it = 行们.find((x) => x.id === r.itemId)!;
      const qty = parseInt(r.qty, 10);
      if (!r.batch_id) {
        showToast(`「${it.name}」还没选批次`, "warning");
        return;
      }
      const 批次 = (批次Map?.get(it.part_id || "") || []).find((b) => b.id === r.batch_id);
      if (!Number.isInteger(qty) || qty <= 0) {
        showToast(`「${it.name}」退货数量必须大于 0`, "warning");
        return;
      }
      if (批次 && qty > 批次.remaining) {
        showToast(`「${it.name}」所选批次只剩 ${批次.remaining} 件，退不了 ${qty} 件`, "warning");
        return;
      }
    }

    set提交中(true);
    const 失败们: string[] = [];
    let 成功数 = 0;
    try {
      for (const r of 表单) {
        const it = 行们.find((x) => x.id === r.itemId)!;
        try {
          const res = await 新建采购退货({
            partId: it.part_id!,
            batchId: r.batch_id,
            quantity: parseInt(r.qty, 10),
            reason: 原因,
          });
          if (res.success) 成功数++;
          else 失败们.push(`${it.name}：${res.error || "保存失败"}`);
        } catch (err: unknown) {
          失败们.push(`${it.name}：${err instanceof Error ? err.message : "网络异常"}`);
        }
      }
    } finally {
      set提交中(false);
    }

    if (失败们.length === 0) {
      showToast(`批量退货完成，共 ${成功数} 种商品`);
      on完成();
      onClose();
    } else {
      /* 部分失败：长文本清单必须让用户看完（useAlert），已成功的行不会重复扣减（批次剩余已变） */
      await 请求提示(
        `成功 ${成功数} 种，失败 ${失败们.length} 种：\n${失败们.map((m, i) => `${i + 1}. ${m}`).join("\n")}\n\n已成功的不用重复退；失败的请核对批次剩余后重试。`
      );
      if (成功数 > 0) on完成();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-3xl my-8">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">批量退货</h3>
            <p className="text-xs text-gray-500 mt-0.5">采购单 {单号} · 共 {行们.length} 种商品</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-4 max-h-[55vh] overflow-y-auto">
          {批次Map === null ? (
            <p className="text-sm text-gray-400 text-center py-6">正在加载可退批次...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-3 font-medium">商品</th>
                  <th className="py-2 pr-3 font-medium">编码</th>
                  <th className="py-2 pr-3 font-medium">退自批次（按剩余量）</th>
                  <th className="py-2 font-medium text-right w-24">退货数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {行们.map((it) => {
                  const 行 = 表单.find((r) => r.itemId === it.id)!;
                  const 可选批次 = 批次Map.get(it.part_id || "") || [];
                  return (
                    <tr key={it.id}>
                      <td className="py-2.5 pr-3 text-gray-900">{it.name}</td>
                      <td className="py-2.5 pr-3 text-gray-600">{it.part_number || "-"}</td>
                      <td className="py-2.5 pr-3">
                        {可选批次.length === 0 ? (
                          <span className="text-xs text-red-500">库存已无剩余，退不了</span>
                        ) : (
                          <select
                            value={行.batch_id}
                            onChange={(e) => 改行(it.id, { batch_id: e.target.value })}
                            className="w-full max-w-[220px] px-2 py-1.5 text-sm rounded border border-gray-200 bg-white focus:outline-none focus:border-blue-400"
                          >
                            <option value="">选择批次</option>
                            {可选批次.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.batch_no || "未命名批次"}（剩 {b.remaining}）
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <input
                          type="number"
                          min={1}
                          value={行.qty}
                          onChange={(e) => 改行(it.id, { qty: e.target.value })}
                          className="w-20 px-2 py-1.5 text-sm text-right rounded border border-gray-200 focus:outline-none focus:border-blue-400"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">退货原因（可选，全单共用）</label>
            <textarea
              rows={2}
              value={原因}
              onChange={(e) => set原因(e.target.value)}
              placeholder="如：质量问题、错发"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={提交中}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={提交}
            disabled={提交中 || 批次Map === null}
            className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50"
          >
            {提交中 ? "退货中..." : `确认退货（${行们.length} 种）`}
          </button>
        </div>
      </div>
      {提示弹窗}
    </div>
  );
}

export function CompletedStorageList(props: CompletedStorageListProps) {
  const router = useRouter();
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [orders, setOrders] = useState<PurchaseOrder[]>(props.initialOrders ?? []);
  const [loading, setLoading] = useState(!props.initialOrders);
  const [submitting, setSubmitting] = useState<string | null>(null);
  /* 筛选（2026-09-13）：商品信息（名称/编码/条形码/车牌）+ 供应商 + 入库日期范围 */
  const [商品搜索, set商品搜索] = useState("");
  const 防抖商品搜索 = useDebounce(商品搜索, 300).trim().toLowerCase();
  const [供应商筛选, set供应商筛选] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  /* 批量退货（2026-09-13）：勾选商品行 → 弹窗统一退；勾选键 = purchase_order_items.id */
  const [退货勾选, set退货勾选] = useState<Set<string>>(new Set());
  const [批量退货单, set批量退货单] = useState<PurchaseOrder | null>(null);
  /* 批量退货弹窗的可选批次（null=加载中）：点「批量退货」时一次性查好 */
  const [退货批次Map, set退货批次Map] = useState<Map<string, 库存批次[]> | null>(null);

  function 切换退货勾选(itemId: string, 勾选: boolean) {
    set退货勾选((prev) => {
      const next = new Set(prev);
      if (勾选) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  /* 打开批量退货弹窗：先查出所有勾选配件的可退批次（有剩余的），再交给弹窗 */
  async function 打开批量退货(order: PurchaseOrder) {
    const 选中行 = order.purchase_order_items.filter((it) => 退货勾选.has(it.id) && !!it.part_id);
    set批量退货单(order);
    set退货批次Map(null);
    const partIds = [...new Set(选中行.map((it) => it.part_id as string))];
    if (partIds.length === 0) {
      set退货批次Map(new Map());
      return;
    }
    const { data } = await supabase
      .from("part_batches")
      .select("id, part_id, batch_no, remaining")
      .in("part_id", partIds)
      .gt("remaining", 0)
      .order("created_at", { ascending: true });
    const map = new Map<string, 库存批次[]>();
    for (const b of (data || []) as 库存批次[]) {
      const list = map.get(b.part_id) || [];
      list.push(b);
      map.set(b.part_id, list);
    }
    set退货批次Map(map);
  }

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_orders")
      .select(
        `
        id, order_no, supplier_id, status, total_amount, notes, created_at,
        suppliers(id, name),
        purchase_order_items(
          id, name, brand, specification, quantity, unit_cost, received_qty,
          part_id, work_order_item_part_id, part_number, supplier_part_name,
          unit, category, license_plate, photos, notes, parts(barcode)
        ),
        inbound_orders(id, inbound_no, total_quantity, total_amount, created_at)
      `
      )
      .eq("status", "completed")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("加载已入库采购单失败:", error);
      setLoading(false);
      return;
    }

    setOrders((data || []) as unknown as PurchaseOrder[]);
    setLoading(false);
  }

  useEffect(() => {
    /* 服务端已给首屏数据则跳过首次查询，避免重复拉取 */
    if (props.initialOrders) return;
    loadData();

  }, []);

  /* 撤销已入库→退回待入库（2026-09-13 用户拍板新语义）：
     只倒退一步——扣回库存、删除入库单，收货处理结果全部保留；
     蓝卡流程单单回滚，黄卡流程整批回滚（RPC revoke_completed_inbound 新语义） */
  async function handleRevokeCompleted(orderId: string) {
    setSubmitting(`revoke-${orderId}`);
    try {
      /* 1. 只读预查：明细是否挂批次（黄卡=整批回滚）+ 入库单号（文案展示） */
      const { data: 明细们 } = await supabase
        .from("purchase_order_items")
        .select("receiving_batch_id")
        .eq("order_id", orderId);
      const 批次ids = [...new Set(
        ((明细们 || []) as { receiving_batch_id: string | null }[])
          .map((m) => m.receiving_batch_id)
          .filter((x): x is string => !!x)
      )];

      let 批次文案 = "";
      let 涉及单数 = 1;
      if (批次ids.length > 0) {
        const { data: 批次们 } = await supabase
          .from("receiving_batches")
          .select("id, batch_no")
          .in("id", 批次ids);
        const { data: 涉及明细 } = await supabase
          .from("purchase_order_items")
          .select("order_id")
          .in("receiving_batch_id", 批次ids);
        涉及单数 = new Set(((涉及明细 || []) as { order_id: string }[]).map((m) => m.order_id)).size;
        批次文案 = ((批次们 || []) as { batch_no: string }[]).map((b) => b.batch_no).join("、");
      }

      const { data: inboundOrderList } = await supabase
        .from("inbound_orders")
        .select("id, inbound_no")
        .eq("purchase_order_id", orderId)
        .eq("status", "completed");

      /* 2. 组装确认文案（新语义：只删入库单和库存，收货结果保留，不删待退货记录） */
      const 入库单文案 = inboundOrderList && inboundOrderList.length > 0
        ? `（${inboundOrderList.map((o) => o.inbound_no).join("、")}）`
        : "";
      const msg = 批次ids.length > 0
        ? `该单随批次 ${批次文案} 一起入库（共 ${涉及单数} 张采购单）。\n` +
          `撤销将【整批回滚】：扣回库存、删除入库单${入库单文案}，` +
          `${涉及单数 > 1 ? `全部 ${涉及单数} 张采购单` : "该单"}退回「待入库」。\n` +
          `收货结果（处理动作/数量）全部保留，是否继续？`
        : `撤销后将扣回库存、删除入库单${入库单文案}，该单退回「待入库」。\n` +
          `收货结果（处理动作/数量）全部保留，是否继续？`;
      if (!(await 请求确认(msg))) {
        setSubmitting(null);
        return;
      }

      /* 3. 回滚由数据库事务完成：扣回库存/仓位、删入库单/库存批次/流水/应付款，
         采购单（黄卡含整批）回 pending_storage；任一失败整体回滚 */
      const res = await 退回已入库(orderId);
      if (!res.success) throw new Error(res.error || "撤销失败");

      loadData();
    } catch (err: unknown) {
      toast("撤销失败: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setSubmitting(null);
    }
  }

  /* 供应商下拉选项从全量订单取（不随筛选变化，避免选项消失） */
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) set.add(o.suppliers?.name || "未指定供应商");
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh"));
  }, [orders]);

  /* 筛选：供应商 + 入库日期范围 + 商品信息（名称/编码/条形码/车牌 任一命中即保留该单） */
  const 筛选后订单 = useMemo(() => {
    let list = orders;
    if (供应商筛选) {
      list = list.filter((o) => (o.suppliers?.name || "未指定供应商") === 供应商筛选);
    }
    if (dateFrom || dateTo) {
      list = list.filter((o) => {
        const t = 取入库时间(o);
        if (dateFrom && t < `${dateFrom}T00:00:00`) return false;
        if (dateTo && t > `${dateTo}T23:59:59.999`) return false;
        return true;
      });
    }
    if (防抖商品搜索) {
      list = list.filter((o) =>
        o.purchase_order_items.some((it) =>
          [it.name, it.part_number, it.parts?.barcode, it.license_plate].some((字段) =>
            (字段 || "").toLowerCase().includes(防抖商品搜索)
          )
        )
      );
    }
    return list;
  }, [orders, 供应商筛选, dateFrom, dateTo, 防抖商品搜索]);

  const 有筛选 = !!(供应商筛选 || dateFrom || dateTo || 防抖商品搜索);

  const displayGroups = useMemo(() => {
    const map = new Map<string, PurchaseOrder[]>();
    for (const o of 筛选后订单) {
      const key = o.suppliers?.name || "未指定供应商";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([key, list]) => ({ key, orders: list }));
  }, [筛选后订单]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        加载中...
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        暂无已入库的采购单
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 筛选栏（2026-09-13）：商品搜索 + 供应商 + 入库日期范围 */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={商品搜索}
          onChange={(e) => set商品搜索(e.target.value)}
          placeholder="搜索商品：名称 / 编码 / 条形码 / 关联车牌"
          className="w-72 px-3 py-1.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400"
        />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">供应商:</span>
          <select
            value={供应商筛选}
            onChange={(e) => set供应商筛选(e.target.value)}
            className="px-2 py-1.5 text-sm rounded border border-gray-200 bg-white focus:outline-none focus:border-blue-400"
          >
            <option value="">全部</option>
            {supplierOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">入库日期:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
          />
          <span className="text-xs text-gray-400">至</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
          />
        </div>
        {有筛选 && (
          <button
            type="button"
            onClick={() => {
              set商品搜索("");
              set供应商筛选("");
              setDateFrom("");
              setDateTo("");
            }}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            清除筛选
          </button>
        )}
      </div>

      {displayGroups.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          没有符合条件的已入库单
        </div>
      )}

      {displayGroups.map((g) => (
        /* 分组卡片：与待采购页统一风格（2026-08-15）——左侧蓝竖条+蓝色标签+加粗组名 */
        <div key={g.key} className="bg-white rounded-xl border border-gray-200 border-l-4 border-l-blue-500 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 flex items-center">
                <span className="inline-block px-2 py-0.5 rounded bg-blue-600 text-white mr-2 text-[10px] font-bold">供应商</span>
                <span className="font-bold text-gray-900">{g.key}</span>
              </h3>
              <span className="text-xs text-gray-500">共 {g.orders.length} 张采购单</span>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {g.orders.map((order) => (
              <div key={order.id} className="px-6 py-4">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <Link
                    href={`/procurement/${order.id}`}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {order.order_no || order.id.slice(0, 8)}
                  </Link>
                  <span className="text-xs text-gray-500">
                    {new Date(order.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-gray-500">
                    {order.purchase_order_items.length} 项 · <PriceValue value={order.total_amount} />
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                    已入库
                  </span>
                  {order.inbound_orders && order.inbound_orders.length > 0 ? (
                    order.inbound_orders.map((io) => (
                      <Link
                        key={io.id}
                        href={`/inbound-orders/${io.id}`}
                        className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:text-blue-700"
                      >
                        入库单:{io.inbound_no}
                      </Link>
                    ))
                  ) : (
                    <span className="text-xs text-gray-400">暂无入库单</span>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-gray-100 rounded-lg">
                    <thead className="bg-gray-50">
                      <tr>
                        {/* 勾选列：批量退货用（未关联配件档案的行不可勾选） */}
                        <th className="px-2 py-2 w-8" title="勾选后可批量退货" />
                        <th className="px-3 py-2 text-left font-medium text-gray-500 w-10">序号</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">零件编码</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">商品名称</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">单据名称</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500 w-14">数量</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 w-12">单位</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">分类</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">车牌</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-500 w-32">到货数量</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-500 w-20">退货</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {order.purchase_order_items.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="px-2 py-2">
                            {item.part_id && (
                              <input
                                type="checkbox"
                                checked={退货勾选.has(item.id)}
                                onChange={(e) => 切换退货勾选(item.id, e.target.checked)}
                                className="h-4 w-4 accent-orange-600 align-middle"
                                title="勾选后可批量退货"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                          <td className="px-3 py-2 text-gray-700">{item.part_number || "-"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="text-gray-900 font-medium">{item.name}</div>
                            {item.brand || item.specification ? (
                              <div className="text-xs text-gray-400">
                                {item.brand || ""} {item.specification || ""}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            <DocumentNameInput 采购明细id={item.id} 初始值={item.supplier_part_name || ""} 保存后={loadData} />
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{item.quantity}</td>
                          <td className="px-3 py-2 text-gray-500">{item.unit || "-"}</td>
                          <td className="px-3 py-2 text-gray-500">{item.category || "-"}</td>
                          <td className="px-3 py-2 text-gray-500">{item.license_plate || "-"}</td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                              {item.received_qty || 0} / {item.quantity}
                            </span>
                          </td>
                          {/* 单独退货（2026-09-13）：跳到采购退货页并自动带出配件+数量，
                              批次在退货页按库存剩余手选；未关联配件档案的行不可从这里退 */}
                          <td className="px-3 py-2 text-center">
                            {item.part_id ? (
                              <button
                                type="button"
                                onClick={() =>
                                  router.push(
                                    `/inventory/returns/new?partId=${item.part_id}&qty=${item.received_qty ?? item.quantity}`
                                  )
                                }
                                className="text-xs px-2 py-1 text-orange-600 border border-orange-200 rounded hover:bg-orange-50"
                              >
                                去退货
                              </button>
                            ) : (
                              <span className="text-xs text-gray-300" title="未关联配件档案，请到退货页手工选择">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  {/* 批量退货入口：只统计本单已勾选的商品行 */}
                  {order.purchase_order_items.some((it) => 退货勾选.has(it.id)) && (
                    <button
                      type="button"
                      onClick={() => 打开批量退货(order)}
                      className="px-3 py-1.5 border border-orange-300 text-white bg-orange-600 text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors"
                    >
                      批量退货（已选 {order.purchase_order_items.filter((it) => 退货勾选.has(it.id)).length} 种）
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRevokeCompleted(order.id)}
                    disabled={submitting === `revoke-${order.id}`}
                    className="px-3 py-1.5 border border-orange-200 text-orange-600 bg-orange-50 text-sm font-medium rounded-lg hover:bg-orange-100 transition-colors disabled:opacity-50"
                  >
                    {submitting === `revoke-${order.id}` ? "处理中..." : "退回待入库"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* 批量退货弹窗：只带本单勾选且有配件档案的行 */}
      {批量退货单 && (
        <BatchReturnModal
          单号={批量退货单.order_no || 批量退货单.id.slice(0, 8)}
          行们={批量退货单.purchase_order_items.filter((it) => 退货勾选.has(it.id) && !!it.part_id)}
          批次Map={退货批次Map}
          onClose={() => set批量退货单(null)}
          on完成={() => set退货勾选(new Set())}
        />
      )}

      {确认弹窗}
    </div>
  );
}
