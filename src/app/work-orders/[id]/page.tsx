import { getWorkOrderData } from "@/lib/workOrderData";
import { formatCurrency, formatDate } from "@/lib/utils";
import { readyToClose } from "@/lib/orderStage";
import { PriceValue } from "@/components/PriceVisibilityContext";
import FaultLightIcon from "@/components/FaultLightIcon";
import { calculateItemCommission } from "@/lib/commission";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkOrderTabBar } from "@/components/WorkOrderTabBar";
import { ReceptionInfoEditor } from "@/components/ReceptionInfoEditor";
import { BatchEditWrapper } from "@/components/BatchEditWrapper";
import { CreateMaintenanceWrapper } from "@/components/CreateMaintenanceWrapper";
import { MaintenanceImportWrapper } from "@/components/MaintenanceImportWrapper";
import { MaintenanceActionWrapper } from "@/components/MaintenanceActionWrapper";
import { SaveMaintenanceButton } from "@/components/SaveMaintenanceButton";
import { CancelCreateMaintenanceButton } from "@/components/CancelCreateMaintenanceButton";
import { BusinessTypeToggle } from "@/components/BusinessTypeToggle";
import ItemNameDisplay from "@/components/ItemNameDisplay";
import ItemStageBadge from "@/components/ItemStageBadge";
import ItemQcActions from "@/components/ItemQcActions";
import ItemRowWrapper from "@/components/ItemRowWrapper";
import SavingToast from "@/components/SavingToast";
import LiveRequirementsList from "@/components/LiveRequirementsList";
import RequirementRowWrapper from "@/components/RequirementRowWrapper";
import LiveItemsList from "@/components/LiveItemsList";
import ItemPartsLive from "@/components/ItemPartsLive";
import AssignmentBadge from "@/components/AssignmentBadge";
import SeqBadge from "@/components/SeqBadge";
import { TemplateImportWrapper } from "@/components/TemplateImportWrapper";
import { ConstructionControls } from "@/components/ConstructionControls";
import { WorkOrderItemActions } from "@/components/WorkOrderItemActions";
import { ItemPersonSelectors } from "@/components/ItemPersonSelectors";
import { CustomerOpinionToggle } from "@/components/CustomerOpinionToggle";
import { ItemFlagsToggle } from "@/components/ItemFlagsToggle";
import { WorkOrderActions } from "@/components/WorkOrderActions";
import WorkOrderActionButtons from "@/components/WorkOrderActionButtons";
import RequirementActions from "@/components/RequirementActions";
import RequirementTitle from "@/components/RequirementTitle";
import { ItemNotesEditor } from "@/components/ItemNotesEditor";
import AddItemPartButton from "@/components/AddItemPartButton";
import AddRequirementButton from "@/components/AddRequirementButton";
import AddRequirementItemsButton from "@/components/AddRequirementItemsButton";
import ItemPartGroup from "@/components/ItemPartGroup";
import { WorkOrderToggleProvider, ShowCommission, ShowTimer } from "@/components/WorkOrderToggleContext";
import { WorkOrderToggleBar } from "@/components/WorkOrderToggleBar";
import PrintDropdown from "@/components/PrintDropdown";
import AdvancePaymentDropdown from "@/components/AdvancePaymentDropdown";
import ItemSubtotalDisplay from "@/components/ItemSubtotalDisplay";
import WorkOrderTotalFooter from "@/components/WorkOrderTotalFooter";
import AdvancePaymentList from "@/components/AdvancePaymentList";
import SortableList from "@/components/SortableList";
import ItemImageUploader from "@/components/ItemImageUploader";
import { WorkOrderRealtimeSync } from "@/components/WorkOrderRealtimeSync";
import MobileItemEditor from "@/components/MobileItemEditor";
import LazyVideo from "@/components/LazyVideo";
import { buildWorkOrderView } from "@/lib/workOrderView";
import type { ComponentProps } from "react";
import type { CommissionSource } from "@/lib/commission";

