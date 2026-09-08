import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { InboundBarcodePrint } from "@/components/InboundBarcodePrint";
import { InboundDraftEditor, type 确认单编辑行 } from "./InboundDraftEditor";
import { 查询批次运单 } from "@/lib/batchCards";

interface InboundOrderItem {
  id: string;
  purchase_order_item_id: string | null;
  part_id: string | null;
  part_number: string | null;
  name: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  quantity: number;
  unit_cost: number | null;
  allocated_cost: number | null;
  freight_manual: boolean;
  batch_no: string | null;
  notes: string | null;
  warehouse_id: string | null;
  location: string | null;
  warehouses: { name: string } | null;
  /* 联采购明细：双写 WOI / 弹窗预填用（draft 编辑器改编码） */
  purchase_orders_items_join: { work_order_item_part_id: string | null; supplier_part_name: string | null } | null;
  /* 联配件档案：条码打印内容（barcode || part_number || part_id，与库存页同口径） */
  parts: { barcode: string | null } | null;
}

interface InboundOrder {
  id: string;
  inbound_no: string;
  supplier_name: string | null;
  total_quantity: number;
  total_amount: number | null;
  freight_amount: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  receiving_batch_id: string | null;
  purchase_order_id: string | null;
  waybill_id: string | null;
  supplier_order_no: string | null;
  supplier_order_amount: number | null;
  discount_amount: number | null;
  purchase_orders: { id: string; order_no: string | null } | null;
  receiving_batches: { batch_no: string | null } | null;
  profiles: { full_name: string | null } | null;
}

interface InventoryLog {
  id: string;
  change_qty: number;
  type: string;
  notes: string | null;
  created_at: string;
  parts: { name: string | null } | null;
}

