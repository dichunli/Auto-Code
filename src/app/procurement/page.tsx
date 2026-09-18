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
import { 待采购查询字段, 待收货查询字段 } from "@/lib/procurementRules";
import { BrowserNotificationToggle } from "@/components/BrowserNotificationToggle";
import { MobileReceivingOrders, 待收订单, 待签收运单 } from "@/components/mobile/MobileReceivingOrders";
/* 首屏数据的行类型直接从各列表组件导入（type-only，服务端可用） */
import type { PartBranchRow as 待采购行, Supplier as 待采购供应商, LogisticsCompany as 物流公司 } from "@/components/PendingPurchaseList";
import type { PurchaseOrder as 待收货采购单 } from "@/components/PendingReceiptList";
import type { PurchaseOrder as 待入库采购单, 到货单 } from "@/components/PendingStorageList";
import { 查询批次卡片, type 批次卡片 } from "@/lib/batchCards";
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
  /* 桌面端待收货列表首屏（待办清单第9项）：与 PendingReceiptList.loadData 同口径。
     2026-09-15 起两阶段分页：先取"有未处理明细"的订单 id 集合，再主表 count+range 取第 1 页 */
  let 待收货桌面订单: 待收货采购单[] | undefined;
  let 待收货总数 = 0;
  if (currentTab === "pending_receipt") {
    const supabase = await createClient();
    const { data: 明细ids } = await supabase
      .from("purchase_order_items")
      .select("order_id, purchase_orders!inner(status)")
      .or("handle_action.is.null,handle_action.eq.")
      .in("purchase_orders.status", ["submitted", "approved", "partial_received"]);
    const 合格ids = [...new Set((明细ids || []).map((r) => r.order_id as string))];

    const [{ data: orders }, { data: waybills }, { data: desktopData, count: desktopCount }] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select(`
          id, order_no, status, created_at, supplier_id, waybill_id, waybill_exempt, supplier_order_no, supplier_order_amount, supplier_slip_photos,
          suppliers(name, region),
          logistics_waybills:waybill_id(id, tracking_no, logistics_company_name, logistics_companies(name)),
          purchase_order_items(
            id, name, brand, specification, quantity, unit, notes, photos,
            part_id, part_number, supplier_part_name, handle_action, waybill_id, waybill_exempt, staged_qty, staged_action, staged_at, staged_by
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
      合格ids.length > 0
        ? supabase
            .from("purchase_orders")
            .select(待收货查询字段, { count: "exact" })
            .in("id", 合格ids)
            .order("created_at", { ascending: false })
            .range(0, 19)
        : Promise.resolve({ data: [], count: 0, error: null }),
    ]);
    手机待收订单 = ((orders || []) as unknown) as 待收订单[];
    手机待签收运单 = ((waybills || []) as unknown) as 待签收运单[];
    /* 阶段1已按"还有未处理明细"过滤 id 集合，阶段2直接取数即可 */
    待收货桌面订单 = (desktopData || []) as unknown as 待收货采购单[];
    待收货总数 = desktopCount || 0;
  }

  /* ═══ 其余 tab 桌面端列表首屏数据（待办清单第9项）═══
   * 原来这些列表组件在客户端 useEffect 里首次拉数据，SPA 软导航 session 未就绪会整页空白；
   * 首屏查询搬到服务端（查询条件与各组件 loadData 原样一致），通过 props 注入；
   * 组件拿到 initialXxx 就跳过首次 loadData，后续操作仍走客户端 loadData 刷新 */

  /* 待询价 / 待报价 / 待确认（PartBranchStatusList，按 tab 过滤口径不同）
     2026-09-15 起两阶段分页：先按当前阶段谓词下推取合格 id 集合（与组件 loadData 严格同口径），
     再主表 count+range 取第 1 页 */
  let 分支首屏: {
    rows: 分支行[];
    totalCount: number;
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
    /* 阶段1：谓词下推轻量取 id（门禁 + 阶段条件，与 PartBranchStatusList.loadData 严格同口径；
       连续 .or() 在 PostgREST 里是 AND 关系） */
    let 阶段一查询 = supabase
      .from("work_order_item_parts")
      .select("id, work_order_items!inner(work_orders!inner(settled_at, order_type))")
      .is("work_order_items.work_orders.settled_at", null)
      .not("work_order_items.work_orders.order_type", "in", '("cancelled","maintenance")')
      .or("is_purchased.is.null,is_purchased.eq.false")
      .or("is_arrived.is.null,is_arrived.eq.false");
    if (status === "pending_inquiry") {
      阶段一查询 = 阶段一查询.or("unit_cost.is.null,unit_cost.lte.0");
    } else if (status === "pending_quote") {
      阶段一查询 = 阶段一查询.gt("unit_cost", 0).or("unit_price.is.null,unit_price.lte.0");
    } else {
      阶段一查询 = 阶段一查询
        .gt("unit_cost", 0)
        .gt("unit_price", 0)
        .or("customer_opinion.is.null,customer_opinion.eq.pending");
    }
    const [
      { data: idRows },
      { data: sups },
      { data: brandList },
      { data: specList },
      { data: spn },
      { data: spc },
      { data: spb },
    ] = await Promise.all([
      阶段一查询,
      supabase.from("suppliers").select("id, name, recommendation_level").order("name"),
      supabase.from("part_brands").select("id, name"),
      supabase.from("part_specifications").select("name"),
      supabase.from("supplier_part_names").select("supplier_id, part_name_id"),
      supabase.from("supplier_part_categories").select("supplier_id, part_category_id"),
      supabase.from("supplier_part_brands").select("supplier_id, part_brand_id"),
    ]);
    const 合格ids = [...new Set((idRows || []).map((r) => r.id as string))];

    /* 阶段2：完整 select + count + 第 1 页（合格 id 为空时跳过，in 空列表会报错） */
    let filtered: 分支行[] = [];
    let 分支总数 = 0;
    if (合格ids.length > 0) {
      const { data, count } = await supabase
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
        `, { count: "exact" })
        .in("id", 合格ids)
        .order("created_at", { ascending: true })
        .range(0, 19);
      filtered = (data || []) as unknown as 分支行[];
      分支总数 = count || 0;
    }

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
      totalCount: 分支总数,
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

  /* 待采购（与 PendingPurchaseList.loadData 同口径：工单配件行 + 自定义采购暂存行合并）
     2026-09-15 起工单配件行两阶段分页：先按待采购谓词取合格 id 集合（无库存关联直接合格 /
     关联且库存 ≤0 合格），再主表 count+range 取第 1 页；自定义暂存行不参与分页照旧全量 */
  let 待采购首屏: {
    rows: 待采购行[];
    totalCount: number;
    suppliers: 待采购供应商[];
    logisticsCompanies: 物流公司[];
    notArrivedMarks: Record<string, string>;
  } | undefined;
  if (currentTab === "pending_purchase") {
    const supabase = await createClient();
    const [
      { data: 无关联行 },
      { data: 有关联行 },
      { data: sups },
      { data: logistics },
      { data: stagingData },
    ] = await Promise.all([
      supabase
        .from("work_order_item_parts")
        .select("id, work_order_items!inner(work_orders!inner(settled_at, order_type))")
        .eq("customer_opinion", "agree")
        .eq("is_purchased", false)
        .is("work_order_items.work_orders.settled_at", null)
        .not("work_order_items.work_orders.order_type", "in", '("cancelled","maintenance")')
        .gt("unit_cost", 0)
        .gt("unit_price", 0)
        .is("part_id", null),
      supabase
        .from("work_order_item_parts")
        .select("id, work_order_items!inner(work_orders!inner(settled_at, order_type)), parts!inner(quantity)")
        .eq("customer_opinion", "agree")
        .eq("is_purchased", false)
        .is("work_order_items.work_orders.settled_at", null)
        .not("work_order_items.work_orders.order_type", "in", '("cancelled","maintenance")')
        .gt("unit_cost", 0)
        .gt("unit_price", 0)
        .not("part_id", "is", null)
        .lte("parts.quantity", 0),
      supabase.from("suppliers").select("id, name, region").order("name"),
      supabase.from("logistics_companies").select("id, name, scopes").order("name"),
      supabase
        .from("custom_purchase_staging")
        .select("id, part_id, part_number, name, brand, specification, document_name, unit, unit_cost, quantity, supplier_id, supplier_name, parts(quantity)")
        .order("created_at", { ascending: true }),
    ]);

    /* 待采购谓词已下推到阶段1 的两个查询（与 PendingPurchaseList.loadData 严格同口径） */
    const 合格ids = [
      ...new Set([
        ...(无关联行 || []).map((r) => r.id as string),
        ...(有关联行 || []).map((r) => r.id as string),
      ]),
    ];
    let filtered: 待采购行[] = [];
    let 待采购总数 = 0;
    if (合格ids.length > 0) {
      const { data, count } = await supabase
        .from("work_order_item_parts")
        .select(待采购查询字段, { count: "exact" })
        .in("id", 合格ids)
        .order("created_at", { ascending: true })
        .range(0, 19);
      filtered = (data || []) as unknown as 待采购行[];
      待采购总数 = count || 0;
    }

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
      totalCount: 待采购总数,
      suppliers: (sups || []) as 待采购供应商[],
      logisticsCompanies: (logistics || []) as 物流公司[],
      notArrivedMarks: marks,
    };
  }

  /* 待入库（与 PendingStorageList.loadData 同口径：老流程单 + 已确认到货单 + 收货批次卡片）
     2026-09-15 起老流程单两阶段分页：先取"走过到货确认单/收货批次"的黑名单单号，
     再主表 count+range 取第 1 页；批次卡片/到货单数据量小，照旧全量 */
  let 待入库首屏: { orders: 待入库采购单[]; totalCount: number; arrivalReceipts: 到货单[]; batches: 批次卡片[]; drafts: { id: string; inbound_no: string; purchase_order_id: string | null }[] } | undefined;
  if (currentTab === "pending_storage") {
    const supabase = await createClient();
    /* 阶段1：黑名单——有明细走过到货确认单/收货批次的 pending_storage 采购单 */
    const { data: 黑名单行 } = await supabase
      .from("purchase_order_items")
      .select("order_id, purchase_orders!inner(status)")
      .eq("purchase_orders.status", "pending_storage")
      .or("arrival_item_id.not.is.null,receiving_batch_id.not.is.null");
    const 黑名单ids = [...new Set((黑名单行 || []).map((r) => r.order_id as string))];
    /* 阶段2：老流程单 count + 第 1 页（黑名单为空时跳过 not-in） */
    let 老流程查询 = supabase
      .from("purchase_orders")
      .select(`
        id, order_no, supplier_id, status, total_amount, notes, created_at, waybill_id,
        supplier_order_no, supplier_order_amount, supplier_slip_photos,
        suppliers(id, name),
        purchase_order_items(
          id, name, brand, specification, quantity, unit_cost, received_qty,
          part_id, work_order_item_part_id, part_number, supplier_part_name,
          unit, category, license_plate, photos, notes,
          handle_action, discount_amount, evidence_photos, return_reason, arrival_item_id, receiving_batch_id
        )
      `, { count: "exact" })
      .eq("status", "pending_storage")
      .order("created_at", { ascending: false });
    if (黑名单ids.length > 0) {
      老流程查询 = 老流程查询.not("id", "in", `(${黑名单ids.join(",")})`);
    }
    const { data, count: 老流程总数 } = await 老流程查询.range(0, 19);
    const 老流程单 = (data || []) as unknown as 待入库采购单[];
    const { data: 到货单数据 } = await supabase
      .from("arrival_receipts")
      .select("id, receipt_no, supplier_order_no, supplier_order_amount, suppliers(name), logistics_waybills(tracking_no, freight_amount), arrival_receipt_items(count)")
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: false });
    /* 批次卡片（2026-09-07）：与客户端刷新共用同一个查询函数，口径一致 */
    const 批次卡片们 = await 查询批次卡片(supabase);
    /* 蓝卡入库确认单（2026-09-08 两阶段入库）：老流程单已生成的 draft 确认单，按钮变「待确认 →」 */
    const 老流程单id数组 = 老流程单.map((o) => o.id);
    let 蓝卡确认单们: { id: string; inbound_no: string; purchase_order_id: string | null }[] = [];
    if (老流程单id数组.length > 0) {
      const { data: 确认单数据 } = await supabase
        .from("inbound_orders")
        .select("id, inbound_no, purchase_order_id")
        .eq("status", "draft")
        .in("purchase_order_id", 老流程单id数组);
      蓝卡确认单们 = (确认单数据 || []) as { id: string; inbound_no: string; purchase_order_id: string | null }[];
    }
    待入库首屏 = { orders: 老流程单, totalCount: 老流程总数 || 0, arrivalReceipts: ((到货单数据 || []) as unknown) as 到货单[], batches: 批次卡片们, drafts: 蓝卡确认单们 };
  }

  /* 已入库（与 CompletedStorageList.loadData 同口径） */
  let 已入库首屏订单: 已入库采购单[] | undefined;
  let 已入库已退首屏: Record<string, number> | undefined;
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
          unit, category, license_plate, photos, notes, parts(barcode, quantity),
          receiving_batch_id, receiving_batches(batch_no), inbound_order_items(batch_no)
        ),
        inbound_orders(id, inbound_no, total_quantity, total_amount, created_at)
      `)
      .eq("status", "completed")
      .order("created_at", { ascending: false });
    已入库首屏订单 = (data || []) as unknown as 已入库采购单[];

    /* 已退数量首屏聚合（2026-09-16 退货标识）：与 CompletedStorageList.loadData 同口径 */
    const 明细ids = 已入库首屏订单.flatMap((o) => (o.purchase_order_items || []).map((it) => it.id));
    已入库已退首屏 = {};
    if (明细ids.length > 0) {
      const { data: 退货行 } = await supabase
        .from("supplier_return_records")
        .select("purchase_order_item_id, quantity")
        .in("purchase_order_item_id", 明细ids);
      for (const r of (退货行 || []) as { purchase_order_item_id: string | null; quantity: number }[]) {
        if (r.purchase_order_item_id) {
          已入库已退首屏[r.purchase_order_item_id] = (已入库已退首屏[r.purchase_order_item_id] ?? 0) + r.quantity;
        }
      }
    }
  }

  /* 待退货（与 PendingReturnList.loadData 同口径） */
  let 待退货首屏记录: 待退货记录[] | undefined;
  if (currentTab === "pending_return") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("supplier_return_records")
      .select(
        "id, supplier_name, return_reason, quantity, logistics_company, tracking_no, photos, package_photos, status, created_at, source, purchase_order_item_id, supplier_id, part_id, part_number, part_name, brand, specification, unit, unit_cost, batch_id, notes, work_order_item_parts(id, name, part_number, part_id, brand, specification, unit, unit_cost, notes, document_name), profiles(full_name)"
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
        "id, supplier_name, return_reason, quantity, logistics_company, tracking_no, photos, package_photos, handover_photos, status, created_at, work_order_item_parts(id, name, part_number, document_name), profiles(full_name), purchase_return_orders(id, return_no, return_shipping_fee, shipping_fee_payer)"
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
        {/* 领料管理入口（2026-09-09 用户拍板放右上角）：库管在采购/领料两个看板间互切 */}
        <Link
          href="/picking"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          领料管理 →
        </Link>
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
          initialTotalCount={分支首屏?.totalCount}
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
          initialTotalCount={待采购首屏?.totalCount}
          initialSuppliers={待采购首屏?.suppliers}
          initialLogisticsCompanies={待采购首屏?.logisticsCompanies}
          initialNotArrivedMarks={待采购首屏?.notArrivedMarks}
        />
      )}
      {/* 待收货（2026-08-21 需求4）：桌面端表格版 / 手机端竖排卡片版，同一 URL 按屏幕宽度自动切换 */}
      {currentTab === "pending_receipt" && (
        <>
          <div className="hidden md:block"><PendingReceiptList key={currentTab} initialOrders={待收货桌面订单} initialTotalCount={待收货总数} /></div>
          <div className="md:hidden">
            <MobileReceivingOrders 订单列表={手机待收订单} 待签收运单={手机待签收运单} />
          </div>
        </>
      )}
      {currentTab === "pending_storage" && (
        <PendingStorageList
          key={currentTab}
          initialOrders={待入库首屏?.orders}
          initialTotalCount={待入库首屏?.totalCount}
          initialArrivalReceipts={待入库首屏?.arrivalReceipts}
          initialBatches={待入库首屏?.batches}
          initialDrafts={待入库首屏?.drafts}
        />
      )}
      {currentTab === "completed_storage" && (
        <CompletedStorageList key={currentTab} initialOrders={已入库首屏订单} initial已退={已入库已退首屏} />
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