export default async function WorkOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};
  const tabsParam = typeof sp.tabs === "string" ? sp.tabs : "";
  const {
    order, requirements, profiles, requirementMedia, items, itemsError,
    itemMedia, itemMechanics, mechanicGroups, knowledgeLinks, itemParts,
    partMedia, pickingRecords, returnRecords, supplierReturnRecords, partBatches,
    qualityChecks, payments, advancePaymentRecords, followUps, history, suppliers, logisticsCompanies,
    inspections, inspectionMedia, outsourceOrder,
    historyOrderCount, otherOrdersByType, customerOrderCount,
  } = await getWorkOrderData(id);

  if (!order) notFound();

  // 数据加工已抽到 buildWorkOrderView（src/lib/workOrderView.ts），页面只负责渲染
  const {
    advancePaymentTotal, vehicleModelId, vehicleVin,
    typeCountMap, typeLabelMapForDisplay, pendingInboundParts,
    mechanicsByItem, partsByItem,
    mediaByRequirement, imagesByItem, imagesByPart, mediaByInspection,
    inventoryByPart, pickingByPart, returnByPart, pendingSupplierReturnByPart,
    knowledgeByItem, isLocked,
    itemsByRequirement, receptionInspections, conditionInspections,
    partGroupsByItem, totalCommission,
  } = buildWorkOrderView({
    order, requirements, items, itemMedia, itemMechanics, requirementMedia,
    knowledgeLinks, itemParts, partMedia, pickingRecords, returnRecords,
    supplierReturnRecords, partBatches, inspections, inspectionMedia,
    advancePaymentRecords, otherOrdersByType,
  });


  /* 待结单判定（唯一通道 2026-07-31）：全部派工 + 选中配件全出库（无配件只看全部派工）。
   * 命中时"确认结单"按钮出现（repairing/pending_quality_check 也可直接结单） */
  const 待结单就绪 = readyToClose({
    status: order.status,
    有未指派需求: (requirements || []).some(
      (r) => !(r as { assigned_to?: string | null }).assigned_to
    ),
    项目列表: (items || []).map((it) => ({
      item_type: it.item_type,
      status: it.status,
      require_qc: it.require_qc,
      qc_status: it.qc_status,
      customer_opinion: it.customer_opinion,
      已派工: (mechanicsByItem[it.id] || []).length > 0 || !!it.mechanic_id,
    })),
    配件列表: Object.values(partsByItem).flat().map((p) => ({
      is_selected: p.is_selected,
      quantity: p.quantity,
      净出库: (pickingByPart[p.id] || 0) - (returnByPart[p.id] || 0),
    })),
  });

  // 保养单标识
  const 是保养单 = order.order_type === "maintenance";  // 保养单默认只读，除非带 edit=1 参数
  const 保养编辑模式 = typeof sp.edit === "string" && sp.edit === "1";
  // 创建模式：刚创建的保养单，保存后生效，取消则删除
  const 创建模式 = typeof sp.creating === "string" && sp.creating === "1";
  const 实际锁定 = 是保养单 ? !保养编辑模式 : isLocked;
  // 编辑链接：保留现有查询参数并加上 edit=1
  const 编辑链接 = (() => {
    const p = new URLSearchParams();
    const fromWo = typeof sp.from_work_order === "string" ? sp.from_work_order : "";
    if (fromWo) p.set("from_work_order", fromWo);
    p.set("edit", "1");
    return `/work-orders/${id}?${p.toString()}`;
  })();
  // 保存链接：返回只读模式
  const 保存链接 = (() => {
    const p = new URLSearchParams();
    const fromWo = typeof sp.from_work_order === "string" ? sp.from_work_order : "";
    if (fromWo) p.set("from_work_order", fromWo);
    return `/work-orders/${id}?${p.toString()}`;
  })();

  return (
    <WorkOrderToggleProvider>
    <WorkOrderTabBar tabs={tabsParam} />
    <div className="pb-20">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className={`text-xs md:text-base font-semibold ${是保养单 ? "text-red-700" : "text-gray-900"}`}>
            {是保养单
              ? 创建模式
                ? "保养单（未保存）"
                : `保养单 ${order.order_no.replace(/^WO-/, "BY-")}`
              : `工单 ${order.order_no}`}
          </h1>
          {是保养单 && (
            <span className="px-3 py-1 rounded-full bg-red-100 border border-red-400 text-red-700 text-xs font-bold">
              保养工单
            </span>
          )}
        </div>

        {/* 移动端：折叠操作菜单 */}
        <details className="md:hidden">
          <summary className="cursor-pointer list-none">
            <span className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg bg-white text-gray-600 hover:bg-gray-50 select-none">
              更多操作
            </span>
          </summary>
          <div className="absolute right-4 z-40 mt-2 bg-white rounded-xl border border-gray-200 shadow-lg p-3 flex flex-col gap-2 min-w-[160px]">
            {order.vehicle_id && (
              <Link
                href={`/work-orders?vehicle_id=${order.vehicle_id}`}
                className="text-sm text-blue-600 hover:text-blue-700 py-1"
              >
                维修记录{historyOrderCount ? `(${historyOrderCount})` : ""}
              </Link>
            )}
            <AdvancePaymentDropdown
              orderId={id}
              advancePayment={advancePaymentTotal}
              totalCost={order.total_cost || 0}
              records={(advancePaymentRecords || []) as unknown as ComponentProps<typeof AdvancePaymentDropdown>["records"]}
            />
            <WorkOrderToggleBar />
            <WorkOrderActionButtons
              workOrderId={id}
              orderNo={order.order_no ?? ""}
            />
          </div>
        </details>

        {/* PC端：横向展开 */}
        <div className="hidden md:flex items-center gap-3">
          {order.vehicle_id && (
            <Link
              href={`/work-orders?vehicle_id=${order.vehicle_id}`}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              维修记录{historyOrderCount ? `(${historyOrderCount})` : ""}
            </Link>
          )}
          <AdvancePaymentDropdown
            orderId={id}
            advancePayment={advancePaymentTotal}
            totalCost={order.total_cost || 0}
            records={(advancePaymentRecords || []) as unknown as ComponentProps<typeof AdvancePaymentDropdown>["records"]}
          />
          <WorkOrderToggleBar />
          <WorkOrderActionButtons
            workOrderId={id}
            orderNo={order.order_no ?? ""}
            currentType={order.order_type || "normal"}
          />
          <div className="hidden md:block">
            <PrintDropdown orderId={id} />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* 保养单提示横幅 */}
        {是保养单 && (
          <div className="bg-red-50 border-2 border-red-400 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-6 h-6 text-red-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div className="flex-1">
              <div className="text-sm font-bold text-red-800">
                {创建模式 ? "正在创建保养单" : "当前工单为保养单"}
              </div>
              <div className="text-xs text-red-600">
                {创建模式
                  ? "已复制工单内容，编辑后点击保存生成保养单，取消则不生成"
                  : 保养编辑模式
                  ? "编辑模式——修改完成后请保存"
                  : "保养单默认只读，点击编辑按钮可修改"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!保养编辑模式 ? (
                <a
                  href={编辑链接}
                  className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  编辑
                </a>
              ) : (
                <>
                  {创建模式 && <CancelCreateMaintenanceButton orderId={id} />}
                  <SaveMaintenanceButton orderId={id} label={创建模式 ? "保存保养单" : undefined} />
                </>
              )}
            </div>
          </div>
        )}

        {/* 主内容 */}
          {/* 基本信息 */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6">
            {/* 车辆信息行 - 字号缩小 */}
            {(() => {
              const vin: string = order.vehicles?.vin || "";
              const vinValid = /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
              const modelInfo = [order.vehicles?.brand, order.vehicles?.model].filter(Boolean).join(" ");
              return (
                <div className="flex items-start gap-4 flex-wrap text-sm mb-2 pb-2 border-b border-gray-100">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span>
                      <span className="text-gray-500">车牌:</span>{' '}
                      {order.vehicle_id ? (
                        <Link
                          href={`/vehicles/${order.vehicle_id}?from_work_order=${id}`}
                          className="font-semibold text-blue-600 hover:underline"
                        >
                          {order.vehicles?.plate_number || "-"}
                        </Link>
                      ) : (
                        <span className="font-semibold text-gray-900">{order.vehicles?.plate_number || "-"}</span>
                      )}
                    </span>
                    <span>
                      <span className="text-gray-500">VIN:</span>{' '}
                      {vin ? (
                        <span
                          className={`inline-block w-[17ch] font-mono text-xs ${vinValid ? "text-gray-900" : "text-red-600"}`}
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
                    </span>
                    <span>
                      <span className="text-gray-500">车型:</span>{' '}
                      <span className="text-gray-800">{modelInfo || "-"}</span>
                    </span>
                    <span><span className="text-gray-500">接车里程:</span> {order.mileage_in ? `${order.mileage_in} km` : "-"}</span>
                    <span className="text-gray-400 text-xs">创建于 {formatDate(order.created_at ?? null)}</span>
                    <div className="md:hidden">
                      <ReceptionInfoEditor
                        orderId={id}
                        mileageIn={order.mileage_in ?? null}
                        dashboardPhotos={order.dashboard_photos}
                        estimatedCompletionAt={order.estimated_completion_at ?? null}
                        senderName={order.sender_name}
                        senderPhone={order.sender_phone}
                      />
                    </div>
                  </div>
                  {/* 车辆其他状态工单提示 */}
                  {Object.keys(typeCountMap).length > 0 && (
                    <div className="flex items-center gap-3 flex-wrap text-xs mt-1">
                      <span className="text-gray-400">该车辆还有:</span>
                      {Object.entries(typeCountMap).map(([t, info]) => (
                        <Link
                          key={t}
                          href={`/work-orders?type=${t}&vehicle_id=${order.vehicle_id}`}
                          className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                        >
                          {typeLabelMapForDisplay[t] || t}({info.count})
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 移动端：折叠的客户信息 */}
            <details className="md:hidden text-sm mb-2">
              <summary className="cursor-pointer text-blue-600 hover:text-blue-700 select-none flex items-center justify-between py-1">
                <span className="font-medium text-gray-700">
                  客户: {order.customers?.name || "-"}
                  {order.customers?.phone && <span className="text-gray-500 font-normal ml-2">{order.customers.phone}</span>}
                </span>
                <span className="text-xs text-blue-600">展开</span>
              </summary>
              <div className="mt-2 space-y-1.5 text-sm">
                <div><span className="text-gray-500">客户:</span>{' '}
                  {order.customer_id ? (
                    <Link href={`/customers/${order.customer_id}?from_work_order=${id}`} className="font-medium text-blue-600 hover:underline">
                      {order.customers?.name || "-"}
                    </Link>
                  ) : (
                    <span className="font-medium">{order.customers?.name || "-"}</span>
                  )}
                  {order.customers?.star_level && (
                    <span className="ml-1 text-amber-500">{'★'.repeat(order.customers.star_level)}</span>
                  )}
                </div>
                <div><span className="text-gray-500">电话:</span> {order.customers?.phone || "-"}</div>
                <div><span className="text-gray-500">消费总额:</span> <span className="font-medium text-gray-900">{formatCurrency(order.customers?.total_spent || 0)}</span></div>
                <div><span className="text-gray-500">消费次数:</span> <span className="font-medium text-gray-900">{customerOrderCount ?? 0}</span></div>
                <div><span className="text-gray-500">约定交车:</span> {order.estimated_completion_at ? formatDate(order.estimated_completion_at) : "-"}</div>
                {order.sender_name && (
                  <div><span className="text-gray-500">送修人:</span> <span className="font-medium">{order.sender_name}</span> {order.sender_phone && <span className="text-gray-400">({order.sender_phone})</span>}</div>
                )}
                <div className="pt-2 border-t border-gray-100">
                  <ReceptionInfoEditor
                    orderId={id}
                    mileageIn={order.mileage_in ?? null}
                    dashboardPhotos={order.dashboard_photos}
                    estimatedCompletionAt={order.estimated_completion_at ?? null}
                    senderName={order.sender_name}
                    senderPhone={order.sender_phone}
                  />
                </div>
                {order.customers?.company && (
                  <div><span className="text-gray-400">单位:</span> {order.customers.company}</div>
                )}
                {order.vehicles?.color && (
                  <div><span className="text-gray-400">颜色:</span> {order.vehicles.color}</div>
                )}
                {order.vehicles?.engine_no && (
                  <div><span className="text-gray-400">发动机号:</span> {order.vehicles.engine_no}</div>
                )}
                {order.vehicles?.vehicle_models?.排量 && (
                  <div><span className="text-gray-400">排量:</span> {order.vehicles.vehicle_models.排量}</div>
                )}
                {order.vehicles?.vehicle_models?.变速箱类型 && (
                  <div><span className="text-gray-400">变速箱:</span> {order.vehicles.vehicle_models.变速箱类型}</div>
                )}
                {order.vehicles?.vehicle_models?.年份 && (
                  <div><span className="text-gray-400">年份:</span> {order.vehicles.vehicle_models.年份}</div>
                )}
                {order.description && (
                  <div><span className="text-gray-400">备注:</span> {order.description}</div>
                )}
              </div>
            </details>

            {/* PC端：客户信息 + 展开更多 - 同一行 */}
            <div className="hidden md:flex items-start justify-between gap-4 flex-wrap text-sm mb-2">
              <div className="flex items-center gap-4 flex-wrap">
                <span>
                  <span className="text-gray-500">客户:</span>{' '}
                  {order.customer_id ? (
                    <Link
                      href={`/customers/${order.customer_id}?from_work_order=${id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {order.customers?.name || "-"}
                    </Link>
                  ) : (
                    <span className="font-medium">{order.customers?.name || "-"}</span>
                  )}
                  {order.customers?.star_level && (
                    <span className="ml-1 text-amber-500" title={`${order.customers.star_level}星客户`}>
                      {'★'.repeat(order.customers.star_level)}
                    </span>
                  )}
                </span>
                <span><span className="text-gray-500">电话:</span> {order.customers?.phone || "-"}</span>
                <span><span className="text-gray-500">消费总额:</span> <span className="font-medium text-gray-900">{formatCurrency(order.customers?.total_spent || 0)}</span></span>
                <span><span className="text-gray-500">消费次数:</span> <span className="font-medium text-gray-900">{customerOrderCount ?? 0}</span></span>
                <span><span className="text-gray-500">约定交车:</span> {order.estimated_completion_at ? formatDate(order.estimated_completion_at) : "-"}</span>
                {order.sender_name && (
                  <span><span className="text-gray-500">送修人:</span> <span className="font-medium">{order.sender_name}</span> {order.sender_phone && <span className="text-gray-400">({order.sender_phone})</span>}</span>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <ReceptionInfoEditor
                  orderId={id}
                  mileageIn={order.mileage_in ?? null}
                  dashboardPhotos={order.dashboard_photos}
                  estimatedCompletionAt={order.estimated_completion_at ?? null}
                  senderName={order.sender_name}
                  senderPhone={order.sender_phone}
                />
                <details className="text-sm">
                  <summary className="cursor-pointer text-blue-600 hover:text-blue-700 text-xs inline-block select-none">
                    展开更多信息
                  </summary>
                  <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-gray-600">
                  {order.customers?.company && (
                    <div><span className="text-gray-400">单位:</span> {order.customers.company}</div>
                  )}
                  {order.vehicles?.color && (
                    <div><span className="text-gray-400">颜色:</span> {order.vehicles.color}</div>
                  )}
                  {order.vehicles?.engine_no && (
                    <div><span className="text-gray-400">发动机号:</span> {order.vehicles.engine_no}</div>
                  )}
                  {order.vehicles?.vehicle_models?.排量 && (
                    <div><span className="text-gray-400">排量:</span> {order.vehicles.vehicle_models.排量}</div>
                  )}
                  {order.vehicles?.vehicle_models?.变速箱类型 && (
                    <div><span className="text-gray-400">变速箱:</span> {order.vehicles.vehicle_models.变速箱类型}</div>
                  )}
                  {order.vehicles?.vehicle_models?.年份 && (
                    <div><span className="text-gray-400">年份:</span> {order.vehicles.vehicle_models.年份}</div>
                  )}
                  {order.description && (
                    <div className="col-span-2 md:col-span-4"><span className="text-gray-400">备注:</span> {order.description}</div>
                  )}
                </div>
              </details>
            </div>
          </div>
        </div>

          {/* 客户需求 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* PC端标题栏 */}
            <div className="hidden md:flex px-6 py-4 border-b border-gray-100 items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">客户需求与诊断</h2>
              <div className="flex items-center gap-3">
                {!实际锁定 && (
                  <>
                    <AddRequirementButton orderId={id} autoOpen={sp.newReq === "1"} />
                  </>
                )}
                <Link href={`/work-orders/${id}/reception/new`} className="text-sm text-orange-600 hover:text-orange-700">+ 接车检查</Link>
                <Link href={`/work-orders/${id}/inspection/new`} className="text-sm text-green-600 hover:text-green-700">+ 车况检查</Link>
                {!实际锁定 && (
                  <>
                    {order.vehicle_id && (
                      <>
                        <TemplateImportWrapper vehicleId={order.vehicle_id} orderId={id} />
                        <MaintenanceActionWrapper
                          vehicleId={order.vehicle_id}
                          customerId={order.customer_id}
                          orderId={id}
                          orderNo={order.order_no}
                          plateNumber={order.vehicles?.plate_number || ""}
                          modelInfo={[order.vehicles?.brand, order.vehicles?.model].filter(Boolean).join(" ")}
                          customerName={order.customers?.name || ""}
                        />
                      </>
                    )}
                    <BatchEditWrapper
                      orderId={id}
                      items={(items || []) as unknown as ComponentProps<typeof BatchEditWrapper>["items"]}
                      itemParts={(itemParts || []) as unknown as ComponentProps<typeof BatchEditWrapper>["itemParts"]}
                      suppliers={suppliers || []}
                      logisticsCompanies={logisticsCompanies || []}
                    />
                  </>
                )}
              </div>
            </div>
            {/* 移动端按钮栏（无标题，+需求、接车检查、车况检查、保养模板、批量修改） */}
            <div className="md:hidden px-4 py-3 border-b border-gray-100 flex items-center flex-wrap gap-2">
              {!实际锁定 && <AddRequirementButton orderId={id} autoOpen={sp.newReq === "1"} />}
              <Link href={`/work-orders/${id}/reception/new`} className="text-xs text-orange-600 hover:text-orange-700">+ 接车检查</Link>
              <Link href={`/work-orders/${id}/inspection/new`} className="text-xs text-green-600 hover:text-green-700">+ 车况检查</Link>
              {!实际锁定 && order.vehicle_id && (
                <>
                  <TemplateImportWrapper vehicleId={order.vehicle_id} orderId={id} />
                  <MaintenanceActionWrapper
                    vehicleId={order.vehicle_id}
                    customerId={order.customer_id}
                    orderId={id}
                    orderNo={order.order_no}
                    plateNumber={order.vehicles?.plate_number || ""}
                    modelInfo={[order.vehicles?.brand, order.vehicles?.model].filter(Boolean).join(" ")}
                    customerName={order.customers?.name || ""}
                  />
                </>
              )}
              {!实际锁定 && (
                <BatchEditWrapper
                  orderId={id}
                  items={(items || []) as unknown as ComponentProps<typeof BatchEditWrapper>["items"]}
                  itemParts={(itemParts || []) as unknown as ComponentProps<typeof BatchEditWrapper>["itemParts"]}
                  suppliers={suppliers || []}
                  logisticsCompanies={logisticsCompanies || []}
                />
              )}
            </div>
            <LiveRequirementsList
              orderId={id}
              vehicleModelId={vehicleModelId}
              实际锁定={实际锁定}
              profiles={profiles || []}
              已有需求IDs={(requirements || []).map((r: { id: string }) => r.id)}
              mechanicGroups={(mechanicGroups || []).map((g: { id: string; name: string; mechanic_group_members?: unknown[] }) => ({ id: g.id, name: g.name, members: g.mechanic_group_members || [] }))}
              vehicleVin={vehicleVin}
              suppliers={suppliers || []}
              logisticsCompanies={logisticsCompanies || []}
            >
              {requirements?.map((req: { id: string; seq: number; submitted_by?: string; assigned_to_profile?: { full_name?: string } | null; assignment_type?: string; notes?: string }, reqIdx: number) => {
                /* 显示用序号：按当前列表位置，删中间需求后自动重排（需求1/2/3…） */
                const 显示序号 = reqIdx + 1;
                return (
                <RequirementRowWrapper key={req.id} reqId={req.id}>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-4 overflow-hidden">
                  <div className="flex items-center gap-2 flex-wrap px-4 py-3 md:px-6 md:py-4 border-b border-gray-100 bg-gray-50/50">
                    <RequirementTitle req={req} orderId={id} profiles={profiles || []} media={mediaByRequirement[req.id] || []} 项目数={(itemsByRequirement.get(req.id) || []).length} displaySeq={显示序号} />
                    <AssignmentBadge
                      reqId={req.id}
                      初始姓名={req.assigned_to_profile?.full_name || null}
                      初始类型={req.assignment_type || null}
                    />
                    <span className="hidden md:inline text-xs text-gray-400">
                      提交: {(profiles || []).find((p) => p.id === req.submitted_by)?.full_name || "-"}
                    </span>
                    {!实际锁定 && (
                      <div className="flex items-center gap-2 ml-auto">
                        <RequirementActions
                          requirement={req as unknown as ComponentProps<typeof RequirementActions>["requirement"]}
                          profiles={(profiles || []) as unknown as ComponentProps<typeof RequirementActions>["profiles"]}
                        />
                        <AddRequirementItemsButton orderId={id} requirementId={req.id} vehicleModelId={vehicleModelId ?? null} />
                      </div>
                    )}
                  </div>
                  {itemsError && (
                    <div className="mt-2 text-xs text-red-600 bg-red-50 rounded p-2">
                      项目加载失败: {itemsError.message}
                    </div>
                  )}
                  <div className="px-4 py-3 md:px-6 md:py-4">
                        {(() => {
                          const reqItems = itemsByRequirement.get(req.id) || [];
                          return (
                            <SortableList
                              ids={reqItems.map((it) => it.id)}
                              groupKey={req.id}
                              tableName="work_order_items"
                            >
                              {reqItems.map((item: ReqItem, itemIdx: number) => (
                                <ItemRowWrapper key={item.id} itemId={item.id}>
                                <div className={`rounded-lg px-4 py-3 text-sm mb-2 ${item.item_type === 'labor' ? 'bg-blue-50/60 border-l-4 border-blue-300' : 'bg-gray-50/60 border-l-4 border-gray-300'}`}>
                            {/* 移动端项目卡片 */}
                            <MobileItemEditor
                              item={item as unknown as ComponentProps<typeof MobileItemEditor>["item"]}
                              orderId={id}
                              profiles={(profiles || []) as unknown as ComponentProps<typeof MobileItemEditor>["profiles"]}
                              mechanicGroups={(mechanicGroups || []).map((g) => ({ id: g.id, name: g.name, members: g.mechanic_group_members || [] })) as unknown as ComponentProps<typeof MobileItemEditor>["mechanicGroups"]}
                              existingMechanics={(mechanicsByItem[item.id] || []) as unknown as ComponentProps<typeof MobileItemEditor>["existingMechanics"]}
                              images={imagesByItem[item.id]?.map((m) => m.storage_path).filter(Boolean) as string[] || []}
                              knowledgeUrl={
                                knowledgeByItem[item.id]?.[0]?.knowledge_articles?.id
                                  ? `/knowledge/${knowledgeByItem[item.id]?.[0]?.knowledge_articles?.id}`
                                  : undefined
                              }
                              isLocked={实际锁定}
                              parts={(partsByItem[item.id] || []).map((p: Record<string, unknown>) => ({
                                id: p.id as string,
                                name: (p.name as string) || (p.part_names as { name?: string } | null)?.name || "",
                                part_number: (p.part_number as string) || (p.parts as { part_number?: string } | null)?.part_number || "",
                                quantity: (p.quantity as number) || 1,
                                unit_price: (p.unit_price as number) || 0,
                                total_price: (p.total_price as number) || 0,
                                unit: (p.unit as string) || (p.part_names as { unit?: string } | null)?.unit || "件",
                                brand: (p.brand as string) || "",
                                specification: (p.specification as string) || "",
                                unit_cost: (p.unit_cost as number) || null,
                                customer_opinion: (p.customer_opinion as string) || null,
                                notes: (p.notes as string) || null,
                                part_id: (p.part_id as string) || null,
                                part_name_id: (p.part_name_id as string) || null,
                                branch_group_id: (p.branch_group_id as string) || null,
                                category: (p.part_names as { part_categories?: { name?: string } | null } | null)?.part_categories?.name || (p.parts as { part_categories?: { name?: string } | null } | null)?.part_categories?.name || null,
                                is_selected: (p.is_selected as boolean) || false,
                                document_name: (p.document_name as string) || null,
                                pickedQty: pickingByPart[p.id as string] || 0,
                              }))}
                              partInventory={inventoryByPart}
                              partImages={imagesByPart as unknown as ComponentProps<typeof MobileItemEditor>["partImages"]}
                              vehicleModelId={vehicleModelId ?? null}
                              existingOrder={
                                outsourceOrder?.outsource_order_items?.some(
                                  (oi) => oi.work_order_item_id === item.id
                                ) ? (outsourceOrder as unknown as NonNullable<ComponentProps<typeof MobileItemEditor>["existingOrder"]>) : null
                              }
                              existingItem={
                                (outsourceOrder?.outsource_order_items?.find(
                                  (oi) => oi.work_order_item_id === item.id
                                ) || null) as unknown as ComponentProps<typeof MobileItemEditor>["existingItem"]
                              }
                            />
                            {/* 桌面端横向布局 */}
                            <div className="hidden md:block overflow-x-auto relative">
                              <div className="flex items-center min-w-max">
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <SeqBadge itemId={item.id} 前缀={显示序号} />
                                  <ItemNameDisplay itemId={item.id} name={item.name || ""} aliasName={item.alias_name} />
                                  {/* 项目状态徽章：待派工/待施工/施工中/已中断/待质检/已完工（仅 labor 显示） */}
                                  <ItemStageBadge
                                    itemId={item.id}
                                    itemType={item.item_type}
                                    status={item.status}
                                    requireQc={item.require_qc}
                                    qcStatus={item.qc_status}
                                    customerOpinion={item.customer_opinion}
                                    初始已派工={(mechanicsByItem[item.id] || []).length > 0 || !!item.mechanic_id}
                                  />
                                  {/* 质检操作：仅待质检且质检人本人时显示按钮（组件内部自判断） */}
                                  {item.item_type === "labor" && (
                                    <ItemQcActions
                                      itemId={item.id}
                                      itemName={(item.alias_name || item.name) ?? ""}
                                      requireQc={item.require_qc}
                                      实际锁定={实际锁定}
                                    />
                                  )}
                                  <ItemPersonSelectors
                                    itemId={item.id}
                                    submitterId={item.submitter_id}
                                    mechanicId={item.mechanic_id}
                                    inspectorId={item.inspector_id}
                                    profiles={(profiles || []) as unknown as ComponentProps<typeof ItemPersonSelectors>["profiles"]}
                                    mechanicGroups={(mechanicGroups || []).map((g) => ({ id: g.id, name: g.name, members: g.mechanic_group_members || [] })) as unknown as ComponentProps<typeof ItemPersonSelectors>["mechanicGroups"]}
                                    existingMechanics={(mechanicsByItem[item.id] || []) as unknown as ComponentProps<typeof ItemPersonSelectors>["existingMechanics"]}
                                  />
                                  <div className="ml-6">
                                    <CustomerOpinionToggle itemId={item.id} opinion={item.customer_opinion ?? "pending"} />
                                  </div>
                                  <BusinessTypeToggle itemId={item.id} businessType={item.business_type || "normal"} disabled={实际锁定} />
                                  <div className="ml-4">
                                    <ItemFlagsToggle
                                      itemId={item.id}
                                      isOutsourced={item.is_outsourced ?? false}
                                      isCustomerPart={item.is_customer_part ?? false}
                                      serviceItemId={item.service_item_id}
                                      workOrderId={order.id}
                                      itemName={item.name ?? undefined}
                                      existingOrder={
                                        outsourceOrder?.outsource_order_items?.some(
                                          (oi) => oi.work_order_item_id === item.id
                                        ) ? (outsourceOrder as unknown as NonNullable<ComponentProps<typeof ItemFlagsToggle>["existingOrder"]>) : null
                                      }
                                      existingItem={
                                        (outsourceOrder?.outsource_order_items?.find(
                                          (oi) => oi.work_order_item_id === item.id
                                        ) || null) as unknown as ComponentProps<typeof ItemFlagsToggle>["existingItem"]
                                      }
                                    />
                                  </div>
                                  {knowledgeByItem[item.id]?.length > 0 ? (
                                    <Link
                                      href={`/knowledge/${knowledgeByItem[item.id]?.[0]?.knowledge_articles?.id}`}
                                      target="_blank"
                                      className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 ml-2"
                                    >
                                      维修指导
                                    </Link>
                                  ) : (
                                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-400 ml-2">维修指导</span>
                                  )}
                                  <div className="ml-4">
                                    <ItemNotesEditor itemId={item.id} description={item.description ?? null} />
                                  </div>
                                  <div className="ml-[10ch]">
                                    <ItemImageUploader
                                      itemId={item.id}
                                      existingImages={imagesByItem[item.id]?.map((m) => m.storage_path).filter(Boolean) as string[] || []}
                                      isLocked={实际锁定}
                                    />
                                  </div>
                                </div>
                                <div className="w-[10ch] flex-shrink-0" />
                                <div className={`flex items-center gap-2 flex-shrink-0 sticky right-0 pl-2 ${item.item_type === 'labor' ? 'bg-blue-50' : 'bg-gray-50'}`}>
                                  <AddItemPartButton
                                    itemId={item.id}
                                    serviceItemId={item.service_item_id}
                                    itemName={(item.alias_name || item.name) ?? ""}
                                    vehicleModelId={vehicleModelId ?? null}
                                    vin={vehicleVin ?? null}
                                  />
                                  <WorkOrderItemActions
                                    itemId={item.id}
                                    itemName={item.name ?? ""}
                                    aliasName={item.alias_name}
                                    quantity={item.quantity ?? undefined}
                                    unitPrice={item.unit_price ?? undefined}
                                    requireQc={item.require_qc}
                                  />
                                </div>
                              </div>
                            </div>
                            {/* 返工信息 */}
                            {item.business_type === 'rework' && (
                              <div className="text-xs space-y-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded text-[10px]">
                                    返工原因: {item.rework_reason === 'part_quality' ? '配件质量' : item.rework_reason === 'workmanship' ? '施工原因' : '未指定'}
                                  </span>
                                  {item.rework_loss_amount != null && item.rework_loss_amount > 0 && (
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
                              parts={(partsByItem[item.id] || []).map((p) => ({
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
                                  item as unknown as CommissionSource,
                                  item.service_items as unknown as CommissionSource | null,
                                  null,
                                  null,
                                  item.total_price || 0,
                                  0
                                );
                                if (comm.diagnosis === 0 && comm.repair === 0 && comm.sales === 0 && comm.qc === 0) return null;
                                return (
                                  <div className="hidden md:flex flex-wrap gap-2 text-xs">
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
                            {item.item_type === 'labor' && !实际锁定 && (
                              <ShowTimer>
                                <div className="hidden md:block">
                                  <ConstructionControls
                                    itemId={item.id}
                                    customerOpinion={item.customer_opinion}
                                    mechanics={(mechanicsByItem[item.id] || []).map((m) => ({ mechanic_id: m.mechanic_id || "", full_name: m.profiles?.full_name || "-" }))}
                                    初始已派工={(mechanicsByItem[item.id] || []).length > 0 || !!item.mechanic_id}
                                  />
                                </div>
                              </ShowTimer>
                            )}
                            {/* 项目所用配件（仅桌面端显示，移动端通过弹窗管理）。
                                 ItemPartsLive 包装：添加配件后只重查该项目配件，不整页刷新 */}
                            <ItemPartsLive
                              itemId={item.id}
                              orderId={id}
                              seqPrefix={`${显示序号}.${itemIdx + 1}`}
                              isLocked={实际锁定}
                              vehicleModelId={vehicleModelId}
                              suppliers={suppliers || []}
                              logisticsCompanies={logisticsCompanies || []}
                              pickingByPart={pickingByPart}
                              returnByPart={returnByPart}
                              inventoryByPart={inventoryByPart}
                              pendingSupplierReturnByPart={pendingSupplierReturnByPart}
                              imagesByPart={imagesByPart}
                            >
                            {(partGroupsByItem.get(item.id) || []).length > 0 && (
                              <div className="hidden md:block mt-3 ml-2 bg-white rounded-lg border border-gray-200 p-3 text-xs space-y-2 shadow-sm">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-1 h-4 bg-amber-400 rounded-full" />
                                  <span className="text-[11px] font-semibold text-gray-700">所用配件</span>
                                </div>
                                {(() => {
                                  const groups = partGroupsByItem.get(item.id) || [];
                                  const extraIdMap: Record<string, string[]> = {};
                                  for (const g of groups) extraIdMap[g.repId] = g.extraIds;
                                  return (
                                    <SortableList
                                      ids={groups.map((g) => g.repId)}
                                      groupKey={item.id}
                                      tableName="work_order_item_parts"
                                      extraIdMap={extraIdMap}
                                    >
                                      {groups.map((group, groupIdx) => (
                                        <ItemPartGroup
                                          key={group.repId}
                                          group={group}
                                          itemId={item.id}
                                          需求序号={显示序号}
                                          isLocked={实际锁定}
                                          vehicleModelId={vehicleModelId ?? undefined}
                                          suppliers={suppliers || []}
                                          logisticsCompanies={logisticsCompanies || []}
                                          pickingByPart={pickingByPart}
                                          returnByPart={returnByPart}
                                          inventoryByPart={inventoryByPart}
                                          pendingSupplierReturnByPart={pendingSupplierReturnByPart}
                                          imagesByPart={imagesByPart}
                                        />
                                      ))}
                                </SortableList>
                                  );
                                })()}
                              </div>
                            )}
                            </ItemPartsLive>
                                </div>
                                </ItemRowWrapper>
                              ))}
                            </SortableList>
                          );
                        })()}
                        {/* 新添加项目的追加区（局部更新，不整页刷新） */}
                        <LiveItemsList
                          reqId={req.id}
                          需求序号={显示序号}
                          初始项目数={(itemsByRequirement.get(req.id) || []).length}
                          已有项目IDs={(itemsByRequirement.get(req.id) || []).map((it: { id: string }) => it.id)}
                          orderId={id}
                          实际锁定={实际锁定}
                          profiles={profiles || []}
                          mechanicGroups={(mechanicGroups || []).map((g: { id: string; name: string; mechanic_group_members?: unknown[] }) => ({ id: g.id, name: g.name, members: g.mechanic_group_members || [] }))}
                          vehicleModelId={vehicleModelId}
                          vehicleVin={vehicleVin}
                          suppliers={suppliers || []}
                          logisticsCompanies={logisticsCompanies || []}
                        />
                      </div>
                </div>
                </RequirementRowWrapper>
                );
              })}
            </LiveRequirementsList>
          </div>

          {/* 接车照片 */}
          {(order.dashboard_photos?.length ?? 0) > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">接车照片</h2>
              </div>
              <div className="px-6 py-4 text-sm space-y-4">
                {(order.dashboard_photos?.length ?? 0) > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">仪表照片</div>
                    <div className="flex flex-wrap gap-2">
                      {(order.dashboard_photos || []).map((path: string, idx: number) => (
                        <img loading="lazy" key={idx} src={path} alt="" className="w-24 h-24 object-cover rounded border border-gray-200" />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 接车检查 */}
          {receptionInspections.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">接车检查</h2>
              </div>
              <div className="divide-y divide-gray-300">
                {receptionInspections.map((insp) => {
                  const media = mediaByInspection[insp.id] || [];
                  const receptionVideos = media.filter((m) => m.media_type === 'reception_video');
                  const exteriorPhotos = media.filter((m) => m.media_type === 'exterior');

                  return (
                    <div key={insp.id} className="px-6 py-4 text-sm space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">检查时间: {formatDate(insp.created_at ?? null)}</span>
                        {insp.notes && <span className="text-gray-400">备注: {insp.notes}</span>}
                      </div>

                      {receptionVideos.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">环车检查视频</div>
                          <div className="flex flex-wrap gap-2">
                            {receptionVideos.map((m, idx: number) => (
                              <LazyVideo key={idx} src={m.storage_path || ""} className="w-48 h-32 rounded border border-gray-200" />
                            ))}
                          </div>
                        </div>
                      )}

                      {exteriorPhotos.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">外观照片</div>
                          <div className="flex flex-wrap gap-2">
                            {exteriorPhotos.map((m, idx: number) => (
                              <img loading="lazy" key={idx} src={m.storage_path} alt="" className="w-20 h-20 object-cover rounded border border-gray-200" />
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
          {conditionInspections.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">车况检查</h2>
              </div>
              <div className="divide-y divide-gray-300">
                {conditionInspections.map((insp) => {
                  const media = mediaByInspection[insp.id] || [];
                  const oilBefore = media.find((m) => m.media_type === 'engine_oil_before');
                  const oilAfter = media.find((m) => m.media_type === 'engine_oil_after');
                  const fluidPhotos = media.filter((m) => m.media_type === 'fluid');
                  const exteriorPhotos = media.filter((m) => m.media_type === 'exterior');
                  const dashboardPhotos = media.filter((m) => m.media_type === 'dashboard');
                  const driveBeltPhotos = media.filter((m) => m.media_type === 'drive_belt');
                  const tirePhotos = media.filter((m) => m.media_type === 'tire');
                  const inspectionVideos = media.filter((m) => m.media_type === 'inspection_video');

                  return (
                    <div key={insp.id} className="px-6 py-4 text-sm space-y-4">
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                        <span className="text-gray-500">检查时间: {formatDate(insp.created_at ?? null)}</span>
                        {(insp.inspection_mileage != null || order.mileage_in != null) && (
                          <span className="text-gray-500">检查里程: <span className="font-medium text-gray-700">{insp.inspection_mileage ?? order.mileage_in} km</span></span>
                        )}
                        {(() => {
                          const submitter = (profiles || []).find((p) => p.id === insp.submitter_id);
                          return submitter ? <span className="text-gray-500">提交人: <span className="font-medium text-gray-700">{submitter.full_name}</span></span> : null;
                        })()}
                        {insp.notes && <span className="text-gray-400">备注: {insp.notes}</span>}
                      </div>

                      {/* 仪表检查 */}
                      {(dashboardPhotos.length > 0 || (insp.dashboard_fault_lights && insp.dashboard_fault_lights.length > 0)) && (
                        <div className="space-y-2">
                          {dashboardPhotos.length > 0 && (
                            <div>
                              <div className="text-xs text-gray-500 mb-1">仪表照片</div>
                              <div className="flex flex-wrap gap-2">
                                {dashboardPhotos.map((m, idx: number) => (
                                  <img loading="lazy" key={idx} src={m.storage_path} alt="" className="w-24 h-24 object-cover rounded border border-gray-200" />
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
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
                                    <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700">
                                      <FaultLightIcon type={light} className="w-3 h-3" />
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
                      <div className="space-y-3">
                        {/* 机油标尺数值 */}
                        {(insp.engine_oil_before_level != null || insp.engine_oil_after_level != null) && (
                          <div className="flex flex-wrap gap-4">
                            {insp.engine_oil_before_level != null && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">施工前油位:</span>
                                <div className="flex items-center gap-1.5">
                                  <div className="w-24 h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                                    <div
                                      className={`h-full rounded-full ${
                                        insp.engine_oil_before_level < 25
                                          ? 'bg-red-500'
                                          : insp.engine_oil_before_level > 80
                                          ? 'bg-amber-500'
                                          : 'bg-green-500'
                                      }`}
                                      style={{ width: `${insp.engine_oil_before_level}%` }}
                                    />
                                  </div>
                                  <span className={`text-sm font-semibold ${
                                    insp.engine_oil_before_level < 25
                                      ? 'text-red-600'
                                      : insp.engine_oil_before_level > 80
                                      ? 'text-amber-600'
                                      : 'text-green-600'
                                  }`}>
                                    {insp.engine_oil_before_level}%
                                  </span>
                                </div>
                              </div>
                            )}
                            {insp.engine_oil_after_level != null && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">施工后油位:</span>
                                <div className="flex items-center gap-1.5">
                                  <div className="w-24 h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                                    <div
                                      className={`h-full rounded-full ${
                                        insp.engine_oil_after_level < 25
                                          ? 'bg-red-500'
                                          : insp.engine_oil_after_level > 80
                                          ? 'bg-amber-500'
                                          : 'bg-green-500'
                                      }`}
                                      style={{ width: `${insp.engine_oil_after_level}%` }}
                                    />
                                  </div>
                                  <span className={`text-sm font-semibold ${
                                    insp.engine_oil_after_level < 25
                                      ? 'text-red-600'
                                      : insp.engine_oil_after_level > 80
                                      ? 'text-amber-600'
                                      : 'text-green-600'
                                  }`}>
                                    {insp.engine_oil_after_level}%
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {oilBefore && (
                            <div>
                              <div className="text-xs text-gray-500 mb-1">机油油位照片 - 施工前</div>
                              <div className="relative rounded border border-gray-200 overflow-hidden max-w-xs">
                                <img loading="lazy" src={oilBefore.storage_path} alt="机油施工前" className="w-full object-contain" />
                                {oilBefore.annotations && oilBefore.annotations.length > 0 && (
                                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                                    {oilBefore.annotations.map((line: { x1: number; y1: number; x2: number; y2: number }, idx: number) => (
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
                              <div className="text-xs text-gray-500 mb-1">机油油位照片 - 施工后</div>
                              <div className="relative rounded border border-gray-200 overflow-hidden max-w-xs">
                                <img loading="lazy" src={oilAfter.storage_path} alt="机油施工后" className="w-full object-contain" />
                                {oilAfter.annotations && oilAfter.annotations.length > 0 && (
                                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                                    {oilAfter.annotations.map((line: { x1: number; y1: number; x2: number; y2: number }, idx: number) => (
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
                      </div>

                      {/* 其它油液 */}
                      {fluidPhotos.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">其它油液</div>
                          <div className="flex flex-wrap gap-2">
                            {fluidPhotos.map((m, idx: number) => (
                              <img loading="lazy" key={idx} src={m.storage_path} alt="" className="w-20 h-20 object-cover rounded border border-gray-200" />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 传动皮带 */}
                      {(driveBeltPhotos.length > 0 || insp.drive_belt_status) && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">传动皮带</div>
                          {driveBeltPhotos.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2">
                              {driveBeltPhotos.map((m, idx: number) => (
                                <img loading="lazy" key={idx} src={m.storage_path} alt="" className="w-20 h-20 object-cover rounded border border-gray-200" />
                              ))}
                            </div>
                          )}
                          {insp.drive_belt_status && (<div className="flex items-center gap-2">
                            <span className="text-sm">状态:</span>
                            {(() => {
                              const map: Record<string, { text: string; class: string }> = {
                                good: { text: '良好', class: 'bg-green-50 text-green-700' },
                                fair: { text: '一般', class: 'bg-amber-50 text-amber-700' },
                                replace: { text: '需更换', class: 'bg-red-50 text-red-700' },
                              };
                              const s = map[insp.drive_belt_status];
                              return s ? <span className={`px-1.5 py-0.5 rounded text-[10px] ${s.class}`}>{s.text}</span> : null;
                            })()}
                          </div>)}
                        </div>
                      )}

                      {/* 轮胎检查 */}
                      {(tirePhotos.length > 0 || (insp.tire_checks && Object.keys(insp.tire_checks).length > 0)) && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">轮胎检查</div>
                          {tirePhotos.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2">
                              {tirePhotos.map((m, idx: number) => (
                                <img loading="lazy" key={idx} src={m.storage_path} alt="" className="w-20 h-20 object-cover rounded border border-gray-200" />
                              ))}
                            </div>
                          )}
                          {(() => {
                            /* 先取到局部变量，map 回调里才能保持非空收窄 */
                            const tireChecks = insp.tire_checks;
                            return tireChecks && (
                              <div className="flex flex-wrap gap-2">
                                {[
                                  { key: 'fl', label: '左前轮' },
                                  { key: 'fr', label: '右前轮' },
                                  { key: 'rl', label: '左后轮' },
                                  { key: 'rr', label: '右后轮' },
                                ].map((tire) => {
                                  const status = tireChecks[tire.key];
                                  if (!status) return null;
                                  const map: Record<string, { text: string; class: string }> = {
                                    good: { text: '良好', class: 'bg-green-50 text-green-700' },
                                    fair: { text: '一般', class: 'bg-amber-50 text-amber-700' },
                                    replace: { text: '需更换', class: 'bg-red-50 text-red-700' },
                                  };
                                  const s = map[status];
                                  return s ? (
                                    <span key={tire.key} className="inline-flex items-center gap-1 text-sm">
                                      <span className="text-gray-500">{tire.label}:</span>
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${s.class}`}>{s.text}</span>
                                    </span>
                                  ) : null;
                                })}
                              </div>
                            );
                          })()}
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

                      {/* 油液检测 */}
                      {(insp.coolant_ph != null || insp.brake_fluid_water != null) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {insp.coolant_ph != null && (
                            <div>
                              <div className="text-xs text-gray-500 mb-1">防冻液检测</div>
                              <div className="flex items-center gap-2 text-sm">
                                <span>PH: <span className="font-medium">{insp.coolant_ph}</span></span>
                                <span className="text-xs text-gray-400">(标准: 7.5~11.0)</span>
                                {(() => {
                                  const ph = insp.coolant_ph;
                                  if (ph >= 7.5 && ph <= 11.0) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-50 text-green-700">正常</span>;
                                  if (ph < 7.5) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700">酸性偏重</span>;
                                  return <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700">碱性过强</span>;
                                })()}
                              </div>
                            </div>
                          )}
                          {insp.brake_fluid_water != null && (
                            <div>
                              <div className="text-xs text-gray-500 mb-1">刹车油检测</div>
                              <div className="flex items-center gap-2 text-sm">
                                <span>含水量: <span className="font-medium">{insp.brake_fluid_water}%</span></span>
                                <span className="text-xs text-gray-400">(标准: ≤1%)</span>
                                {(() => {
                                  const w = insp.brake_fluid_water;
                                  if (w <= 1.0) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-50 text-green-700">良好</span>;
                                  if (w <= 2.0) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700">一般</span>;
                                  return <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700">需更换</span>;
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 蓄电池 */}
                      {(insp.battery_health != null || insp.battery_voltage != null) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {insp.battery_health != null && (
                            <div>
                              <div className="text-xs text-gray-500 mb-1">蓄电池寿命</div>
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-medium">{insp.battery_health}%</span>
                                {(() => {
                                  const h = insp.battery_health;
                                  if (h >= 80) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-50 text-green-700">良好</span>;
                                  if (h >= 50) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700">一般</span>;
                                  return <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700">建议更换</span>;
                                })()}
                              </div>
                            </div>
                          )}
                          {insp.battery_voltage != null && (
                            <div>
                              <div className="text-xs text-gray-500 mb-1">蓄电池电压</div>
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-medium">{insp.battery_voltage}V</span>
                                <span className="text-xs text-gray-400">(标准: 12.4~12.9V)</span>
                                {(() => {
                                  const v = insp.battery_voltage;
                                  if (v >= 12.4 && v <= 12.9) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-50 text-green-700">正常</span>;
                                  if (v < 12.4) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700">亏电</span>;
                                  return <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700">偏高</span>;
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 刹车片 */}
                      {(insp.front_brake_pad_thickness != null || insp.rear_brake_pad_thickness != null) && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">刹车片厚度</div>
                          <div className="space-y-1 text-sm">
                            {insp.front_brake_pad_thickness != null && (
                              <div className="flex items-center gap-2">
                                <span>前刹车片: <span className="font-medium">{insp.front_brake_pad_thickness} mm</span></span>
                                <span className="text-xs text-gray-400">(极限: 3mm)</span>
                                {(() => {
                                  const v = insp.front_brake_pad_thickness;
                                  if (v <= 3.0) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700">≤极限，建议更换</span>;
                                  if (v <= 4.0) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700">接近极限</span>;
                                  return <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-50 text-green-700">正常</span>;
                                })()}
                              </div>
                            )}
                            {insp.rear_brake_pad_thickness != null && (
                              <div className="flex items-center gap-2">
                                <span>后刹车片: <span className="font-medium">{insp.rear_brake_pad_thickness} mm</span></span>
                                <span className="text-xs text-gray-400">(极限: 2mm)</span>
                                {(() => {
                                  const v = insp.rear_brake_pad_thickness;
                                  if (v <= 2.0) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700">≤极限，建议更换</span>;
                                  if (v <= 3.0) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700">接近极限</span>;
                                  return <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-50 text-green-700">正常</span>;
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 尾气数据 — 竖排 + 标准值 */}
                      {(insp.exhaust_hc != null || insp.exhaust_co != null || insp.exhaust_no != null || insp.exhaust_co2 != null || insp.exhaust_o2 != null) && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">尾气数据</div>
                          <div className="space-y-1 text-sm max-w-sm">
                            {[
                              { key: 'hc', label: 'HC', unit: 'ppm', standard: '≤100', val: insp.exhaust_hc },
                              { key: 'co', label: 'CO', unit: '%', standard: '≤0.5', val: insp.exhaust_co },
                              { key: 'no', label: 'NO', unit: 'ppm', standard: '≤500', val: insp.exhaust_no },
                              { key: 'co2', label: 'CO₂', unit: '%', standard: '14~16', val: insp.exhaust_co2 },
                              { key: 'o2', label: 'O₂', unit: '%', standard: '0.5~2', val: insp.exhaust_o2 },
                            ].map((item) => (
                              item.val != null && (
                                <div key={item.key} className="flex items-center gap-3">
                                  <span className="w-10 font-medium">{item.label}</span>
                                  <span>{item.val} {item.unit}</span>
                                  <span className="text-xs text-gray-400">标准: {item.standard}</span>
                                </div>
                              )
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 外检照片 */}
                      {exteriorPhotos.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">外检照片</div>
                          <div className="flex flex-wrap gap-2">
                            {exteriorPhotos.map((m, idx: number) => (
                              <img loading="lazy" key={idx} src={m.storage_path} alt="" className="w-20 h-20 object-cover rounded border border-gray-200" />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 检查视频 */}
                      {inspectionVideos.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">检查视频</div>
                          <div className="flex flex-wrap gap-2">
                            {inspectionVideos.map((m, idx: number) => (
                              <LazyVideo key={idx} src={m.storage_path || ""} className="w-48 h-32 rounded border border-gray-200" />
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
              {qualityChecks?.map((qc) => (
                <div key={qc.id} className="flex items-start gap-3 text-sm">
                  <div className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${qc.result === 'passed' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div>
                    <span className="font-medium">{qc.result === 'passed' ? '质检通过' : '质检不合格'}</span>
                    <span className="text-gray-500 ml-2">{qc.profiles?.full_name} · {formatDate(qc.created_at ?? null)}</span>
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
          <WorkOrderActions orderId={id} status={order.status} 待结单就绪={待结单就绪} />

          {/* 待入库配件 */}
          {pendingInboundParts.length > 0 && (
            <div className="bg-white rounded-xl border border-orange-200 p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                待入库配件
              </h2>
              <div className="space-y-2">
                {pendingInboundParts.map((p) => (
                  <div key={p.id} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800">{p.name || p.part_names?.name || "未命名"}</span>
                      <Link
                        href={`/inventory/in?auto_fill=1&branch_id=${encodeURIComponent(p.id)}&part_number=${encodeURIComponent(p.part_number || '')}&name=${encodeURIComponent(p.name || p.part_names?.name || '')}&unit=${encodeURIComponent(p.unit || p.part_names?.unit || '')}&brand=${encodeURIComponent(p.brand || '')}&specification=${encodeURIComponent(p.specification || '')}&unit_cost=${p.unit_cost || ''}&supplier=${encodeURIComponent(p.supplier_name || '')}`}
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
              <div className="flex justify-between text-gray-600"><span>配件费用</span><span><PriceValue value={order.parts_cost ?? null} /></span></div>
              <div className="flex justify-between text-gray-600"><span>工时费用</span><span><PriceValue value={order.labor_cost ?? null} /></span></div>
              <div className="flex justify-between text-gray-600"><span>其他费用</span><span><PriceValue value={order.other_cost ?? null} /></span></div>
              <ShowCommission>
                {totalCommission > 0 && (
                  <div className="flex justify-between text-purple-600">
                    <span>预估总提成</span>
                    <span><PriceValue value={totalCommission} /></span>
                  </div>
                )}
              </ShowCommission>
              {(order.discount_amount || 0) > 0 && (
                <div className="flex justify-between text-orange-600"><span>整单优惠</span><span>-{formatCurrency(order.discount_amount ?? null)}</span></div>
              )}
              {(advancePaymentRecords || []).length > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-green-600">
                    <span>已预收</span>
                    <span>-{formatCurrency(advancePaymentTotal)}</span>
                  </div>
                  <div className="pl-3">
                    <AdvancePaymentList
                      records={(advancePaymentRecords || []) as unknown as ComponentProps<typeof AdvancePaymentList>["records"]}
                      orderId={id}
                      currentAdvancePayment={advancePaymentTotal}
                    />
                  </div>
                </div>
              )}
              <div className="border-t border-gray-100 pt-2 flex justify-between text-base font-bold text-gray-900">
                <span>应收合计</span>
                <span><PriceValue value={(order.total_cost ?? 0) - advancePaymentTotal} /></span>
              </div>
            </div>
          </div>

          {/* 支付记录 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">支付记录</h2>
            <div className="space-y-2">
              {payments?.map((p) => (
                <div key={p.id} className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    {p.method === 'cash' ? '现金' : p.method === 'wechat' ? '微信' : p.method === 'alipay' ? '支付宝' : p.method === 'credit' ? '挂账' : p.method === 'member' ? '会员' : '银行转账'}
                  </span>
                  <span className="font-medium text-gray-900">{formatCurrency(p.amount ?? null)}</span>
                </div>
              ))}
              {(!payments || payments.length === 0) && <p className="text-sm text-gray-400">暂无支付记录</p>}
            </div>
          </div>

          {/* 回访记录 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">回访记录</h2>
            <div className="space-y-3">
              {followUps?.map((fu) => {
                const isCompleted = !!fu.completed_at;
                const isOverdue = !isCompleted && (fu.scheduled_at as string) <= new Date().toISOString();
                return (
                  <div key={fu.id} className="flex items-start gap-3 text-sm">
                    <div className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${isCompleted ? 'bg-green-500' : isOverdue ? 'bg-red-500' : 'bg-blue-500'}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {isCompleted ? '已完成' : isOverdue ? '已逾期' : '待回访'}
                        </span>
                        <span className="text-gray-500">· {formatDate(fu.scheduled_at ?? null)}</span>
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
              {history?.map((h) => (
                <div key={h.id} className="flex gap-3 text-sm">
                  <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-500 shrink-0" />
                  <div>
                    <div className="text-gray-900">{h.from_status ? `${h.from_status} → ${h.to_status}` : `创建: ${h.to_status}`}</div>
                    <div className="text-xs text-gray-500">{formatDate(h.created_at ?? null)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <WorkOrderTotalFooter
        items={(items || []).map((it) => ({ id: it.id, total_price: it.total_price || 0 }))}
        parts={(itemParts || []).map((p) => ({
          id: p.id,
          itemId: p.work_order_item_id as string,
          unit_price: p.unit_price || 0,
          quantity: p.quantity || 1,
          is_selected: p.is_selected || false,
        }))}
        advancePaymentTotal={advancePaymentTotal}
      />
      <SavingToast />
      <WorkOrderRealtimeSync
        orderId={order.id}
        itemIds={items?.map((i) => i.id) || []}
        partIds={(itemParts || []).map((p) => p.id)}
      />
    </WorkOrderToggleProvider>
  );
}
