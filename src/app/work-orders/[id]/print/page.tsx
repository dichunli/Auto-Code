import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Barcode } from "@/components/Barcode";

const DOC_TITLES: Record<string, string> = {
  reception: "接车单",
  dispatch: "派工单",
  picking: "领料单",
  return: "退料单",
  settlement: "结算单",
  reimbursement: "报销单",
};

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ type?: string }>;
}) {
  const { id } = await params;
  const { type = "reception" } = (await searchParams) || {};
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("work_orders")
    .select("*, vehicles(*, vehicle_models(*)), customers(*), profiles!work_orders_receptionist_id_fkey(full_name)")
    .eq("id", id)
    .single();

  if (!order) notFound();

  const title = DOC_TITLES[type] || "工单打印";

  return (
    <div className="max-w-[210mm] mx-auto bg-white">
      {/* 打印工具栏（仅屏幕显示） */}
      <div className="no-print flex items-center justify-between p-4 border-b border-gray-200 mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900">{title}</h1>
          <span className="text-sm text-gray-500">{order.order_no}</span>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/work-orders/${id}?print=${type}`}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            刷新
          </Link>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            打印
          </button>
          <Link
            href={`/work-orders/${id}`}
            className="px-3 py-1.5 text-sm bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            返回
          </Link>
        </div>
      </div>

      {/* 单据内容 */}
      <div className="p-8 print:p-0">
        {type === "reception" && <ReceptionDoc order={order} />}
        {type === "dispatch" && <DispatchDoc order={order} />}
        {type === "picking" && <PickingDoc order={order} />}
        {type === "return" && <ReturnDoc order={order} />}
        {type === "settlement" && <SettlementDoc order={order} />}
        {type === "reimbursement" && <ReimbursementDoc order={order} />}
      </div>
    </div>
  );
}

/* ============================================================
   接车单
   ============================================================ */
async function ReceptionDoc({ order }: { order: any }) {
  const supabase = await createClient();

  const { data: inspections } = await supabase
    .from("work_order_inspections")
    .select("*, work_order_inspection_media(*)")
    .eq("work_order_id", order.id)
    .eq("inspection_type", "reception")
    .order("created_at", { ascending: false });

  const inspection = inspections?.[0];

  return (
    <div className="space-y-6">
      <div className="text-center border-b-2 border-gray-900 pb-4">
        <h2 className="text-2xl font-bold tracking-widest">接 车 单</h2>
        <div className="mt-2 flex flex-col items-center">
          <Barcode value={order.order_no} height={40} fontSize={12} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div><span className="text-gray-500">客户姓名：</span>{order.customers?.name || "-"}</div>
        <div><span className="text-gray-500">联系电话：</span>{order.customers?.phone || "-"}</div>
        <div><span className="text-gray-500">车牌号码：</span>{order.vehicles?.plate_number || "-"}</div>
        <div><span className="text-gray-500">车辆品牌：</span>{order.vehicles?.brand} {order.vehicles?.model}</div>
        <div><span className="text-gray-500">VIN码：</span>{order.vehicles?.vin || "-"}</div>
        <div><span className="text-gray-500">行驶里程：</span>{order.mileage_in} km</div>
        <div><span className="text-gray-500">油量：</span>{order.fuel_level}%</div>
        <div><span className="text-gray-500">接车时间：</span>{formatDate(order.received_at)}</div>
        <div><span className="text-gray-500">接待人员：</span>{order.profiles?.full_name || "-"}</div>
      </div>

      <div className="border-t border-gray-300 pt-4">
        <h3 className="font-bold text-sm mb-2">客户描述/故障现象</h3>
        <div className="text-sm border border-gray-300 rounded p-3 min-h-[80px]">
          {order.customer_complaint || "-"}
        </div>
      </div>

      {inspection?.notes && (
        <div className="border-t border-gray-300 pt-4">
          <h3 className="font-bold text-sm mb-2">接车检查备注</h3>
          <div className="text-sm border border-gray-300 rounded p-3">{inspection.notes}</div>
        </div>
      )}

      <div className="border-t border-gray-300 pt-6">
        <div className="grid grid-cols-2 gap-8 text-sm">
          <div>
            <p className="mb-8">客户签字：</p>
            <p>日期：______年____月____日</p>
          </div>
          <div>
            <p className="mb-8">接车员签字：</p>
            <p>日期：______年____月____日</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   派工单
   ============================================================ */
async function DispatchDoc({ order }: { order: any }) {
  const supabase = await createClient();

  const { data: requirements } = await supabase
    .from("work_order_requirements")
    .select("*, submitted_by_profile:profiles!work_order_requirements_submitted_by_fkey(full_name), assigned_to_profile:profiles!work_order_requirements_assigned_to_fkey(full_name)")
    .eq("work_order_id", order.id)
    .order("seq", { ascending: true });

  const { data: items } = await supabase
    .from("work_order_items")
    .select("*, profiles!work_order_items_mechanic_id_fkey(full_name)")
    .eq("work_order_id", order.id)
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div className="text-center border-b-2 border-gray-900 pb-4">
        <h2 className="text-2xl font-bold tracking-widest">派 工 单</h2>
        <div className="mt-2 flex flex-col items-center">
          <Barcode value={order.order_no} height={40} fontSize={12} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div><span className="text-gray-500">车牌号码：</span>{order.vehicles?.plate_number || "-"}</div>
        <div><span className="text-gray-500">车辆品牌：</span>{order.vehicles?.brand} {order.vehicles?.model}</div>
        <div><span className="text-gray-500">客户姓名：</span>{order.customers?.name || "-"}</div>
        <div><span className="text-gray-500">联系电话：</span>{order.customers?.phone || "-"}</div>
        <div><span className="text-gray-500">接车时间：</span>{formatDate(order.received_at)}</div>
        <div><span className="text-gray-500">派工时间：</span>{formatDate(new Date().toISOString())}</div>
      </div>

      <div className="border-t border-gray-300 pt-4">
        <h3 className="font-bold text-sm mb-2">客户需求与诊断</h3>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-900">
              <th className="text-left py-2 px-2 w-12">序号</th>
              <th className="text-left py-2 px-2">需求描述</th>
              <th className="text-left py-2 px-2">诊断结果</th>
              <th className="text-left py-2 px-2 w-24">指派技师</th>
            </tr>
          </thead>
          <tbody>
            {requirements?.map((req: any) => (
              <tr key={req.id} className="border-b border-gray-200">
                <td className="py-2 px-2">{req.seq}</td>
                <td className="py-2 px-2">{req.description}</td>
                <td className="py-2 px-2">{req.diagnosis || "-"}</td>
                <td className="py-2 px-2">{req.assigned_to_profile?.full_name || "-"}</td>
              </tr>
            ))}
            {(!requirements || requirements.length === 0) && (
              <tr><td colSpan={4} className="py-4 text-center text-gray-400">暂无需求记录</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-gray-300 pt-4">
        <h3 className="font-bold text-sm mb-2">维修项目</h3>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-900">
              <th className="text-left py-2 px-2">项目名称</th>
              <th className="text-left py-2 px-2 w-16">类型</th>
              <th className="text-left py-2 px-2 w-16">数量</th>
              <th className="text-left py-2 px-2 w-20">单价</th>
              <th className="text-left py-2 px-2 w-20">金额</th>
              <th className="text-left py-2 px-2 w-20">技师</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((item: any) => (
              <tr key={item.id} className="border-b border-gray-200">
                <td className="py-2 px-2">{item.alias_name || item.name}</td>
                <td className="py-2 px-2">{item.item_type === "labor" ? "工时" : item.item_type === "part" ? "配件" : "其他"}</td>
                <td className="py-2 px-2">{item.quantity}</td>
                <td className="py-2 px-2">{formatCurrency(item.unit_price)}</td>
                <td className="py-2 px-2">{formatCurrency(item.total_price)}</td>
                <td className="py-2 px-2">{item.profiles?.full_name || "-"}</td>
              </tr>
            ))}
            {(!items || items.length === 0) && (
              <tr><td colSpan={6} className="py-4 text-center text-gray-400">暂无维修项目</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-gray-300 pt-6">
        <div className="grid grid-cols-3 gap-8 text-sm">
          <div><p className="mb-8">派工人签字：</p><p>日期：______年____月____日</p></div>
          <div><p className="mb-8">施工技师签字：</p><p>日期：______年____月____日</p></div>
          <div><p className="mb-8">完工确认：</p><p>日期：______年____月____日</p></div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   领料单
   ============================================================ */
async function PickingDoc({ order }: { order: any }) {
  const supabase = await createClient();

  const { data: itemParts } = await supabase
    .from("work_order_item_parts")
    .select("*, part_names(name, unit), parts(*, part_brands(name))")
    .eq("work_order_id", order.id)
    .eq("status", "out");

  const partIds = itemParts?.map((p: any) => p.id) || [];

  const { data: pickingRecords } = partIds.length > 0
    ? await supabase
        .from("part_picking_records")
        .select("*, profiles(full_name)")
        .in("work_order_item_part_id", partIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  const pickingByPart: Record<string, any[]> = {};
  pickingRecords?.forEach((r: any) => {
    if (!pickingByPart[r.work_order_item_part_id]) pickingByPart[r.work_order_item_part_id] = [];
    pickingByPart[r.work_order_item_part_id].push(r);
  });

  return (
    <div className="space-y-6">
      <div className="text-center border-b-2 border-gray-900 pb-4">
        <h2 className="text-2xl font-bold tracking-widest">领 料 单</h2>
        <p className="text-sm text-gray-500 mt-1">{order.order_no}</p>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div><span className="text-gray-500">车牌号码：</span>{order.vehicles?.plate_number || "-"}</div>
        <div><span className="text-gray-500">车辆品牌：</span>{order.vehicles?.brand} {order.vehicles?.model}</div>
        <div><span className="text-gray-500">工单号：</span>{order.order_no}</div>
        <div><span className="text-gray-500">打印时间：</span>{formatDate(new Date().toISOString())}</div>
      </div>

      <div className="border-t border-gray-300 pt-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-900">
              <th className="text-left py-2 px-2 w-10">序号</th>
              <th className="text-left py-2 px-2">配件名称</th>
              <th className="text-left py-2 px-2 w-16">品牌</th>
              <th className="text-left py-2 px-2 w-12">单位</th>
              <th className="text-left py-2 px-2 w-14">数量</th>
              <th className="text-left py-2 px-2 w-24">领料时间</th>
              <th className="text-left py-2 px-2 w-20">领料人</th>
            </tr>
          </thead>
          <tbody>
            {itemParts?.flatMap((p: any, idx: number) => {
              const pickings = pickingByPart[p.id] || [];
              if (pickings.length === 0) {
                return [
                  <tr key={p.id} className="border-b border-gray-200">
                    <td className="py-2 px-2">{idx + 1}</td>
                    <td className="py-2 px-2">{p.alias_name || p.parts?.name || p.name || p.part_names?.name || "-"}</td>
                    <td className="py-2 px-2">{p.parts?.part_brands?.name || p.brand || "-"}</td>
                    <td className="py-2 px-2">{p.parts?.unit || p.part_names?.unit || "-"}</td>
                    <td className="py-2 px-2">{p.quantity}</td>
                    <td className="py-2 px-2 text-gray-400">-</td>
                    <td className="py-2 px-2 text-gray-400">-</td>
                  </tr>
                ];
              }
              return pickings.map((pk: any, pIdx: number) => (
                <tr key={`${p.id}-${pk.id}`} className="border-b border-gray-200">
                  <td className="py-2 px-2">{idx + 1}{pIdx > 0 ? "-" + (pIdx + 1) : ""}</td>
                  <td className="py-2 px-2">{p.alias_name || p.parts?.name || p.name || p.part_names?.name || "-"}</td>
                  <td className="py-2 px-2">{p.parts?.part_brands?.name || p.brand || "-"}</td>
                  <td className="py-2 px-2">{p.parts?.unit || p.part_names?.unit || "-"}</td>
                  <td className="py-2 px-2">{pk.quantity}</td>
                  <td className="py-2 px-2">{formatDate(pk.created_at)}</td>
                  <td className="py-2 px-2">{pk.profiles?.full_name || "-"}</td>
                </tr>
              ));
            })}
            {(!itemParts || itemParts.length === 0) && (
              <tr><td colSpan={7} className="py-4 text-center text-gray-400">暂无领料记录</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 配件条码 */}
      {itemParts && itemParts.length > 0 && (
        <div className="border-t border-gray-300 pt-4">
          <h3 className="font-bold text-sm mb-3">配件条码</h3>
          <div className="grid grid-cols-2 gap-4">
            {itemParts.map((p: any, idx: number) => {
              const code = p.parts?.barcode || p.parts?.part_number || "";
              return (
                <div key={p.id} className="border border-gray-200 rounded p-3 text-center">
                  <div className="text-xs text-gray-500 mb-1">
                    {idx + 1}. {p.alias_name || p.parts?.name || p.name || p.part_names?.name || "-"}
                    {p.parts?.part_brands?.name || p.brand ? ` (${p.parts?.part_brands?.name || p.brand})` : ""}
                  </div>
                  {code ? (
                    <Barcode value={code} height={30} fontSize={10} width={1.5} />
                  ) : (
                    <div className="text-xs text-gray-400 py-2">无条码</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-t border-gray-300 pt-6">
        <div className="grid grid-cols-3 gap-8 text-sm">
          <div><p className="mb-8">领料人签字：</p><p>日期：______年____月____日</p></div>
          <div><p className="mb-8">发料人签字：</p><p>日期：______年____月____日</p></div>
          <div><p className="mb-8">审批人签字：</p><p>日期：______年____月____日</p></div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   退料单
   ============================================================ */
async function ReturnDoc({ order }: { order: any }) {
  const supabase = await createClient();

  const { data: returnRecords } = await supabase
    .from("part_return_records")
    .select("*, part_picking_records(work_order_item_part_id, profiles(full_name)), work_order_item_parts(name, part_names(name, unit), parts(*, part_brands(name)))")
    .eq("work_order_item_parts.work_order_id", order.id)
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div className="text-center border-b-2 border-gray-900 pb-4">
        <h2 className="text-2xl font-bold tracking-widest">退 料 单</h2>
        <p className="text-sm text-gray-500 mt-1">{order.order_no}</p>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div><span className="text-gray-500">车牌号码：</span>{order.vehicles?.plate_number || "-"}</div>
        <div><span className="text-gray-500">车辆品牌：</span>{order.vehicles?.brand} {order.vehicles?.model}</div>
        <div><span className="text-gray-500">工单号：</span>{order.order_no}</div>
        <div><span className="text-gray-500">打印时间：</span>{formatDate(new Date().toISOString())}</div>
      </div>

      <div className="border-t border-gray-300 pt-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-900">
              <th className="text-left py-2 px-2 w-10">序号</th>
              <th className="text-left py-2 px-2">配件名称</th>
              <th className="text-left py-2 px-2 w-16">品牌</th>
              <th className="text-left py-2 px-2 w-12">单位</th>
              <th className="text-left py-2 px-2 w-14">数量</th>
              <th className="text-left py-2 px-2 w-24">退料时间</th>
              <th className="text-left py-2 px-2 w-20">退料人</th>
              <th className="text-left py-2 px-2 w-24">退料原因</th>
            </tr>
          </thead>
          <tbody>
            {returnRecords?.map((r: any, idx: number) => {
              const p = r.work_order_item_parts;
              return (
                <tr key={r.id} className="border-b border-gray-200">
                  <td className="py-2 px-2">{idx + 1}</td>
                  <td className="py-2 px-2">{p?.alias_name || p?.parts?.name || p?.name || p?.part_names?.name || "-"}</td>
                  <td className="py-2 px-2">{p?.parts?.part_brands?.name || p?.brand || "-"}</td>
                  <td className="py-2 px-2">{p?.parts?.unit || p?.part_names?.unit || "-"}</td>
                  <td className="py-2 px-2">{r.quantity}</td>
                  <td className="py-2 px-2">{formatDate(r.created_at)}</td>
                  <td className="py-2 px-2">{r.part_picking_records?.profiles?.full_name || "-"}</td>
                  <td className="py-2 px-2">{r.reason || "-"}</td>
                </tr>
              );
            })}
            {(!returnRecords || returnRecords.length === 0) && (
              <tr><td colSpan={8} className="py-4 text-center text-gray-400">暂无退料记录</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 配件条码 */}
      {returnRecords && returnRecords.length > 0 && (
        <div className="border-t border-gray-300 pt-4">
          <h3 className="font-bold text-sm mb-3">配件条码</h3>
          <div className="grid grid-cols-2 gap-4">
            {returnRecords.map((r: any, idx: number) => {
              const p = r.work_order_item_parts;
              const code = p?.parts?.barcode || p?.parts?.part_number || "";
              return (
                <div key={r.id} className="border border-gray-200 rounded p-3 text-center">
                  <div className="text-xs text-gray-500 mb-1">
                    {idx + 1}. {p?.alias_name || p?.parts?.name || p?.name || p?.part_names?.name || "-"}
                    {p?.parts?.part_brands?.name || p?.brand ? ` (${p?.parts?.part_brands?.name || p?.brand})` : ""}
                  </div>
                  {code ? (
                    <Barcode value={code} height={30} fontSize={10} width={1.5} />
                  ) : (
                    <div className="text-xs text-gray-400 py-2">无条码</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-t border-gray-300 pt-6">
        <div className="grid grid-cols-3 gap-8 text-sm">
          <div><p className="mb-8">退料人签字：</p><p>日期：______年____月____日</p></div>
          <div><p className="mb-8">收料人签字：</p><p>日期：______年____月____日</p></div>
          <div><p className="mb-8">审批人签字：</p><p>日期：______年____月____日</p></div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   结算单
   ============================================================ */
async function SettlementDoc({ order }: { order: any }) {
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("work_order_items")
    .select("name, alias_name, item_type, quantity, unit_price, total_price, business_type")
    .eq("work_order_id", order.id)
    .order("created_at", { ascending: true });

  const { data: payments } = await supabase
    .from("payments")
    .select("method, amount, paid_at")
    .eq("work_order_id", order.id)
    .order("paid_at", { ascending: true });

  const { data: memberTxs } = await supabase
    .from("member_transactions")
    .select("amount, members(card_no, name)")
    .eq("work_order_id", order.id)
    .eq("type", "consume");

  const { data: advancePaymentRecords } = await supabase
    .from("advance_payment_records")
    .select("*, profiles(full_name)")
    .eq("work_order_id", order.id)
    .order("paid_at", { ascending: true });

  const methodLabels: Record<string, string> = {
    cash: "现金", wechat: "微信支付", alipay: "支付宝",
    credit: "挂账", member: "会员/储值卡", bank_transfer: "银行转账",
  };

  const advancePaymentTotal = (advancePaymentRecords || []).reduce((sum, r) => sum + (r.amount || 0), 0);
  const totalPaid = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="text-center border-b-2 border-gray-900 pb-4">
        <h2 className="text-2xl font-bold tracking-widest">结 算 单</h2>
        <div className="mt-2 flex flex-col items-center">
          <Barcode value={order.order_no} height={40} fontSize={12} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div><span className="text-gray-500">客户姓名：</span>{order.customers?.name || "-"}</div>
        <div><span className="text-gray-500">联系电话：</span>{order.customers?.phone || "-"}</div>
        <div><span className="text-gray-500">车牌号码：</span>{order.vehicles?.plate_number || "-"}</div>
        <div><span className="text-gray-500">车辆品牌：</span>{order.vehicles?.brand} {order.vehicles?.model}</div>
        <div><span className="text-gray-500">结算时间：</span>{formatDate(order.settled_at)}</div>
        <div><span className="text-gray-500">打印时间：</span>{formatDate(new Date().toISOString())}</div>
      </div>

      <div className="border-t border-gray-300 pt-4">
        <h3 className="font-bold text-sm mb-2">费用明细</h3>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-900">
              <th className="text-left py-2 px-2 w-10">序号</th>
              <th className="text-left py-2 px-2">项目/配件名称</th>
              <th className="text-left py-2 px-2 w-16">类型</th>
              <th className="text-left py-2 px-2 w-12">数量</th>
              <th className="text-left py-2 px-2 w-20">单价</th>
              <th className="text-left py-2 px-2 w-20">金额</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((item: any, idx: number) => (
              <tr key={idx} className="border-b border-gray-200">
                <td className="py-2 px-2">{idx + 1}</td>
                <td className="py-2 px-2">{item.alias_name || item.name}</td>
                <td className="py-2 px-2">{item.item_type === "labor" ? "工时" : item.item_type === "part" ? "配件" : "其他"}</td>
                <td className="py-2 px-2">{item.quantity}</td>
                <td className="py-2 px-2">{formatCurrency(item.unit_price)}</td>
                <td className="py-2 px-2">{formatCurrency(item.total_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-gray-300 pt-4 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-gray-500">配件费用</span><span>{formatCurrency(order.parts_cost)}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">工时费用</span><span>{formatCurrency(order.labor_cost)}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">其他费用</span><span>{formatCurrency(order.other_cost)}</span></div>
        {(order.discount_amount || 0) > 0 && (
          <div className="flex justify-between text-orange-600"><span>整单优惠</span><span>-{formatCurrency(order.discount_amount)}</span></div>
        )}
        {(advancePaymentTotal || 0) > 0 && (
          <div className="flex justify-between text-green-600"><span>预收款抵扣</span><span>-{formatCurrency(advancePaymentTotal)}</span></div>
        )}
        <div className="flex justify-between text-base font-bold border-t border-gray-300 pt-2 mt-2">
          <span>应收合计</span><span>{formatCurrency(order.total_cost - advancePaymentTotal)}</span>
        </div>
      </div>

      {advancePaymentRecords && advancePaymentRecords.length > 0 && (
        <div className="border-t border-gray-300 pt-4">
          <h3 className="font-bold text-sm mb-2">预收款记录</h3>
          <div className="space-y-1 text-sm">
            {advancePaymentRecords.map((r: any, idx: number) => (
              <div key={idx} className="flex justify-between">
                <span className="text-gray-500">
                  {formatDate(r.paid_at)} {methodLabels[r.method] || r.method}
                  {r.profiles?.full_name && <span className="text-gray-400 ml-1">({r.profiles.full_name})</span>}
                </span>
                <span>{formatCurrency(r.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between font-medium border-t border-gray-200 pt-1 mt-1">
              <span>预收合计</span><span className="text-green-600">{formatCurrency(advancePaymentTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {payments && payments.length > 0 && (
        <div className="border-t border-gray-300 pt-4">
          <h3 className="font-bold text-sm mb-2">支付记录</h3>
          <div className="space-y-1 text-sm">
            {payments.map((p: any, idx: number) => {
              const memberTx = p.method === "member" ? memberTxs?.find((mt: any) => Math.abs(mt.amount - p.amount) < 0.01) : null;
              return (
                <div key={idx} className="flex justify-between">
                  <span className="text-gray-500">
                    {methodLabels[p.method] || p.method}
                    {memberTx && (
                      <span className="text-gray-400 ml-1">({memberTx.members?.[0]?.card_no} {memberTx.members?.[0]?.name})</span>
                    )}
                  </span>
                  <span>{formatCurrency(p.amount)}</span>
                </div>
              );
            })}
            <div className="flex justify-between font-medium border-t border-gray-200 pt-1 mt-1">
              <span>已付合计</span><span className="text-green-600">{formatCurrency(totalPaid)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>未付金额</span><span className="text-red-600">{formatCurrency(order.total_cost - advancePaymentTotal - totalPaid)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-gray-300 pt-6">
        <div className="grid grid-cols-2 gap-8 text-sm">
          <div>
            <p className="mb-8">客户签字：</p>
            <p>日期：______年____月____日</p>
          </div>
          <div>
            <p className="mb-8">结算员签字：</p>
            <p>日期：______年____月____日</p>
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-gray-400 pt-4">
        感谢您的光临，祝您用车愉快！
      </div>
    </div>
  );
}

/* ============================================================
   报销单
   ============================================================ */
async function ReimbursementDoc({ order }: { order: any }) {
  const supabase = await createClient();

  const { data: reimbursement } = await supabase
    .from("work_order_reimbursements")
    .select("*, work_order_reimbursement_items(*)")
    .eq("work_order_id", order.id)
    .single();

  const items = (reimbursement?.work_order_reimbursement_items || [])
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const total = items.reduce((sum: number, it: any) => sum + (Number(it.total_price) || 0), 0);

  return (
    <div className="space-y-6">
      <div className="text-center border-b-2 border-gray-900 pb-4">
        <h2 className="text-2xl font-bold tracking-widest">{reimbursement?.title || "报销单"}</h2>
        <div className="mt-2 flex flex-col items-center">
          <Barcode value={order.order_no} height={40} fontSize={12} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div><span className="text-gray-500">报销单位：</span>{reimbursement?.company_name || "-"}</div>
        <div><span className="text-gray-500">车牌号码：</span>{order.vehicles?.plate_number || "-"}</div>
        <div><span className="text-gray-500">客户姓名：</span>{order.customers?.name || "-"}</div>
        <div><span className="text-gray-500">联系电话：</span>{order.customers?.phone || "-"}</div>
        <div><span className="text-gray-500">车辆品牌：</span>{order.vehicles?.brand} {order.vehicles?.model}</div>
        <div><span className="text-gray-500">打印时间：</span>{formatDate(new Date().toISOString())}</div>
      </div>

      <div className="border-t border-gray-300 pt-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-900">
              <th className="text-left py-2 px-2 w-10">序号</th>
              <th className="text-left py-2 px-2">项目名称</th>
              <th className="text-left py-2 px-2 w-24">规格</th>
              <th className="text-left py-2 px-2 w-12">数量</th>
              <th className="text-left py-2 px-2 w-20">单价</th>
              <th className="text-left py-2 px-2 w-20">金额</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, idx: number) => (
              <tr key={it.id} className="border-b border-gray-200">
                <td className="py-2 px-2">{idx + 1}</td>
                <td className="py-2 px-2">{it.name}</td>
                <td className="py-2 px-2">{it.spec || "-"}</td>
                <td className="py-2 px-2">{it.quantity}</td>
                <td className="py-2 px-2">{formatCurrency(it.unit_price)}</td>
                <td className="py-2 px-2">{formatCurrency(it.total_price)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-gray-400">暂无项目</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-900">
              <td colSpan={5} className="py-2 px-2 text-right font-medium">合计</td>
              <td className="py-2 px-2 font-bold">{formatCurrency(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {reimbursement?.notes && (
        <div className="border-t border-gray-300 pt-4">
          <h3 className="font-bold text-sm mb-2">备注</h3>
          <div className="text-sm border border-gray-300 rounded p-3">{reimbursement.notes}</div>
        </div>
      )}

      <div className="border-t border-gray-300 pt-6">
        <div className="grid grid-cols-3 gap-8 text-sm">
          <div><p className="mb-8">经办人签字：</p><p>日期：______年____月____日</p></div>
          <div><p className="mb-8">审核人签字：</p><p>日期：______年____月____日</p></div>
          <div><p className="mb-8">报销人签字：</p><p>日期：______年____月____日</p></div>
        </div>
      </div>
    </div>
  );
}