export default async function InboundOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("inbound_orders")
    .select(
      "id, inbound_no, supplier_name, total_quantity, total_amount, freight_amount, status, notes, created_at, receiving_batch_id, purchase_order_id, waybill_id, supplier_order_no, supplier_order_amount, discount_amount, purchase_orders(id, order_no), receiving_batches(batch_no), profiles(full_name)"
    )
    .eq("id", id)
    .single();

  if (!order) notFound();

  const { data: items } = await supabase
    .from("inbound_order_items")
    .select("id, purchase_order_item_id, part_id, part_number, name, brand, specification, unit, quantity, unit_cost, allocated_cost, freight_manual, batch_no, notes, warehouse_id, location, warehouses(name), purchase_order_items(work_order_item_part_id, supplier_part_name), parts(barcode)")
    .eq("inbound_order_id", id)
    .order("created_at", { ascending: true });

  const { data: logs } = await supabase
    .from("inventory_logs")
    .select("id, change_qty, type, notes, created_at, parts(name)")
    .eq("reference_type", "inbound_order")
    .eq("reference_id", id)
    .order("created_at", { ascending: true });

  const inboundOrder = order as unknown as InboundOrder;
  const 是确认单 = inboundOrder.status === "draft";

  /* 明细行适配：postgrest 联表键名按关系名返回（purchase_order_items/parts） */
  const 原始行们 = (items || []) as unknown as (Omit<InboundOrderItem, "purchase_orders_items_join"> & {
    purchase_order_items: { work_order_item_part_id: string | null; supplier_part_name: string | null } | { work_order_item_part_id: string | null; supplier_part_name: string | null }[] | null;
  })[];
  const inboundItems: InboundOrderItem[] = 原始行们.map((行) => ({
    ...行,
    purchase_orders_items_join: Array.isArray(行.purchase_order_items)
      ? 行.purchase_order_items[0] ?? null
      : 行.purchase_order_items ?? null,
  }));

  /* 条码打印行（draft/completed 都能打：确认前提前贴码，确认后补打） */
  const 条码行们 = inboundItems.map((行) => ({
    name: 行.name || "-",
    code: 行.parts?.barcode || 行.part_number || 行.part_id || "-",
    quantity: 行.quantity,
  }));

  const inventoryLogs = (logs || []) as unknown as InventoryLog[];

  /* draft 编辑器的配套数据：仓库列表 + 批次来源的可选分摊运单 */
  let 仓库列表: { id: string; name: string }[] = [];
  let 运单列表: { id: string; tracking_no: string | null; logistics_company_name: string | null; 剩余: number }[] = [];
  if (是确认单) {
    const { data: 仓库们 } = await supabase.from("warehouses").select("id, name").order("name");
    仓库列表 = (仓库们 || []) as { id: string; name: string }[];
    if (inboundOrder.receiving_batch_id) {
      运单列表 = await 查询批次运单(supabase, inboundOrder.receiving_batch_id);
    }
  }

  /* 编辑行组装（draft 编辑器 props） */
  const 编辑行们: 确认单编辑行[] = inboundItems.map((行) => ({
    id: 行.id,
    purchase_order_item_id: 行.purchase_order_item_id,
    work_order_item_part_id: 行.purchase_orders_items_join?.work_order_item_part_id ?? null,
    part_id: 行.part_id,
    part_number: 行.part_number,
    name: 行.name,
    brand: 行.brand,
    specification: 行.specification,
    unit: 行.unit,
    supplier_part_name: 行.purchase_orders_items_join?.supplier_part_name ?? null,
    quantity: 行.quantity,
    unit_cost: 行.unit_cost,
    allocated_cost: 行.allocated_cost,
    freight_manual: 行.freight_manual ?? false,
    batch_no: 行.batch_no,
    warehouse_id: 行.warehouse_id,
    location: 行.location,
    notes: 行.notes,
  }));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href="/inbound-orders" className="text-sm text-blue-600 hover:text-blue-700">
          ← 返回入库单列表
        </Link>
        <div className="flex items-center gap-2">
          <InboundBarcodePrint items={条码行们} />
          <PrintButton />
        </div>
      </div>

      {/* 打印专用页头：确认单/正式单标题区分（确认前打印的对货单不会误当正式单） */}
      <div className="hidden print:block text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{是确认单 ? "入库确认单（待确认）" : "入库单"}</h1>
        <p className="text-sm text-gray-500 mt-1">{inboundOrder.inbound_no}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6 print:border-black print:rounded-none">
        <div className="px-6 py-4 border-b border-gray-100 print:border-black">
          <h1 className="text-lg font-bold text-gray-900 print:hidden">
            {是确认单 ? "入库确认单（待确认）" : "入库单详情"}
          </h1>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-500">入库单号</div>
            <div className="font-medium text-gray-900">{inboundOrder.inbound_no}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">关联采购单</div>
            <div className="font-medium text-gray-900">
              {inboundOrder.purchase_orders ? (
                <Link
                  href={`/procurement/${inboundOrder.purchase_orders.id}`}
                  className="text-blue-600 hover:text-blue-700"
                >
                  {inboundOrder.purchase_orders.order_no || inboundOrder.purchase_orders.id.slice(0, 8)}
                </Link>
              ) : (
                "-"
              )}
            </div>
          </div>
          {inboundOrder.receiving_batches?.batch_no && (
            <div>
              <div className="text-xs text-gray-500">收货批次</div>
              <div className="font-medium text-gray-900">{inboundOrder.receiving_batches.batch_no}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-gray-500">供应商</div>
            <div className="font-medium text-gray-900">{inboundOrder.supplier_name || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">状态</div>
            <div className="font-medium text-gray-900">
              {是确认单 ? (
                <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">待确认</span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">已完成</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">总数量</div>
            <div className="font-medium text-gray-900">{inboundOrder.total_quantity}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">总金额</div>
            <div className="font-medium text-gray-900">
              {inboundOrder.total_amount != null ? `¥${inboundOrder.total_amount.toFixed(2)}` : "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">运费</div>
            <div className="font-medium text-gray-900">
              {inboundOrder.freight_amount != null ? `¥${inboundOrder.freight_amount.toFixed(2)}` : "-"}
            </div>
          </div>
          {inboundOrder.supplier_order_no && (
            <div>
              <div className="text-xs text-gray-500">销售单号</div>
              <div className="font-medium text-gray-900">{inboundOrder.supplier_order_no}</div>
            </div>
          )}
          {inboundOrder.supplier_order_amount != null && (
            <div>
              <div className="text-xs text-gray-500">销售单总金额</div>
              <div className="font-medium text-gray-900">¥{inboundOrder.supplier_order_amount.toFixed(2)}</div>
            </div>
          )}
          {(inboundOrder.discount_amount ?? 0) > 0 && (
            <div>
              <div className="text-xs text-gray-500">优惠抹零</div>
              <div className="font-medium text-gray-900">¥{inboundOrder.discount_amount!.toFixed(2)}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-gray-500">操作人</div>
            <div className="font-medium text-gray-900">{inboundOrder.profiles?.full_name || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">日期</div>
            <div className="font-medium text-gray-900">
              {new Date(inboundOrder.created_at).toLocaleString("zh-CN")}
            </div>
          </div>
          {inboundOrder.notes && (
            <div className="col-span-2 md:col-span-4">
              <div className="text-xs text-gray-500">备注</div>
              <div className="font-medium text-gray-900">{inboundOrder.notes}</div>
            </div>
          )}
        </div>
      </div>

      {/* draft：渲染编辑器（打印时隐藏，打印件走下方只读表）；completed：只读明细表 */}
      {是确认单 ? (
        <>
          <InboundDraftEditor
            单头={{
              id: inboundOrder.id,
              inbound_no: inboundOrder.inbound_no,
              receiving_batch_id: inboundOrder.receiving_batch_id,
              purchase_order_id: inboundOrder.purchase_order_id,
              freight_amount: inboundOrder.freight_amount,
              discount_amount: inboundOrder.discount_amount,
              supplier_order_no: inboundOrder.supplier_order_no,
              supplier_order_amount: inboundOrder.supplier_order_amount,
              waybill_id: inboundOrder.waybill_id,
            }}
            明细={编辑行们}
            仓库列表={仓库列表}
            运单列表={运单列表}
          />
          {/* 打印用只读明细（编辑器 print:hidden，打印件从这里出） */}
          <div className="hidden print:block">
            <入库明细只读表 inboundItems={inboundItems} />
          </div>
        </>
      ) : (
        <入库明细只读表 inboundItems={inboundItems} />
      )}

      {/* 打印专用签字栏 */}
      <div className="hidden print:block mt-8 pt-8 border-t border-black">
        <div className="grid grid-cols-3 gap-8 text-sm">
          <div>
            <div className="text-gray-500 mb-8">收货人签字：</div>
            <div className="border-b border-gray-400 h-6"></div>
          </div>
          <div>
            <div className="text-gray-500 mb-8">验收人签字：</div>
            <div className="border-b border-gray-400 h-6"></div>
          </div>
          <div>
            <div className="text-gray-500 mb-8">日期：</div>
            <div className="border-b border-gray-400 h-6"></div>
          </div>
        </div>
      </div>

      {inventoryLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-6 print:hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-900">库存变动记录</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 w-10">序号</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">配件名称</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">变动数量</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">类型</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inventoryLogs.map((log, idx) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-500">{idx + 1}</td>
                    <td className="px-6 py-4 text-gray-900">{log.parts?.name || "-"}</td>
                    <td className="px-6 py-4 text-right text-gray-900 font-medium">
                      {log.change_qty > 0 ? `+${log.change_qty}` : log.change_qty}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{log.type}</td>
                    <td className="px-6 py-4 text-gray-600">{log.notes || "-"}</td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(log.created_at).toLocaleString("zh-CN")}
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

/* 只读入库明细表（completed 页面主体 + draft 的打印件）：
   子组件定义在页面组件外部，遵守「禁止组件内定义组件」规范 */
function 入库明细只读表({ inboundItems }: { inboundItems: InboundOrderItem[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden print:border-black print:rounded-none">
      <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 print:hidden">
        <h3 className="text-sm font-semibold text-gray-900">入库明细</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-gray-500 w-10">序号</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">商品名称</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">零件编码</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">品牌</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">规格</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">数量</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">单位</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">单价</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">分摊运费</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">成本价</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">批次号</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">仓库</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">仓位</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {inboundItems.map((it, idx) => {
              const unitCost = it.unit_cost || 0;
              const allocCost = it.allocated_cost || 0;
              const finalCost = unitCost + allocCost;
              return (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-gray-500">{idx + 1}</td>
                  <td className="px-6 py-4 text-gray-900 font-medium">{it.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.part_number || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.brand || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.specification || "-"}</td>
                  <td className="px-6 py-4 text-right text-gray-900">{it.quantity}</td>
                  <td className="px-6 py-4 text-gray-600">{it.unit || "-"}</td>
                  <td className="px-6 py-4 text-right text-gray-900">
                    {it.unit_cost != null ? `¥${it.unit_cost.toFixed(2)}` : "-"}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-600">
                    {allocCost > 0 ? `¥${allocCost.toFixed(2)}` : "-"}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-900 font-medium">
                    {finalCost > 0 ? `¥${finalCost.toFixed(2)}` : "-"}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{it.batch_no || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.warehouses?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.location || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.notes || "-"}</td>
                </tr>
              );
            })}
            {inboundItems.length === 0 && (
              <tr>
                <td colSpan={14} className="px-6 py-8 text-center text-gray-400">
                  暂无入库明细
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
