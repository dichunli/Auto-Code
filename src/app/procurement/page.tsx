import { PageHeader } from "@/components/PageHeader";
import { StickyPageHeader } from "@/components/StickyPageHeader";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PartBranchStatusList } from "@/components/PartBranchStatusList";
import { PendingPurchaseList } from "@/components/PendingPurchaseList";
import { PendingReceiptList } from "@/components/PendingReceiptList";
import { PendingStorageList } from "@/components/PendingStorageList";
import { CompletedStorageList } from "@/components/CompletedStorageList";
import { PendingReturnList } from "@/components/PendingReturnList";
import { CompletedReturnList } from "@/components/CompletedReturnList";
import { ProcurementTabBar } from "@/components/ProcurementTabBar";
import { BrowserNotificationToggle } from "@/components/BrowserNotificationToggle";
import { MobileReceivingOrders, 待收订单, 待签收运单 } from "@/components/mobile/MobileReceivingOrders";
/* 首屏数据的行类型直接从各列表组件导入（type-only，服务端可用） */
import type { PartBranchRow as 待采购行, Supplier as 待采购供应商, LogisticsCompany as 物流公司 } from "@/components/PendingPurchaseList";
import type { PurchaseOrder as 待收货采购单 } from "@/components/PendingReceiptList";
import type { PurchaseOrder as 待入库采购单, 到货单 } from "@/components/PendingStorageList";
import type { PurchaseOrder as 已入库采购单 } from "@/components/CompletedStorageList";
import type { ReturnRecord as 待退货记录 } from "@/components/PendingReturnList";
import type { ReturnRecord as 已退货记录 } from "@/components/CompletedReturnList";
import type { PartBranchRow as 分支行, Supplier as 分支供应商 } from "@/components/PartBranchStatusList";

type ProcurementTab =
  | "pending_inquiry"
  | "pending_quote"
  | "pending_confirm"
  | "pending_purchase"
  | "pending_receipt"
  | "pending_storage"
  | "completed_storage"
  | "pending_return"
  | "completed_return"
  | "inbound_orders"
  | "return_orders";

