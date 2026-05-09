import { getWorkOrderData } from "@/lib/workOrderData";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { calculateItemCommission, calculatePartCommission } from "@/lib/commission";
import { getPartWorkflowStatus } from "@/lib/partWorkflow";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BatchEditWrapper } from "@/components/BatchEditWrapper";
import { TemplateImportWrapper } from "@/components/TemplateImportWrapper";
import { PartWorkflowActions } from "@/components/PartWorkflowActions";
import { ConstructionControls } from "@/components/ConstructionControls";
import { WorkOrderItemActions } from "@/components/WorkOrderItemActions";
import { ItemPersonSelectors } from "@/components/ItemPersonSelectors";
import { CustomerOpinionToggle } from "@/components/CustomerOpinionToggle";
import { ItemFlagsToggle } from "@/components/ItemFlagsToggle";
import { ItemMechanicAssigner } from "@/components/ItemMechanicAssigner";
import { WorkOrderActions } from "@/components/WorkOrderActions";
import { AdvancePaymentCard } from "@/components/AdvancePaymentCard";
import WorkOrderActionButtons from "@/components/WorkOrderActionButtons";
import RequirementActions from "@/components/RequirementActions";
import WorkOrderFloatingSidebar from "@/components/WorkOrderFloatingSidebar";
import { ItemNotesEditor } from "@/components/ItemNotesEditor";
import AddItemPartButton from "@/components/AddItemPartButton";
import PartBranchEditor from "@/components/PartBranchEditor";
import PartGroupHeader from "@/components/PartGroupHeader";
import { WorkOrderToggleProvider, ShowCommission, ShowTimer } from "@/components/WorkOrderToggleContext";
import { WorkOrderToggleBar } from "@/components/WorkOrderToggleBar";
import PrintDropdown from "@/components/PrintDropdown";
import AdvancePaymentDropdown from "@/components/AdvancePaymentDropdown";
import ItemSubtotalDisplay from "@/components/ItemSubtotalDisplay";
import WorkOrderTotalFooter from "@/components/WorkOrderTotalFooter";
import SortableList from "@/components/SortableList";
import ItemImageUploader from "@/components/ItemImageUploader";

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const {
    order, requirements, profiles, requirementMedia, items, itemsError,
    itemMedia, itemMechanics, mechanicGroups, knowledgeLinks, itemParts,
    partMedia, pickingRecords, returnRecords, supplierReturnRecords, partBatches,
    qualityChecks, payments, advancePaymentRecords, followUps, history, suppliers, logisticsCompanies,
    inspections, inspectionMedia,
  } = await getWorkOrderData(id);

  console.log("[DEBUG] work order id:", id, "order:", order ? "found" : "null", "itemsError:", itemsError);

  if (!order) notFound();

  // 预收款总额（从记录表实时计算）
  const advancePaymentTotal = (advancePaymentRecords || []).reduce((sum: number, r: any) => sum + (r.amount || 0), 0);

  // 工单车型ID（用于配件库存匹配）
  const vehicleModelId = order?.vehicles?.vehicle_model_id;

  // 查询该车历史维修工单数量（排除当前工单）
  const supabaseServer = await createClient();
  const { count: historyOrderCount } = await supabaseServer
    .from("work_orders")
    .select("*", { count: "exact", head: true })
    .eq("vehicle_id", order.vehicle_id)
    .neq("id", id);

  // 查询未关联具体配件但已到货的分支，用于入库自动填写
  const pendingInboundParts = itemParts?.filter((p: any) => p.is_arrived && !p.part_id) || [];

  // 按项目分组施工人
  const mechanicsByItem: Record<string, any[]> = {};
  if (itemMechanics) {
    for (const m of itemMechanics) {
      const itemId = m.work_order_item_id;
      if (!mechanicsByItem[itemId]) mechanicsByItem[itemId] = [];
      mechanicsByItem[itemId].push(m);
    }
  }

  // 按项目分组配件，并按 sort_order 排序
  const partsByItem: Record<string, any[]> = {};
  itemParts?.forEach((p: any) => {
    if (!partsByItem[p.work_order_item_id]) partsByItem[p.work_order_item_id] = [];
    partsByItem[p.work_order_item_id].push(p);
  });
  Object.values(partsByItem).forEach((arr) => {
    arr.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
  });

  // items 按 sort_order 排序（兼容未执行迁移的情况）
  const sortedItems = (items || []).slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

  // 按需求分组多媒体
  const mediaByRequirement: Record<string, any[]> = {};
  requirementMedia?.forEach((m: any) => {
    if (!mediaByRequirement[m.requirement_id]) mediaByRequirement[m.requirement_id] = [];
    mediaByRequirement[m.requirement_id].push(m);
  });

  // 按项目分组图片
  const imagesByItem: Record<string, any[]> = {};
  itemMedia?.forEach((m: any) => {
    if (!imagesByItem[m.work_order_item_id]) imagesByItem[m.work_order_item_id] = [];
    imagesByItem[m.work_order_item_id].push(m);
  });

  // 按配件分支分组图片
  const imagesByPart: Record<string, any[]> = {};
  partMedia?.forEach((m: any) => {
    if (!imagesByPart[m.work_order_item_part_id]) imagesByPart[m.work_order_item_part_id] = [];
    imagesByPart[m.work_order_item_part_id].push(m);
  });

  // 按检查记录分组媒体
  const mediaByInspection: Record<string, any[]> = {};
  inspectionMedia?.forEach((m: any) => {
    if (!mediaByInspection[m.inspection_id]) mediaByInspection[m.inspection_id] = [];
    mediaByInspection[m.inspection_id].push(m);
  });

  // 配件库存聚合
  const inventoryByPart: Record<string, number> = {};
  partBatches?.forEach((b: any) => {
    inventoryByPart[b.part_id] = (inventoryByPart[b.part_id] || 0) + b.quantity;
  });

  // 领料 / 退库 / 退货聚合
  const pickingByPart: Record<string, number> = {};
  pickingRecords?.forEach((r: any) => {
    pickingByPart[r.work_order_item_part_id] = (pickingByPart[r.work_order_item_part_id] || 0) + r.quantity;
  });

  const returnByPart: Record<string, number> = {};
  returnRecords?.forEach((r: any) => {
    returnByPart[r.work_order_item_part_id] = (returnByPart[r.work_order_item_part_id] || 0) + r.quantity;
  });

  const pendingSupplierReturnByPart: Record<string, boolean> = {};
  supplierReturnRecords?.forEach((r: any) => {
    if (r.status === "pending") pendingSupplierReturnByPart[r.work_order_item_part_id] = true;
  });

  // 按项目分组知识库文章
  const knowledgeByItem: Record<string, any[]> = {};
  knowledgeLinks?.forEach((link: any) => {
    items?.forEach((item: any) => {
      const matchItem = link.service_item_id && link.service_item_id === item.service_item_id;
      const matchName = link.service_name_id && link.service_name_id === item.service_items?.service_name_id;
      if (matchItem || matchName) {
        if (!knowledgeByItem[item.id]) knowledgeByItem[item.id] = [];
        // 去重
        if (!knowledgeByItem[item.id].find((k: any) => k.knowledge_articles?.id === link.knowledge_articles?.id)) {
          knowledgeByItem[item.id].push(link);
        }
      }
    });
  });

  const isLocked = ["pending_settlement", "settled", "delivered"].includes(order.status);

  return (
    <WorkOrderToggleProvider>
    <div className="pb-20">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link
            href="/work-orders"
            className="px-2.5 py-1 rounded-lg text-sm font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
          >
            ← 返回列表
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">工单 {order.order_no}</h1>
        </div>
        <div className="flex items-center gap-3">
          {order.vehicle_id && (
            <Link
              href={`/work-orders?vehicle_id=${order.vehicle_id}`}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              维修记录{historyOrderCount ? `(${historyOrderCount})` : ""}
            </Link>
          )}
          <WorkOrderActionButtons
            workOrderId={id}
            orderNo={order.order_no}
          />
          <WorkOrderToggleBar />
          <AdvancePaymentDropdown
            orderId={id}
            advancePayment={advancePaymentTotal}
            totalCost={order.total_cost || 0}
          />
          <PrintDropdown orderId={id} />
        </div>
      </div>

      <div className="space-y-4">
        {/* 主内容 */}
          {/* 基本信息 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            {/* 车牌号 / VIN / 车型 / 创建于 一行 */}
            {(() => {
              const vin: string = order.vehicles?.vin || "";
              const vinValid = /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
              const modelInfo = [order.vehicles?.brand, order.vehicles?.model].filter(Boolean).join(" ");
              return (
                <div className="flex items-center justify-between gap-6 flex-wrap mb-3 pb-3 border-b border-gray-200">
                  <div className="flex items-center gap-6 flex-wrap">
                    <div>
                      <span className="text-xs text-gray-500">车牌号: </span>
                      <span className="text-lg font-semibold text-gray-900 tracking-wide">
                        {order.vehicles?.plate_number || "-"}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">VIN: </span>
                      {vin ? (
                        <span
                          className={`inline-block w-[17ch] font-mono ${vinValid ? "text-gray-900" : "text-red-600"}`}
                          title={vinValid ? "VIN 校验通过" : "VIN 应为 17 位大写字母与数字（不含 I/O/Q）"}
                        >
                          {vin}
                          {!vinValid && (
                            <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-red-50 text-red-600">
                              格式错误
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="inline-block w-[17ch] text-gray-400">-</span>
                      )}
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">车型: </span>
                      <span className="font-medium text-gray-800">{modelInfo || "-"}</span>
                    </div>
                  </div>
                  <span className="text-sm text-gray-500 shrink-0">创建于 {formatDate(order.created_at)}</span>
                </div>
              );
            })()}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">客户:</span> <span className="font-medium">{order.customers?.name}</span></div>
              <div><span className="text-gray-500">电话:</span> {order.customers?.phone}</div>
              <div><span className="text-gray-500">接车里程:</span> {order.mileage_in} km</div>
              <div><span className="text-gray-500">油量:</span> {order.fuel_level}%</div>
            </div>
          </div>

          {/* 客户需求 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">客户需求与诊断</h2>
              <div className="flex items-center gap-3">
                {!isLocked && (
                  <>
                    <BatchEditWrapper
                      orderId={id}
                      items={items || []}
                      itemParts={itemParts || []}
                      suppliers={suppliers || []}
                      logisticsCompanies={logisticsCompanies || []}
                    />
                    {order.vehicle_id && (
                      <TemplateImportWrapper vehicleId={order.vehicle_id} orderId={id} />
                    )}
                    <Link href={`/work-orders/${id}/requirements/new`} className="text-sm text-blue-600 hover:text-blue-700">+ 添加诊断/项目</Link>
                  </>
                )}
                <Link href={`/work-orders/${id}/reception/new`} className="text-sm text-orange-600 hover:text-orange-700">+ 接车检查</Link>
                <Link href={`/work-orders/${id}/inspection/new`} className="text-sm text-green-600 hover:text-green-700">+ 车况检查</Link>
              </div>
            </div>
            <div className="divide-y divide-gray-300">
              {requirements?.map((req: any) => (
                <div key={req.id} className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-4 flex-wrap">
                        <p className="text-gray-900 font-medium"><span className="text-blue-600 mr-1">需求{req.seq}</span>{req.description}</p>
                        {/* 提交人与指派信息 */}
                        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                          <span>提交: {req.submitted_by_profile?.full_name || "-"}</span>
                          {req.dispatcher_profile && req.assignment_type === 'assigned' && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">
                              派单人: {req.dispatcher_profile.full_name}
                            </span>
                          )}
                          {req.assigned_to_profile && req.assignment_type === 'claimed' && (
                            <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                              领单人: {req.assigned_to_profile.full_name}
                            </span>
                          )}
                          {req.assigned_to_profile && req.assignment_type === 'assigned' && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                              指派给: {req.assigned_to_profile.full_name}
                            </span>
                          )}
                        </div>
                        {/* 需求操作 */}
                        {!isLocked && (
                          <div className="flex items-center gap-2">
                            <RequirementActions
                              requirement={req}
                              profiles={profiles || []}
                              orderId={id}
                            />
                            <Link
                              href={`/work-orders/${id}/requirements/new?requirement_id=${req.id}`}
                              className="text-xs text-blue-600 hover:text-blue-700"
                            >
                              + 添加项目
                            </Link>
                          </div>
                        )}
                      </div>
                      {(req.diagnosis || req.remarks) && (
                        <div className="flex items-center gap-4 flex-wrap mt-1 text-sm">
                          {req.diagnosis && (
                            <span className="text-gray-600"><span className="text-gray-400">诊断:</span> {req.diagnosis}</span>
                          )}
                          {req.remarks && (
                            <span className="text-gray-500"><span className="text-gray-400">备注:</span> {req.remarks}</span>
                          )}
                        </div>
                      )}
                      {/* 需求图片 */}
                      {mediaByRequirement[req.id]?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {mediaByRequirement[req.id].map((m: any) => (
                            <img key={m.id} src={m.storage_path} alt="" className="w-16 h-16 object-cover rounded border border-gray-200" />
                          ))}
                        </div>
                      )}
                      {/* 该需求下的项目 */}
                      {itemsError && (
                        <div className="mt-3 text-xs text-red-600 bg-red-50 rounded p-2">
                          项目加载失败: {itemsError.message}
                        </div>
                      )}
                      <div className="mt-3">
                        {(() => {
                          const reqItems = sortedItems?.filter((item: any) => item.requirement_id === req.id) || [];
                          return (
                            <SortableList
                              ids={reqItems.map((it: any) => it.id)}
                              groupKey={req.id}
                              tableName="work_order_items"
                            >
                              {reqItems.map((item: any, itemIdx: number) => (
                                <div key={item.id} className={`rounded-lg px-3 py-1 text-sm ${item.item_type === 'labor' ? 'bg-blue-50' : 'bg-gray-50'}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-gray-400 font-mono">{req.seq}.{itemIdx + 1}</span>
                                <span className="font-medium text-gray-900">{item.alias_name || item.name}</span>
                                {item.alias_name && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">别名</span>
                                )}
                                <ItemPersonSelectors
                                  itemId={item.id}
                                  submitterId={item.submitter_id}
                                  mechanicId={item.mechanic_id}
                                  inspectorId={item.inspector_id}
                                  profiles={profiles || []}
                                  mechanicGroups={(mechanicGroups || []).map((g: any) => ({ id: g.id, name: g.name, members: g.mechanic_group_members || [] }))}
                                  existingMechanics={mechanicsByItem[item.id] || []}
                                />
                                <div className="ml-6">
                                  <CustomerOpinionToggle itemId={item.id} opinion={item.customer_opinion} />
                                </div>
                                {item.business_type !== 'normal' && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    item.business_type === 'insurance' ? 'bg-purple-50 text-purple-700' :
                                    item.business_type === 'gift' ? 'bg-pink-50 text-pink-700' :
                                    'bg-orange-50 text-orange-700'
                                  }`}>
                                    {item.business_type === 'insurance' ? '保险' : item.business_type === 'gift' ? '赠送' : '返工'}
                                  </span>
                                )}
                                <div className="ml-4">
                                  <ItemFlagsToggle
                                    itemId={item.id}
                                    isOutsourced={item.is_outsourced}
                                    isCustomerPart={item.is_customer_part}
                                    serviceItemId={item.service_item_id}
                                  />
                                </div>
                                {knowledgeByItem[item.id]?.length > 0 ? (
                                  <Link
                                    href={`/knowledge/${knowledgeByItem[item.id][0].knowledge_articles.id}`}
                                    target="_blank"
                                    className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 ml-2"
                                  >
                                    维修指导
                                  </Link>
                                ) : (
                                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-400 ml-2">维修指导</span>
                                )}
                                <div className="ml-4">
                                  <ItemNotesEditor itemId={item.id} description={item.description} />
                                </div>
                                <ItemImageUploader
                                  itemId={item.id}
                                  existingImages={imagesByItem[item.id]?.map((m: any) => m.storage_path) || []}
                                  isLocked={isLocked}
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <AddItemPartButton
                                  itemId={item.id}
                                  serviceNameId={item.service_items?.service_name_id}
                                  itemName={item.alias_name || item.name}
                                />
                                <WorkOrderItemActions
                                  itemId={item.id}
                                  itemName={item.name}
                                  aliasName={item.alias_name}
                                  quantity={item.quantity}
                                  unitPrice={item.unit_price}
                                  serviceItemId={item.service_item_id}
                                />
                              </div>
                            </div>
                            {/* 返工信息 */}
                            {item.business_type === 'rework' && (
                              <div className="text-xs space-y-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded text-[10px]">
                                    返工原因: {item.rework_reason === 'part_quality' ? '配件质量' : item.rework_reason === 'workmanship' ? '施工原因' : '未指定'}
                                  </span>
                                  {item.rework_loss_amount > 0 && (
                                    <span className="text-red-600 bg-red-50 px-1.5 py-0.5 rounded text-[10px]">
                                      损失金额: {formatCurrency(item.rework_loss_amount)}
                                    </span>
                                  )}
                                  {item.rework_source_item_id && (
                                    <span className="text-gray-400">关联原始项目</span>
                                  )}
                                </div>
                              </div>
                            )}
                            {/* 项目价格 + 小计 */}
                            <ItemSubtotalDisplay
                              itemId={item.id}
                              itemTotalPrice={item.total_price || 0}
                              parts={(partsByItem[item.id] || []).map((p: any) => ({
                                id: p.id,
                                unit_price: p.unit_price || 0,
                                quantity: p.quantity || 1,
                                is_selected: p.is_selected || false,
                              }))}
                            />
                            <ShowCommission>
                              {/* 项目提成 */}
                              {(() => {
                                const comm = calculateItemCommission(
                                  item,
                                  item.service_items,
                                  item.service_items?.service_names,
                                  null,
                                  item.total_price || 0,
                                  0
                                );
                                if (comm.diagnosis === 0 && comm.repair === 0 && comm.sales === 0 && comm.qc === 0) return null;
                                return (
                                  <div className="flex flex-wrap gap-2 text-xs">
                                    <span className="text-gray-400">提成:</span>
                                    {comm.diagnosis > 0 && <span className="text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">诊断 {comm.diagnosis.toFixed(2)}元</span>}
                                    {comm.repair > 0 && <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">维修 {comm.repair.toFixed(2)}元</span>}
                                    {comm.sales > 0 && <span className="text-green-600 bg-green-50 px-1.5 py-0.5 rounded">销售 {comm.sales.toFixed(2)}元</span>}
                                    {comm.qc > 0 && <span className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">质检 {comm.qc.toFixed(2)}元</span>}
                                  </div>
                                );
                              })()}
                            </ShowCommission>
                            {/* 施工状态控制 */}
                            {item.item_type === 'labor' && !isLocked && (
                              <ShowTimer>
                                <div>
                                  <ConstructionControls
                                    itemId={item.id}
                                    workOrderId={id}
                                    customerOpinion={item.customer_opinion}
                                    itemName={item.alias_name || item.name}
                                    vehicleBrand={order.vehicles?.vehicle_models?.品牌 || order.vehicles?.brand}
                                    vehicleSeries={order.vehicles?.vehicle_models?.车系}
                                    vehicleModelName={order.vehicles?.vehicle_models?.车型 || order.vehicles?.model}
                                    vehicleDisplacement={order.vehicles?.vehicle_models?.排量}
                                    vehicleEngine={order.vehicles?.vehicle_models?.发动机型号 || order.vehicles?.engine_no}
                                    vehicleChassis={order.vehicles?.vin}
                                    vehicleTransmission={order.vehicles?.vehicle_models?.变速箱类型 || order.vehicles?.vehicle_models?.变速箱详情}
                                    mechanics={(mechanicsByItem[item.id] || []).map((m: any) => ({ mechanic_id: m.mechanic_id, full_name: m.profiles?.full_name || "-" }))}
                                  />
                                </div>
                              </ShowTimer>
                            )}
                            {/* 项目所用配件 */}
                            {partsByItem[item.id]?.length > 0 && (
                              <div className="mt-2 pt-3 border-t-2 border-dashed border-gray-400 text-xs space-y-2">
                                <div className="inline-block text-[11px] font-medium text-gray-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded mb-1">所用配件</div>
                                {(() => {
                                  const groups: Record<string, { name: string; parts: any[] }> = {};
                                  partsByItem[item.id].forEach((p: any) => {
                                    const key = p.part_name_id || `no_name_${p.id}`;
                                    if (!groups[key]) {
                                      groups[key] = { name: p.alias_name || p.parts?.name || p.name || p.part_names?.name || "未命名配件", parts: [] };
                                    }
                                    groups[key].parts.push(p);
                                  });
                                  const groupEntries = Object.entries(groups).map(([key, group]) => ({
                                    key,
                                    group,
                                    repId: group.parts[0]?.id,
                                    repSort: group.parts[0]?.sort_order || 0,
                                  })).filter((g) => g.repId).sort((a, b) => a.repSort - b.repSort);
                                  const extraIdMap: Record<string, string[]> = {};
                                  groupEntries.forEach((g) => {
                                    extraIdMap[g.repId] = g.group.parts.map((p: any) => p.id);
                                  });
                                  return (
                                    <SortableList
                                      ids={groupEntries.map((g) => g.repId)}
                                      groupKey={item.id}
                                      tableName="work_order_item_parts"
                                      extraIdMap={extraIdMap}
                                    >
                                      {groupEntries.map(({ key: nameKey, group }, groupIdx) => (
                                        <div key={nameKey} className="space-y-2">
                                      {/* 配件名称分组标题 */}
                                      {(() => {
                                        const groupImages = group.parts.flatMap((p: any) => imagesByPart[p.id] || []).map((m: any) => m.storage_path);
                                        return (
                                          <PartGroupHeader
                                            seqLabel={`${req.seq}.${itemIdx + 1}.${groupIdx + 1}`}
                                            name={group.name}
                                            parts={group.parts}
                                            isLocked={isLocked}
                                            itemId={item.id}
                                            existingImages={groupImages}
                                          />
                                        );
                                      })()}
                                      {/* 分支列表 */}
                                      <div className="space-y-2 pl-2">
                                        {group.parts.map((p: any, branchIdx: number) => {
                                          const pPickedQty = pickingByPart[p.id] || 0;
                                          const pReturnQty = returnByPart[p.id] || 0;
                                          const pNetPicked = pPickedQty - pReturnQty;
                                          const pInventory = inventoryByPart[p.part_id] || 0;
                                          const pHasPendingSupplierReturn = pendingSupplierReturnByPart[p.id] || false;
                                          const pStatus = getPartWorkflowStatus({
                                            unit_cost: p.unit_cost,
                                            unit_price: p.unit_price,
                                            customer_opinion: p.customer_opinion,
                                            is_purchased: p.is_purchased,
                                            is_arrived: p.is_arrived,
                                            part_id: p.part_id,
                                            quantity: p.quantity,
                                            inventoryQty: pInventory,
                                            pickedQty: pNetPicked,
                                            hasReturnRecords: pReturnQty > 0,
                                            hasPendingSupplierReturn: pHasPendingSupplierReturn,
                                          });
                                          return (
                                            <PartBranchEditor
                                              key={p.id}
                                              part={p}
                                              itemId={item.id}
                                              inventoryQty={pInventory}
                                              suppliers={suppliers || []}
                                              seqLabel={`${req.seq}.${itemIdx + 1}.${groupIdx + 1}.${branchIdx + 1}`}
                                              canDelete={group.parts.length > 1}
                                              siblingIds={group.parts.filter((sp: any) => sp.id !== p.id).map((sp: any) => sp.id)}
                                              vehicleModelId={vehicleModelId}
                                              isLocked={isLocked}
                                            >
                                              {/* 空分支已到货 → 入库登记 */}
                                              {p.is_arrived && !p.part_id && (
                                                <Link
                                                  href={`/inventory/in?auto_fill=1&branch_id=${p.id}&part_number=${encodeURIComponent(p.part_number || '')}&name=${encodeURIComponent(p.name || p.part_names?.name || '')}&unit=${encodeURIComponent(p.unit || p.part_names?.unit || '')}&brand=${encodeURIComponent(p.brand || '')}&specification=${encodeURIComponent(p.specification || '')}&unit_cost=${p.unit_cost || ''}&supplier=${encodeURIComponent(p.supplier_name || '')}`}
                                                  className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 inline-block"
                                                >
                                                  入库登记
                                                </Link>
                                              )}
                                              <div className="flex items-center flex-wrap gap-2">
                                                <PartWorkflowActions
                                                  status={pStatus}
                                                  partName={p.alias_name || p.parts?.name || p.name || p.part_names?.name || "未命名配件"}
                                                  workOrderItemPartId={p.id}
                                                  partId={p.part_id}
                                                  quantity={p.quantity}
                                                  pickedQty={pNetPicked}
                                                  returnQty={pReturnQty}
                                                  suppliers={suppliers || []}
                                                  logisticsCompanies={logisticsCompanies || []}
                                                  locked={isLocked}
                                                />
                                              </div>
                                              <ShowCommission>
                                                {/* 配件提成 */}
                                                {(() => {
                                                  const revenue = (p.quantity || 0) * (p.unit_price || 0);
                                                  const cost = (p.quantity || 0) * (p.unit_cost || 0);
                                                  const comm = calculatePartCommission(p.parts, p.part_names, revenue, cost);
                                                  if (comm.sales === 0 && comm.repair === 0 && comm.picking === 0 && comm.diagnosis === 0 && comm.qc === 0) return null;
                                                  return (
                                                    <div className="flex flex-wrap gap-2 text-xs">
                                                      <span className="text-gray-400">提成:</span>
                                                      {comm.sales > 0 && <span className="text-green-600 bg-green-50 px-1.5 py-0.5 rounded">销售 {comm.sales.toFixed(2)}元</span>}
                                                      {comm.repair > 0 && <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">维修 {comm.repair.toFixed(2)}元</span>}
                                                      {comm.picking > 0 && <span className="text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">领料 {comm.picking.toFixed(2)}元</span>}
                                                      {comm.diagnosis > 0 && <span className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">诊断 {comm.diagnosis.toFixed(2)}元</span>}
                                                      {comm.qc > 0 && <span className="text-pink-600 bg-pink-50 px-1.5 py-0.5 rounded">质检 {comm.qc.toFixed(2)}元</span>}
                                                    </div>
                                                  );
                                                })()}
                                              </ShowCommission>
                                              {/* 物流信息 */}
                                              {p.logistics_agreement && (
                                                <span className="text-gray-400 text-[10px]">物流公司: {p.logistics_agreement}</span>
                                              )}
                                              {/* 备注 */}
                                              {p.notes && (
                                                <span className="text-gray-400 text-xs">{p.notes}</span>
                                              )}
                                              {/* 配件分支图片 */}
                                              {imagesByPart[p.id]?.length > 0 && (
                                                <div className="flex flex-wrap gap-1">
                                                  {imagesByPart[p.id].map((m: any) => (
                                                    <img key={m.id} src={m.storage_path} alt="" className="w-10 h-10 object-cover rounded border border-gray-100" />
                                                  ))}
                                                </div>
                                              )}
                                            </PartBranchEditor>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </SortableList>
                                  );
                                })()}
                              </div>
                            )}
                                </div>
                              ))}
                            </SortableList>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {(!requirements || requirements.length === 0) && (
                <div className="px-6 py-8 text-center text-gray-400">暂无需求记录</div>
              )}
            </div>
          </div>

          {/* 未关联需求的项目 */}
          {(sortedItems?.filter((item: any) => !item.requirement_id) ?? []).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">其他维修项目</h2>
              </div>
              <div>
                {(() => {
                  const orphanItems = sortedItems?.filter((item: any) => !item.requirement_id) || [];
                  return (
                    <SortableList ids={orphanItems.map((it: any) => it.id)} groupKey={`orphan_${id}`} tableName="work_order_items">
                      {orphanItems.map((item: any) => (
                        <div key={item.id} className={`px-6 py-4 text-sm flex items-center justify-between ${item.item_type === 'labor' ? 'bg-blue-50' : ''}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{item.alias_name || item.name}</span>
                      {item.alias_name && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">别名</span>}
                      <span className="text-gray-500">({item.item_type === 'labor' ? '工时' : item.item_type === 'part' ? '配件' : '其他'})</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        item.customer_opinion === 'agree' ? 'bg-green-50 text-green-700' :
                        item.customer_opinion === 'reject' ? 'bg-red-50 text-red-700' :
                        'bg-gray-50 text-gray-500'
                      }`}>
                        {item.customer_opinion === 'agree' ? '✓ 同意' : item.customer_opinion === 'reject' ? '✗ 拒绝' : '待确认'}
                      </span>
                      {item.business_type !== 'normal' && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          item.business_type === 'insurance' ? 'bg-purple-50 text-purple-700' :
                          item.business_type === 'gift' ? 'bg-pink-50 text-pink-700' :
                          'bg-orange-50 text-orange-700'
                        }`}>
                          {item.business_type === 'insurance' ? '保险' : item.business_type === 'gift' ? '赠送' : '返工'}
                        </span>
                      )}
                      {item.is_outsourced && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">外包</span>
                      )}
                      {item.is_customer_part && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700">自带配件</span>
                      )}
                      {item.business_type === 'rework' && item.rework_reason && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600">
                          {item.rework_reason === 'part_quality' ? '配件质量' : '施工原因'}
                          {item.rework_loss_amount > 0 ? ` · 损失${formatCurrency(item.rework_loss_amount)}` : ''}
                        </span>
                      )}
                      <ShowCommission>
                        {/* 项目提成 */}
                        {(() => {
                          const comm = calculateItemCommission(
                            item,
                            item.service_items,
                            item.service_items?.service_names,
                            null,
                            item.total_price || 0,
                            0
                          );
                          if (comm.diagnosis === 0 && comm.repair === 0 && comm.sales === 0 && comm.qc === 0) return null;
                          return (
                            <div className="flex flex-wrap gap-1.5">
                              {comm.diagnosis > 0 && <span className="text-[10px] text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">诊断提{comm.diagnosis.toFixed(0)}</span>}
                              {comm.repair > 0 && <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">维修提{comm.repair.toFixed(0)}</span>}
                              {comm.sales > 0 && <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">销售提{comm.sales.toFixed(0)}</span>}
                              {comm.qc > 0 && <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">质检提{comm.qc.toFixed(0)}</span>}
                            </div>
                          );
                        })()}
                      </ShowCommission>
                    </div>
                    <span className="font-medium">{formatCurrency(item.total_price)}</span>
                  </div>
                ))}
              </SortableList>
                  );
                })()}
              </div>
            </div>
          )}

          {/* 接车检查 */}
          {(inspections?.filter((insp: any) => insp.inspection_type === 'reception') ?? []).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">接车检查</h2>
              </div>
              <div className="divide-y divide-gray-300">
                {inspections?.filter((insp: any) => insp.inspection_type === 'reception').map((insp: any) => {
                  const media = mediaByInspection[insp.id] || [];
                  const receptionVideos = media.filter((m: any) => m.media_type === 'reception_video');
                  const exteriorPhotos = media.filter((m: any) => m.media_type === 'exterior');

                  return (
                    <div key={insp.id} className="px-6 py-4 text-sm space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">检查时间: {formatDate(insp.created_at)}</span>
                        {insp.notes && <span className="text-gray-400">备注: {insp.notes}</span>}
                      </div>

                      {receptionVideos.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">环车检查视频</div>
                          <div className="flex flex-wrap gap-2">
                            {receptionVideos.map((m: any, idx: number) => (
                              <video key={idx} src={m.storage_path} className="w-48 h-32 rounded border border-gray-200 object-cover" controls preload="metadata" />
                            ))}
                          </div>
                        </div>
                      )}

                      {exteriorPhotos.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">外观照片</div>
                          <div className="flex flex-wrap gap-2">
                            {exteriorPhotos.map((m: any, idx: number) => (
                              <img key={idx} src={m.storage_path} alt="" className="w-20 h-20 object-cover rounded border border-gray-200" />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 车况检查 */}
          {(inspections?.filter((insp: any) => insp.inspection_type === 'inspection') ?? []).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">车况检查</h2>
              </div>
              <div className="divide-y divide-gray-300">
                {inspections?.filter((insp: any) => insp.inspection_type === 'inspection').map((insp: any) => {
                  const media = mediaByInspection[insp.id] || [];
                  const oilBefore = media.find((m: any) => m.media_type === 'engine_oil_before');
                  const oilAfter = media.find((m: any) => m.media_type === 'engine_oil_after');
                  const fluidPhotos = media.filter((m: any) => m.media_type === 'fluid');
                  const exteriorPhotos = media.filter((m: any) => m.media_type === 'exterior');
                  const dashboardPhotos = media.filter((m: any) => m.media_type === 'dashboard');

                  return (
                    <div key={insp.id} className="px-6 py-4 text-sm space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">检查时间: {formatDate(insp.created_at)}</span>
                        {insp.notes && <span className="text-gray-400">备注: {insp.notes}</span>}
                      </div>

                      {/* 仪表检查 */}
                      {(dashboardPhotos.length > 0 || insp.dashboard_fuel_level || (insp.dashboard_fault_lights && insp.dashboard_fault_lights.length > 0)) && (
                        <div className="space-y-2">
                          {dashboardPhotos.length > 0 && (
                            <div>
                              <div className="text-xs text-gray-500 mb-1">仪表照片</div>
                              <div className="flex flex-wrap gap-2">
                                {dashboardPhotos.map((m: any, idx: number) => (
                                  <img key={idx} src={m.storage_path} alt="" className="w-24 h-24 object-cover rounded border border-gray-200" />
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            {insp.dashboard_fuel_level !== null && (
                              <span className="text-sm">燃油存量: <span className="font-medium">{insp.dashboard_fuel_level}%</span></span>
                            )}
                            {insp.dashboard_fault_lights && insp.dashboard_fault_lights.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {insp.dashboard_fault_lights.map((light: string, idx: number) => {
                                  const labelMap: Record<string, string> = {
                                    engine: '发动机故障灯', abs: 'ABS灯', airbag: '气囊灯',
                                    oil_pressure: '机油压力灯', battery: '电池灯', coolant: '水温报警灯',
                                    tire: '胎压报警灯', emission: '排放故障灯', brake_system: '刹车系统灯',
                                    seatbelt: '安全带提示灯', maintenance: '保养提示灯', esp: 'ESP/防滑灯',
                                  };
                                  return (
                                    <span key={idx} className="px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700">
                                      {labelMap[light] || light}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 机油油位 */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {oilBefore && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1">机油油位 - 施工前</div>
                            <div className="relative rounded border border-gray-200 overflow-hidden max-w-xs">
                              <img src={oilBefore.storage_path} alt="机油施工前" className="w-full object-contain" />
                              {oilBefore.annotations && oilBefore.annotations.length > 0 && (
                                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                                  {oilBefore.annotations.map((line: any, idx: number) => (
                                    <line key={idx}
                                      x1={`${line.x1 * 100}%`} y1={`${line.y1 * 100}%`}
                                      x2={`${line.x2 * 100}%`} y2={`${line.y2 * 100}%`}
                                      stroke="#ef4444" strokeWidth="2"
                                    />
                                  ))}
                                </svg>
                              )}
                            </div>
                          </div>
                        )}
                        {oilAfter && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1">机油油位 - 施工后</div>
                            <div className="relative rounded border border-gray-200 overflow-hidden max-w-xs">
                              <img src={oilAfter.storage_path} alt="机油施工后" className="w-full object-contain" />
                              {oilAfter.annotations && oilAfter.annotations.length > 0 && (
                                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                                  {oilAfter.annotations.map((line: any, idx: number) => (
                                    <line key={idx}
                                      x1={`${line.x1 * 100}%`} y1={`${line.y1 * 100}%`}
                                      x2={`${line.x2 * 100}%`} y2={`${line.y2 * 100}%`}
                                      stroke="#ef4444" strokeWidth="2"
                                    />
                                  ))}
                                </svg>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 其它油液 */}
                      {fluidPhotos.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">其它油液</div>
                          <div className="flex flex-wrap gap-2">
                            {fluidPhotos.map((m: any, idx: number) => (
                              <img key={idx} src={m.storage_path} alt="" className="w-20 h-20 object-cover rounded border border-gray-200" />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 灯光检查 */}
                      {insp.light_checks && Object.keys(insp.light_checks).length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">灯光检查</div>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(insp.light_checks as Record<string, string>).map(([key, status]) => {
                              const labelMap: Record<string, string> = {
                                left_headlight: '左前大灯', right_headlight: '右前大灯',
                                left_tail_light: '左后尾灯', right_tail_light: '右后尾灯',
                                left_turn_front: '左前转向灯', right_turn_front: '右前转向灯',
                                left_turn_rear: '左后转向灯', right_turn_rear: '右后转向灯',
                                brake_light: '刹车灯', reverse_light: '倒车灯',
                                fog_light: '雾灯', license_plate_light: '牌照灯',
                                interior_light: '室内灯',
                              };
                              return (
                                <span key={key}
                                  className={`px-2 py-0.5 rounded text-[10px] ${
                                    status === 'normal'
                                      ? 'bg-green-50 text-green-700'
                                      : 'bg-red-50 text-red-700'
                                  }`}
                                >
                                  {labelMap[key] || key}: {status === 'normal' ? '正常' : '故障'}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 刹车片 + 尾气 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {(insp.front_brake_pad_thickness || insp.rear_brake_pad_thickness) && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1">刹车片厚度</div>
                            <div className="space-y-0.5 text-sm">
                              {insp.front_brake_pad_thickness !== null && (
                                <div>前刹车片: <span className="font-medium">{insp.front_brake_pad_thickness} mm</span></div>
                              )}
                              {insp.rear_brake_pad_thickness !== null && (
                                <div>后刹车片: <span className="font-medium">{insp.rear_brake_pad_thickness} mm</span></div>
                              )}
                            </div>
                          </div>
                        )}
                        {(insp.exhaust_hc || insp.exhaust_co || insp.exhaust_no || insp.exhaust_co2 || insp.exhaust_o2) && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1">尾气数据</div>
                            <div className="grid grid-cols-5 gap-2 text-center text-xs">
                              {insp.exhaust_hc !== null && <div><div className="text-gray-400">HC</div><div className="font-medium">{insp.exhaust_hc}</div></div>}
                              {insp.exhaust_co !== null && <div><div className="text-gray-400">CO</div><div className="font-medium">{insp.exhaust_co}</div></div>}
                              {insp.exhaust_no !== null && <div><div className="text-gray-400">NO</div><div className="font-medium">{insp.exhaust_no}</div></div>}
                              {insp.exhaust_co2 !== null && <div><div className="text-gray-400">CO₂</div><div className="font-medium">{insp.exhaust_co2}</div></div>}
                              {insp.exhaust_o2 !== null && <div><div className="text-gray-400">O₂</div><div className="font-medium">{insp.exhaust_o2}</div></div>}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 外检照片 */}
                      {exteriorPhotos.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">外检照片</div>
                          <div className="flex flex-wrap gap-2">
                            {exteriorPhotos.map((m: any, idx: number) => (
                              <img key={idx} src={m.storage_path} alt="" className="w-20 h-20 object-cover rounded border border-gray-200" />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 质检记录 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">质检记录</h2>
            <div className="space-y-3">
              {qualityChecks?.map((qc: any) => (
                <div key={qc.id} className="flex items-start gap-3 text-sm">
                  <div className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${qc.result === 'passed' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div>
                    <span className="font-medium">{qc.result === 'passed' ? '质检通过' : '质检不合格'}</span>
                    <span className="text-gray-500 ml-2">{qc.profiles?.full_name} · {formatDate(qc.created_at)}</span>
                    {qc.notes && <p className="text-gray-500 mt-0.5">{qc.notes}</p>}
                  </div>
                </div>
              ))}
              {(!qualityChecks || qualityChecks.length === 0) && (
                <p className="text-sm text-gray-400">暂无质检记录</p>
              )}
            </div>
          </div>
        </div>

        {/* 右侧操作区 */}
        <div className="space-y-6">
          <WorkOrderActions orderId={id} status={order.status} />

          {/* 待入库配件 */}
          {pendingInboundParts.length > 0 && (
            <div className="bg-white rounded-xl border border-orange-200 p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                待入库配件
              </h2>
              <div className="space-y-2">
                {pendingInboundParts.map((p: any) => (
                  <div key={p.id} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800">{p.name || p.part_names?.name || "未命名"}</span>
                      <Link
                        href={`/inventory/in?auto_fill=1&branch_id=${p.id}&part_number=${encodeURIComponent(p.part_number || '')}&name=${encodeURIComponent(p.name || p.part_names?.name || '')}&unit=${encodeURIComponent(p.unit || p.part_names?.unit || '')}&brand=${encodeURIComponent(p.brand || '')}&specification=${encodeURIComponent(p.specification || '')}&unit_cost=${p.unit_cost || ''}&supplier=${encodeURIComponent(p.supplier_name || '')}`}
                        className="text-xs px-2 py-1 rounded bg-orange-50 text-orange-600 hover:bg-orange-100"
                      >
                        入库登记
                      </Link>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {p.brand && <span>品牌: {p.brand} · </span>}
                      {p.specification && <span>规格: {p.specification} · </span>}
                      <span>数量: {p.quantity}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 预收款 */}

          {/* 费用汇总 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">费用合计</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600"><span>配件费用</span><span>{formatCurrency(order.parts_cost)}</span></div>
              <div className="flex justify-between text-gray-600"><span>工时费用</span><span>{formatCurrency(order.labor_cost)}</span></div>
              <div className="flex justify-between text-gray-600"><span>其他费用</span><span>{formatCurrency(order.other_cost)}</span></div>
              <ShowCommission>
                {/* 总提成 */}
                {(() => {
                  let totalCommission = 0;
                  items?.forEach((item: any) => {
                    const comm = calculateItemCommission(
                      item,
                      item.service_items,
                      item.service_items?.service_names,
                      null,
                      item.total_price || 0,
                      0
                    );
                    totalCommission += comm.diagnosis + comm.repair + comm.sales + comm.qc;
                  });
                  itemParts?.forEach((p: any) => {
                    const revenue = (p.quantity || 0) * (p.unit_price || 0);
                    const cost = (p.quantity || 0) * (p.unit_cost || 0);
                    const comm = calculatePartCommission(p.parts, p.part_names, revenue, cost);
                    totalCommission += comm.sales + comm.repair + comm.picking + comm.diagnosis + comm.qc;
                  });
                  if (totalCommission <= 0) return null;
                  return (
                    <div className="flex justify-between text-purple-600">
                      <span>预估总提成</span>
                      <span>{formatCurrency(totalCommission)}</span>
                    </div>
                  );
                })()}
              </ShowCommission>
              {(order.discount_amount || 0) > 0 && (
                <div className="flex justify-between text-orange-600"><span>整单优惠</span><span>-{formatCurrency(order.discount_amount)}</span></div>
              )}
              {(advancePaymentTotal || 0) > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-green-600">
                    <span>已预收</span>
                    <span>-{formatCurrency(advancePaymentTotal)}</span>
                  </div>
                  <div className="pl-3 space-y-0.5 text-xs text-gray-500">
                    {(advancePaymentRecords || []).map((r: any) => (
                      <div key={r.id} className="flex justify-between">
                        <span>
                          {formatDate(r.paid_at)}
                          {' · '}
                          {r.method === 'cash' ? '现金' : r.method === 'wechat' ? '微信' : r.method === 'alipay' ? '支付宝' : '银行转账'}
                          {r.profiles?.full_name && ` · ${r.profiles.full_name}`}
                        </span>
                        <span>{formatCurrency(r.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="border-t border-gray-100 pt-2 flex justify-between text-base font-bold text-gray-900">
                <span>应收合计</span>
                <span>{formatCurrency(order.total_cost - (advancePaymentTotal || 0))}</span>
              </div>
            </div>
          </div>

          {/* 支付记录 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">支付记录</h2>
            <div className="space-y-2">
              {payments?.map((p: any) => (
                <div key={p.id} className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    {p.method === 'cash' ? '现金' : p.method === 'wechat' ? '微信' : p.method === 'alipay' ? '支付宝' : p.method === 'credit' ? '挂账' : p.method === 'member' ? '会员' : '银行转账'}
                  </span>
                  <span className="font-medium text-gray-900">{formatCurrency(p.amount)}</span>
                </div>
              ))}
              {(!payments || payments.length === 0) && <p className="text-sm text-gray-400">暂无支付记录</p>}
            </div>
          </div>

          {/* 回访记录 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">回访记录</h2>
            <div className="space-y-3">
              {followUps?.map((fu: any) => {
                const isCompleted = !!fu.completed_at;
                const isOverdue = !isCompleted && fu.scheduled_at <= new Date().toISOString();
                return (
                  <div key={fu.id} className="flex items-start gap-3 text-sm">
                    <div className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${isCompleted ? 'bg-green-500' : isOverdue ? 'bg-red-500' : 'bg-blue-500'}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {isCompleted ? '已完成' : isOverdue ? '已逾期' : '待回访'}
                        </span>
                        <span className="text-gray-500">· {formatDate(fu.scheduled_at)}</span>
                        {fu.method && (
                          <span className="text-gray-400">
                            · {fu.method === 'phone' ? '电话' : fu.method === 'sms' ? '短信' : fu.method === 'wechat' ? '微信' : fu.method}
                          </span>
                        )}
                      </div>
                      {fu.result && <p className="text-gray-600 mt-0.5">{fu.result}</p>}
                      {fu.notes && <p className="text-gray-400 text-xs mt-0.5">{fu.notes}</p>}
                      {!isCompleted && (
                        <Link href={`/follow-ups/${fu.id}`} className="text-xs text-blue-600 hover:text-blue-700 mt-1 inline-block">
                          去回访 →
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
              {(!followUps || followUps.length === 0) && (
                <p className="text-sm text-gray-400">暂无回访记录</p>
              )}
            </div>
          </div>

          {/* 状态历史 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">状态变更</h2>
            <div className="space-y-3">
              {history?.map((h: any) => (
                <div key={h.id} className="flex gap-3 text-sm">
                  <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-500 shrink-0" />
                  <div>
                    <div className="text-gray-900">{h.from_status ? `${h.from_status} → ${h.to_status}` : `创建: ${h.to_status}`}</div>
                    <div className="text-xs text-gray-500">{formatDate(h.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <WorkOrderTotalFooter
        items={(items || []).map((it: any) => ({ id: it.id, total_price: it.total_price || 0 }))}
        parts={(itemParts || []).map((p: any) => ({
          id: p.id,
          itemId: p.work_order_item_id,
          unit_price: p.unit_price || 0,
          quantity: p.quantity || 1,
          is_selected: p.is_selected || false,
        }))}
        advancePaymentTotal={advancePaymentTotal}
      />
    </WorkOrderToggleProvider>
  );
}