export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const currentTab: ProcurementTab = [
    "pending_inquiry",
    "pending_quote",
    "pending_confirm",
    "pending_purchase",
    "pending_receipt",
    "pending_storage",
    "completed_storage",
    "pending_return",
    "completed_return",
    "inbound_orders",
    "return_orders",
  ].includes(sp.tab as ProcurementTab)
    ? (sp.tab as ProcurementTab)
    : "pending_inquiry";

  /* 手机端待收货（2026-08-21 需求1/4）：md 以下直接用移动版竖排卡片组件，
     消除表格左右滑屏；数据服务端首屏查询（与 /m/receiving/orders 同口径） */
  let 手机待收订单: 待收订单[] = [];
  let 手机待签收运单: 待签收运单[] = [];
  /* 桌面端待收货列表首屏（待办清单第9项）：与 PendingReceiptList.loadData 同口径 */
  let 待收货桌面订单: 待收货采购单[] | undefined;
  if (currentTab === "pending_receipt") {
    const supabase = await createClient();
    const [{ data: orders }, { data: waybills }, { data: desktopData }] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select(`
          id, order_no, status, created_at, supplier_id, waybill_id, waybill_exempt, supplier_order_no, supplier_order_amount, supplier_slip_photos,
          suppliers(name, region),
          logistics_waybills:waybill_id(id, tracking_no, logistics_company_name, logistics_companies(name)),
          purchase_order_items(
            id, name, brand, specification, quantity, unit, notes, photos,
            part_id, part_number, supplier_part_name, handle_action, waybill_id, waybill_exempt, staged_qty, staged_action, staged_at
          )
        `)
        .in("status", ["submitted", "approved", "partial_received"])
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("logistics_waybills")
        .select("id, tracking_no, supplier_name, logistics_company_name, logistics_companies(name)")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("purchase_orders")
        .select(`
          id, order_no, supplier_id, status, total_amount, notes, waybill_id, waybill_exempt, created_at, logistics_company_id,
          supplier_order_no, supplier_order_amount, supplier_slip_photos,
          suppliers(id, name, region, phone),
          logistics_companies:logistics_company_id(name),
          purchase_order_items(
            id, name, brand, specification, quantity, unit_cost, received_qty,
            part_id, work_order_item_part_id, part_number, supplier_part_name,
            unit, category, license_plate, photos, notes, handle_action,
            discount_amount, evidence_photos, return_reason, waybill_id, waybill_exempt
          ),
          logistics_waybills:waybill_id(
            id, tracking_no, logistics_company_name, freight_amount, cod_amount, status,
            logistics_companies(name)
          )
        `)
        .in("status", ["submitted", "approved", "partial_received"])
        .order("created_at", { ascending: false }),
    ]);
    手机待收订单 = ((orders || []) as unknown) as 待收订单[];
    手机待签收运单 = ((waybills || []) as unknown) as 待签收运单[];
    /* 只显示还有未处理明细的订单 */
    待收货桌面订单 = ((desktopData || []) as unknown as 待收货采购单[]).filter((order) =>
      (order.purchase_order_items || []).some((it) => !it.handle_action)
    );
  }

  /* ═══ 其余 tab 桌面端列表首屏数据（待办清单第9项）═══
   * 原来这些列表组件在客户端 useEffect 里首次拉数据，SPA 软导航 session 未就绪会整页空白；
   * 首屏查询搬到服务端（查询条件与各组件 loadData 原样一致），通过 props 注入；
   * 组件拿到 initialXxx 就跳过首次 loadData，后续操作仍走客户端 loadData 刷新 */

  /* 待询价 / 待报价 / 待确认（PartBranchStatusList，按 tab 过滤口径不同） */
  let 分支首屏: {
    rows: 分支行[];
    suppliers: 分支供应商[];
    partMediaMap: Record<string, { id: string; storage_path: string }[]>;
    vehicleModelsMap: Record<string, { 厂商?: string; 品牌?: string; 车系?: string }>;
    supplierVehicleMap: Record<string, string[]>;
    availableBrands: string[];
    availableSpecs: string[];
    partBrandsMap: Record<string, string>;
    supplierPartNameIds: Record<string, string[]>;
    supplierPartCategoryIds: Record<string, string[]>;
    supplierPartBrandIds: Record<string, string[]>;
  } | undefined;
  if (
    currentTab === "pending_inquiry" ||
    currentTab === "pending_quote" ||
    currentTab === "pending_confirm"
  ) {
    const status = currentTab;
    const supabase = await createClient();
    const [
      { data: parts },
      { data: sups },
      { data: brandList },
      { data: specList },
      { data: spn },
      { data: spc },
      { data: spb },
    ] = await Promise.all([
      supabase
        .from("work_order_item_parts")
        .select(`
          id, name, brand, specification, unit, quantity, unit_cost, unit_price,
          customer_opinion, supplier_name, is_purchased, is_arrived,
          work_order_item_id, part_name_id, branch_group_id, part_id, part_number, notes, document_name,
          part_names(name, category_id, part_categories(name)),
          parts(
            id, part_number, name, quantity, unit_cost, unit_price, notes, document_name,
            part_brands(name),
            part_specifications(name),
            part_images(storage_path)
          ),
          work_order_items(
            name,
            work_orders(
              id, order_no, settled_at, order_type,
              customers(id, name, phone, company),
              vehicles(id, plate_number, vin, vehicle_model_id)
            )
          )
        `)
        .order("created_at", { ascending: true })
        .limit(1000),
      supabase.from("suppliers").select("id, name, recommendation_level").order("name"),
      supabase.from("part_brands").select("id, name"),
      supabase.from("part_specifications").select("name"),
      supabase.from("supplier_part_names").select("supplier_id, part_name_id"),
      supabase.from("supplier_part_categories").select("supplier_id, part_category_id"),
      supabase.from("supplier_part_brands").select("supplier_id, part_brand_id"),
    ]);

    /* 状态过滤规则与 PartBranchStatusList.loadData 原样一致 */
    const filtered = ((parts || []) as unknown as 分支行[]).filter((r) => {
      const wo = r.work_order_items?.work_orders;
      if (!wo) return false;
      if (wo.settled_at) return false;
      if (wo.order_type === "cancelled") return false;
      /* 保养单不走询价/报价等采购流程 */
      if (wo.order_type === "maintenance") return false;
      if (r.is_purchased || r.is_arrived) return false;
      const cost = Number(r.unit_cost || 0);
      const price = Number(r.unit_price || 0);
      const opinion = r.customer_opinion || "pending";
      if (status === "pending_inquiry") return cost <= 0;
      if (status === "pending_quote") return cost > 0 && price <= 0;
      if (status === "pending_confirm") return cost > 0 && price > 0 && opinion === "pending";
      return false;
    });

    /* 配件分支图片 */
    const partIds = filtered.map((p) => p.id);
    const { data: partMediaData } = partIds.length > 0
      ? await supabase.from("work_order_item_part_media").select("id, work_order_item_part_id, storage_path").in("work_order_item_part_id", partIds)
      : { data: [] as { id: string; work_order_item_part_id: string; storage_path: string }[] };
    const partMediaMap: Record<string, { id: string; storage_path: string }[]> = {};
    for (const m of partMediaData || []) {
      if (!partMediaMap[m.work_order_item_part_id]) partMediaMap[m.work_order_item_part_id] = [];
      partMediaMap[m.work_order_item_part_id].push({ id: m.id, storage_path: m.storage_path });
    }

    /* 车型匹配数据（vehicle_models.id 是 INTEGER，组件内按 String(id) 建 Map） */
    const vehicleModelIds = [...new Set(filtered.map((r) => r.work_order_items?.work_orders?.vehicles?.vehicle_model_id).filter(Boolean))];
    const vehicleModelsMap: Record<string, { 厂商?: string; 品牌?: string; 车系?: string }> = {};
    const supplierVehicleMap: Record<string, string[]> = {};
    if (vehicleModelIds.length > 0) {
      const [{ data: vmList }, { data: svmList }] = await Promise.all([
        supabase.from("vehicle_models").select("id, 厂商, 品牌, 车系").in("id", vehicleModelIds),
        supabase.from("supplier_vehicle_models").select("supplier_id, vehicle_model_id").in("vehicle_model_id", vehicleModelIds),
      ]);
      for (const v of (vmList || []) as unknown as { id: number; 厂商?: string; 品牌?: string; 车系?: string }[]) {
        vehicleModelsMap[String(v.id)] = { 厂商: v.厂商, 品牌: v.品牌, 车系: v.车系 };
      }
      for (const r of (svmList || []) as { supplier_id: string; vehicle_model_id: number }[]) {
        if (!supplierVehicleMap[r.supplier_id]) supplierVehicleMap[r.supplier_id] = [];
        supplierVehicleMap[r.supplier_id].push(String(r.vehicle_model_id));
      }
    }

    /* 供应商关联数据：组件里是 Map<string, Set<string>>，这里以 Record<string, string[]> 传入（可序列化） */
    const supplierPartNameIds: Record<string, string[]> = {};
    for (const r of (spn || []) as { supplier_id: string; part_name_id: string }[]) {
      if (!supplierPartNameIds[r.supplier_id]) supplierPartNameIds[r.supplier_id] = [];
      supplierPartNameIds[r.supplier_id].push(String(r.part_name_id));
    }
    const supplierPartCategoryIds: Record<string, string[]> = {};
    for (const r of (spc || []) as { supplier_id: string; part_category_id: string }[]) {
      if (!supplierPartCategoryIds[r.supplier_id]) supplierPartCategoryIds[r.supplier_id] = [];
      supplierPartCategoryIds[r.supplier_id].push(String(r.part_category_id));
    }
    const supplierPartBrandIds: Record<string, string[]> = {};
    for (const r of (spb || []) as { supplier_id: string; part_brand_id: string }[]) {
      if (!supplierPartBrandIds[r.supplier_id]) supplierPartBrandIds[r.supplier_id] = [];
      supplierPartBrandIds[r.supplier_id].push(String(r.part_brand_id));
    }

    分支首屏 = {
      rows: filtered,
      suppliers: (sups || []) as 分支供应商[],
      partMediaMap,
      vehicleModelsMap,
      supplierVehicleMap,
      availableBrands: (brandList || []).map((b: { name: string }) => b.name).filter(Boolean),
      availableSpecs: [...new Set((specList || []).map((s: { name: string }) => s.name).filter(Boolean))],
      partBrandsMap: Object.fromEntries((brandList || []).map((b: { name: string; id: string }) => [b.name, String(b.id)])),
      supplierPartNameIds,
      supplierPartCategoryIds,
      supplierPartBrandIds,
    };
  }

  /* 待采购（与 PendingPurchaseList.loadData 同口径：工单配件行 + 自定义采购暂存行合并） */
  let 待采购首屏: {
    rows: 待采购行[];
    suppliers: 待采购供应商[];
    logisticsCompanies: 物流公司[];
    notArrivedMarks: Record<string, string>;
  } | undefined;
  if (currentTab === "pending_purchase") {
    const supabase = await createClient();
    const [{ data: parts }, { data: sups }, { data: logistics }, { data: stagingData }] = await Promise.all([
      supabase
        .from("work_order_item_parts")
        .select(`
          id, name, brand, specification, unit, quantity, unit_cost, unit_price,
          customer_opinion, supplier_name, part_id, part_number, part_name_id,
          alias_name, notes, purchase_reason, work_order_item_id, document_name,
          work_order_items(
            name,
            work_orders(
              id, order_no, settled_at, order_type,
              customers(name, phone),
              vehicles(plate_number, vin)
            )
          ),
          parts(quantity)
        `)
        .eq("customer_opinion", "agree")
        .eq("is_purchased", false)
        .order("created_at", { ascending: true })
        .limit(1000),
      supabase.from("suppliers").select("id, name, region").order("name"),
      supabase.from("logistics_companies").select("id, name, scopes").order("name"),
      supabase
        .from("custom_purchase_staging")
        .select("id, part_id, part_number, name, brand, specification, document_name, unit, unit_cost, quantity, supplier_id, supplier_name, parts(quantity)")
        .order("created_at", { ascending: true }),
    ]);

    const filtered = ((parts || []) as unknown as 待采购行[]).filter((r) => {
      const wo = r.work_order_items?.work_orders;
      if (!wo) return false;
      if (wo.settled_at) return false;
      if (wo.order_type === "cancelled") return false;
      /* 保养单不走采购流程 */
      if (wo.order_type === "maintenance") return false;
      const cost = Number(r.unit_cost || 0);
      const price = Number(r.unit_price || 0);
      if (cost <= 0 || price <= 0) return false;
      const inventoryQty = Number(r.parts?.quantity || 0);
      if (r.part_id && inventoryQty > 0) return false;
      return true;
    });

    /* 未到货标记 */
    const { data: markData } = await supabase
      .from("purchase_order_items")
      .select("work_order_item_part_id, not_arrived_reason")
      .in("not_arrived_reason", ["欠发货已入库", "漏发，重新补发"]);
    const marks: Record<string, string> = {};
    for (const m of (markData || []) as { work_order_item_part_id: string | null; not_arrived_reason: string | null }[]) {
      if (m.work_order_item_part_id && m.not_arrived_reason) {
        marks[m.work_order_item_part_id] = m.not_arrived_reason;
      }
    }

    /* 自定义采购暂存行转成统一的行结构（无工单字段） */
    interface 暂存行 {
      id: string;
      part_id: string | null;
      part_number: string | null;
      name: string;
      brand: string | null;
      specification: string | null;
      document_name: string | null;
      unit: string | null;
      unit_cost: number | null;
      quantity: number;
      supplier_id: string | null;
      supplier_name: string | null;
      parts: { quantity: number | null } | { quantity: number | null }[] | null;
    }
    const 暂存行列表: 待采购行[] = ((stagingData || []) as unknown as 暂存行[]).map((s): 待采购行 => {
      const p = Array.isArray(s.parts) ? s.parts[0] : s.parts;
      return {
        id: s.id,
        name: s.name,
        brand: s.brand,
        specification: s.specification,
        unit: s.unit,
        quantity: s.quantity,
        unit_cost: s.unit_cost,
        unit_price: null,
        customer_opinion: null,
        supplier_name: s.supplier_name,
        part_id: s.part_id,
        part_number: s.part_number,
        part_name_id: null,
        alias_name: null,
        document_name: s.document_name,
        notes: null,
        purchase_reason: null,
        work_order_item_id: "",
        work_order_items: null,
        parts: p ? { quantity: p.quantity } : null,
        staging: { id: s.id, supplier_id: s.supplier_id },
      };
    });

    待采购首屏 = {
      rows: [...filtered, ...暂存行列表],
      suppliers: (sups || []) as 待采购供应商[],
      logisticsCompanies: (logistics || []) as 物流公司[],
      notArrivedMarks: marks,
    };
  }

  /* 待入库（与 PendingStorageList.loadData 同口径：老流程单 + 已确认到货单） */
  let 待入库首屏: { orders: 待入库采购单[]; arrivalReceipts: 到货单[] } | undefined;
  if (currentTab === "pending_storage") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("purchase_orders")
      .select(`
        id, order_no, supplier_id, status, total_amount, notes, created_at,
        supplier_order_no, supplier_order_amount, supplier_slip_photos,
        suppliers(id, name),
        purchase_order_items(
          id, name, brand, specification, quantity, unit_cost, received_qty,
          part_id, work_order_item_part_id, part_number, supplier_part_name,
          unit, category, license_plate, photos, notes,
          handle_action, discount_amount, evidence_photos, return_reason, arrival_item_id
        )
      `)
      .eq("status", "pending_storage")
      .order("created_at", { ascending: false });
    /* 走过到货确认单的采购单不进老入库列表 */
    const 老流程单 = ((data || []) as unknown as 待入库采购单[]).filter(
      (o) => !(o.purchase_order_items || []).some((it) => it.arrival_item_id)
    );
    const { data: 到货单数据 } = await supabase
      .from("arrival_receipts")
      .select("id, receipt_no, supplier_order_no, supplier_order_amount, suppliers(name), logistics_waybills(tracking_no, freight_amount), arrival_receipt_items(count)")
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: false });
    待入库首屏 = { orders: 老流程单, arrivalReceipts: ((到货单数据 || []) as unknown) as 到货单[] };
  }

  /* 已入库（与 CompletedStorageList.loadData 同口径） */
  let 已入库首屏订单: 已入库采购单[] | undefined;
  if (currentTab === "completed_storage") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("purchase_orders")
      .select(`
        id, order_no, supplier_id, status, total_amount, notes, created_at,
        suppliers(id, name),
        purchase_order_items(
          id, name, brand, specification, quantity, unit_cost, received_qty,
          part_id, work_order_item_part_id, part_number, supplier_part_name,
          unit, category, license_plate, photos, notes
        ),
        inbound_orders(id, inbound_no, total_quantity, total_amount, created_at)
      `)
      .eq("status", "completed")
      .order("created_at", { ascending: false });
    已入库首屏订单 = (data || []) as unknown as 已入库采购单[];
  }

  /* 待退货（与 PendingReturnList.loadData 同口径） */
  let 待退货首屏记录: 待退货记录[] | undefined;
  if (currentTab === "pending_return") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("supplier_return_records")
      .select(
        "id, supplier_name, return_reason, quantity, logistics_company, tracking_no, photos, status, created_at, work_order_item_parts(id, name, part_number, part_id, brand, specification, unit, unit_cost, notes, document_name), profiles(full_name)"
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    待退货首屏记录 = (data || []) as unknown as 待退货记录[];
  }

  /* 已退货（与 CompletedReturnList.loadData 同口径） */
  let 已退货首屏记录: 已退货记录[] | undefined;
  if (currentTab === "completed_return") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("supplier_return_records")
      .select(
        "id, supplier_name, return_reason, quantity, logistics_company, tracking_no, photos, status, created_at, work_order_item_parts(id, name, part_number, document_name), profiles(full_name), purchase_return_orders(id, return_no)"
      )
      .eq("status", "completed")
      .order("created_at", { ascending: false });
    已退货首屏记录 = (data || []) as unknown as 已退货记录[];
  }

  return (
    <div>
      {/* 冻结页头：标题 + 按钮区 + Tab 行，滚动时固定不动。
          2026-08-20 需求8：手机端只做收货，副标题/导航按钮/Tab 卡片全部隐藏（md 起恢复显示） */}
      <StickyPageHeader>
      <PageHeader
        title="采购管理"
        description="按阶段集中处理工单配件的采购流转"
        descriptionClassName="hidden md:block"
        className="hidden md:flex"
      />
      {/* 手机端标题（2026-08-21 需求1）：手机打开本页就是收货场景，直接显示"待收货" */}
      <div className="md:hidden mb-4">
        <h1 className="text-2xl font-bold text-gray-900">待收货</h1>
      </div>

      {/* 顶部按钮区：手机端隐藏 */}
      <div className="hidden md:flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap gap-2 flex-1">
        <Link
          href="/procurement/orders"
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          采购订单
        </Link>
        <Link
          href="/suppliers"
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          供应商管理
        </Link>
        <Link
          href="/inventory/in"
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          入库登记
        </Link>
        <Link
          href="/supplier-returns"
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          退货记录
        </Link>
        <Link
          href="/supplier-transactions"
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          往来款项
        </Link>
        <Link
          href="/logistics"
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          物流运单
        </Link>
        </div>
        <BrowserNotificationToggle />
      </div>

      {/* Tab 行：手机端隐藏，手机打开本页固定显示 URL tab 参数对应的内容 */}
      <div className="hidden md:block">
        <ProcurementTabBar currentTab={currentTab} />
      </div>
      </StickyPageHeader>

      {/* 内容区（key={currentTab} 让 tab 切换时列表组件整体重挂载，新首屏 props 生效） */}
      {(currentTab === "pending_inquiry" ||
        currentTab === "pending_quote" ||
        currentTab === "pending_confirm") && (
        <PartBranchStatusList
          key={currentTab}
          status={currentTab}
          initialRows={分支首屏?.rows}
          initialSuppliers={分支首屏?.suppliers}
          initialPartMediaMap={分支首屏?.partMediaMap}
          initialVehicleModelsMap={分支首屏?.vehicleModelsMap}
          initialSupplierVehicleMap={分支首屏?.supplierVehicleMap}
          initialAvailableBrands={分支首屏?.availableBrands}
          initialAvailableSpecs={分支首屏?.availableSpecs}
          initialPartBrandsMap={分支首屏?.partBrandsMap}
          initialSupplierPartNameIds={分支首屏?.supplierPartNameIds}
          initialSupplierPartCategoryIds={分支首屏?.supplierPartCategoryIds}
          initialSupplierPartBrandIds={分支首屏?.supplierPartBrandIds}
        />
      )}
      {currentTab === "pending_purchase" && (
        <PendingPurchaseList
          key={currentTab}
          initialRows={待采购首屏?.rows}
          initialSuppliers={待采购首屏?.suppliers}
          initialLogisticsCompanies={待采购首屏?.logisticsCompanies}
          initialNotArrivedMarks={待采购首屏?.notArrivedMarks}
        />
      )}
      {/* 待收货（2026-08-21 需求4）：桌面端表格版 / 手机端竖排卡片版，同一 URL 按屏幕宽度自动切换 */}
      {currentTab === "pending_receipt" && (
        <>
          <div className="hidden md:block"><PendingReceiptList key={currentTab} initialOrders={待收货桌面订单} /></div>
          <div className="md:hidden">
            <MobileReceivingOrders 订单列表={手机待收订单} 待签收运单={手机待签收运单} />
          </div>
        </>
      )}
      {currentTab === "pending_storage" && (
        <PendingStorageList
          key={currentTab}
          initialOrders={待入库首屏?.orders}
          initialArrivalReceipts={待入库首屏?.arrivalReceipts}
        />
      )}
      {currentTab === "completed_storage" && (
        <CompletedStorageList key={currentTab} initialOrders={已入库首屏订单} />
      )}
      {currentTab === "pending_return" && (
        <PendingReturnList key={currentTab} initialRecords={待退货首屏记录} />
      )}
      {currentTab === "completed_return" && (
        <CompletedReturnList key={currentTab} initialRecords={已退货首屏记录} />
      )}
    </div>
  );
}
