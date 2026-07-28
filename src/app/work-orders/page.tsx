import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import WorkOrdersContent from "./WorkOrdersContent";
import { WorkOrderTabBar } from "@/components/WorkOrderTabBar";
import WorkOrderSearch from "@/components/WorkOrderSearch";
import WorkOrdersRefreshBar from "@/components/WorkOrdersRefreshBar";
import { 保养单草稿前缀 } from "@/lib/maintenance";
import { computeBoardStages, getItemStageKey, 阶段顺序, 阶段文案, 阶段深色, type 阶段key, type 工单状态输入 } from "@/lib/orderStage";

/* ═════════════════════════════════════════════════════════════════
 * 工单列表页 — Server Component
 *
 * 数据查询在服务端完成，彻底消除客户端 session 问题对列表加载的影响。
 * 筛选通过 URL query params + 服务端重新查询实现。
 * ═════════════════════════════════════════════════════════════════ */

interface 数量记录 {
  quantity?: number | null;
}

interface WorkOrderItemPart {
  quantity?: number | null;
  is_selected?: boolean | null;
  part_picking_records?: 数量记录[] | null;
  part_return_records?: 数量记录[] | null;
}

interface WorkOrderItem {
  id: string;
  name?: string | null;
  alias_name?: string | null;
  status?: string | null;
  mechanic_id?: string | null;
  item_type?: string | null;
  require_qc?: boolean | null;
  qc_status?: string | null;
  work_order_item_mechanics?: { mechanic_id: string }[] | null;
  work_order_item_parts?: WorkOrderItemPart[] | null;
}

interface RawWorkOrder {
  id: string;
  order_no: string;
  status: string;
  order_type?: string | null;
  total_cost?: number | null;
  created_at: string;
  vehicles?: { plate_number: string; brand: string; model: string; vin: string } | { plate_number: string; brand: string; model: string; vin: string }[] | null;
  customers?: { name: string; phone: string; company: string } | { name: string; phone: string; company: string }[] | null;
  work_order_items?: WorkOrderItem[] | null;
  work_order_requirements?: { id: string; assigned_to?: string | null; description?: string | null }[] | null;
}

export interface Order {
  id: string;
  order_no: string;
  status: string;
  /* 显示状态徽章数组（多阶段同时显示），取值见 orderStage 阶段key */
  boardStages: 阶段key[];
  /* labor 项目阶段明细（分栏卡片视图用）：每车卡片列出"处于某阶段"的项目 */
  stageItems: { id: string; name: string; alias_name?: string | null; stage: 阶段key }[];
  /* 未指派的需求明细（待诊断卡片列出具体需求） */
  未指派需求: { id: string; description: string | null }[];
  /* 有需求未指派（待诊断卡片占位文案用） */
  有未指派需求: boolean;
  total_cost: number | null;
  created_at: string;
  order_type: string;
  vehicles: { plate_number: string; brand: string; model: string; vin: string } | null;
  customers: { name: string; phone: string; company: string } | null;
}

const HISTORY_STATUSES = ["settled", "delivered"];

/* 阶段筛选 chips：10 态全部来自公共常量（唯一口径） */
const statusFilters = [
  { value: "", label: "全部" },
  ...阶段顺序.map((k) => ({ value: k as string, label: 阶段文案[k] })),
];

const typeLabelMap: Record<string, string> = {
  normal: "正常工单",
  appointment: "预约单",
  quote: "报价单",
  maintenance: "保养工单",
  cancelled: "作废工单",
};

const SETTLEMENT_OPTIONS = [
  { value: "", label: "全部" },
  { value: "unsettled", label: "未结算" },
  { value: "pending", label: "待结算" },
  { value: "settled", label: "已结算" },
];

/* 把原始工单数据组装成状态判定输入（公共函数 computeBoardStages 的入参） */
function 组装状态输入(raw: RawWorkOrder): 工单状态输入 {
  const items = raw.work_order_items || [];
  return {
    status: raw.status,
    有未指派需求: (raw.work_order_requirements || []).some((r) => !r.assigned_to),
    项目列表: items.map((it) => ({
      item_type: it.item_type,
      status: it.status,
      require_qc: it.require_qc,
      qc_status: it.qc_status,
      /* 派工判定以 work_order_item_mechanics 为准；mechanic_id 旧字段兜底兼容老数据 */
      已派工: (it.work_order_item_mechanics || []).length > 0 || !!it.mechanic_id,
    })),
    配件列表: items.flatMap((it) =>
      (it.work_order_item_parts || []).map((p) => ({
        is_selected: p.is_selected,
        quantity: p.quantity,
        净出库:
          (p.part_picking_records || []).reduce((s, r) => s + (r.quantity || 0), 0) -
          (p.part_return_records || []).reduce((s, r) => s + (r.quantity || 0), 0),
      }))
    ),
  };
}

function normalizeOrder(raw: RawWorkOrder): Order {
  const v = raw.vehicles;
  const c = raw.customers;
  const 输入 = 组装状态输入(raw);
  /* labor 项目的阶段明细（分栏卡片视图用） */
  const stageItems = 输入.项目列表
    .map((it, idx) => {
      const stage = getItemStageKey(it);
      const 原 = (raw.work_order_items || [])[idx];
      return stage && 原
        ? { id: 原.id, name: 原.name || "", alias_name: 原.alias_name, stage }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return {
    id: raw.id,
    order_no: raw.order_no,
    status: raw.status,
    boardStages: computeBoardStages(输入),
    stageItems,
    未指派需求: (raw.work_order_requirements || [])
      .filter((r) => !r.assigned_to)
      .map((r) => ({ id: r.id, description: r.description || null })),
    有未指派需求: 输入.有未指派需求,
    total_cost: raw.total_cost ?? null,
    created_at: raw.created_at,
    order_type: raw.order_type || "normal",
    vehicles: Array.isArray(v) ? v[0] || null : v || null,
    customers: Array.isArray(c) ? c[0] || null : c || null,
  };
}

/* 构建带筛选参数的链接 */
function buildLink(base: Record<string, string>, updates: Record<string, string>): string {
  const sp = new URLSearchParams();
  Object.entries(base).forEach(([k, v]) => {
    if (v) sp.set(k, v);
  });
  Object.entries(updates).forEach(([k, v]) => {
    if (v) sp.set(k, v);
    else sp.delete(k);
  });
  const qs = sp.toString();
  return qs ? `/work-orders?${qs}` : "/work-orders";
}

export default async function WorkOrdersPage(props: {
  searchParams?: Promise<Record<string, string | undefined>> | Record<string, string | undefined>;
}) {
  const searchParams = (await Promise.resolve(props.searchParams || {})) as Record<string, string | undefined>;

  const status = searchParams.status || "";
  const keyword = searchParams.keyword || "";
  const type = searchParams.type || "";
  const settlement = searchParams.settlement || "";
  const tabsParam = searchParams.tabs || "";
  const page = Math.max(1, parseInt(searchParams.page || "1", 10));
  const pageSize = 20;

  /* 无筛选参数时默认显示"在修工单" */
  if (!status && !type && !keyword && !settlement) {
    redirect("/work-orders?status=active");
  }

  const supabase = await createClient();

  /* 判断能否走「数据库层分页」：
   * - 关键词搜索匹配的是关联表字段（车牌/VIN/客户名等），SQL or 拼接会解析失败，只能内存过滤
   * - 细分状态（待诊断/待派工/施工中等）需结合 work_order_items 实时计算 boardStage，也只能内存过滤
   * 除这两种情况外（在修/历史/各类型/结算状态页），SQL 已能精确筛选，
   * 可直接用数据库 range 分页，无论数据量多大都只取当前页 20 条，避免全表拉进内存。
   */
  const isDetailStage = !!status && !["", "active", "history", "all"].includes(status);
  const hasKeyword = !!keyword.trim();
  const canDbPaginate = !hasKeyword && !(isDetailStage && !type);

  /* ═══════════════════════════════════════
   *  第一步：数据库查询（SQL 层筛选）
   * ═══════════════════════════════════════ */
  let query = supabase
    .from("work_orders")
    .select(
      `id, order_no, status, order_type, total_cost, created_at,
       vehicles(plate_number, brand, model, vin),
       customers(name, phone, company),
       work_order_items(id, name, alias_name, status, mechanic_id, item_type, require_qc, qc_status,
         work_order_item_mechanics(mechanic_id),
         work_order_item_parts(quantity, is_selected,
           part_picking_records(quantity),
           part_return_records(quantity))),
       work_order_requirements(id, assigned_to, description)`,
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  /* 工单类型筛选（SQL 层） */
  if (type) {
    query = query.eq("order_type", type);
    /* 保养单列表排除未保存的草稿（DRAFT- 前缀单号） */
    if (type === "maintenance") {
      query = query.not("order_no", "like", 保养单草稿前缀 + "%");
    }
  } else {
    /* 工单列表的所有视图（在修/历史/全部/阶段/结算）都不显示 DRAFT- 残留草稿：
     * 草稿是"建保养单"没保存的临时单，设计本意等于不存在 */
    query = query.not("order_no", "like", 保养单草稿前缀 + "%");
  }

  /* 状态筛选（SQL 层能处理的） */
  if (status === "active" && !type) {
    query = query.not("status", "eq", "settled").not("status", "eq", "delivered").eq("order_type", "normal");
  } else if (status === "history" && !type) {
    query = query.in("status", HISTORY_STATUSES);
  } else if (isDetailStage && !type) {
    /* 阶段筛选（待诊断/待派工/…/已结算）：只看正常工单——
     * 保养单/预约单/报价单不是"在修工单"，不能混进分栏卡片（角标统计同样只算 normal） */
    query = query.eq("order_type", "normal");
  }

  /* 结算状态筛选（SQL 层） */
  if (settlement && !type) {
    if (settlement === "unsettled") {
      query = query.not("status", "eq", "pending_settlement").not("status", "eq", "settled").not("status", "eq", "delivered");
    } else if (settlement === "pending") {
      query = query.eq("status", "pending_settlement");
    } else if (settlement === "settled") {
      query = query.in("status", ["settled", "delivered"]);
    }
  }

  /* 能走数据库分页时，直接在 SQL 层取当前页 20 条，避免全表数据进内存 */
  if (canDbPaginate) {
    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);
  }

  const { data, error, count } = await query;

  /* 角标统计：在修工单全量逐单算徽章、按阶段计数（在修数量小，一次轻量查询）。
   * 仅工单列表（!type）需要；角标语义=工单数（几辆车处于该阶段） */
  let 阶段角标: Record<string, number> | null = null;
  if (!type) {
    const { data: 全部在修 } = await supabase
      .from("work_orders")
      .select(
        `id, order_no, status, order_type, total_cost, created_at,
         vehicles(plate_number, brand, model, vin),
         customers(name, phone, company),
         work_order_items(id, name, alias_name, status, mechanic_id, item_type, require_qc, qc_status,
           work_order_item_mechanics(mechanic_id),
           work_order_item_parts(quantity, is_selected,
             part_picking_records(quantity),
             part_return_records(quantity))),
         work_order_requirements(id, assigned_to)`
      )
      .not("status", "eq", "settled")
      .not("status", "eq", "delivered")
      .eq("order_type", "normal");
    const 计数: Record<string, number> = { "": (全部在修 || []).length };
    for (const raw of (全部在修 || []) as unknown as RawWorkOrder[]) {
      for (const s of computeBoardStages(组装状态输入(raw))) {
        计数[s] = (计数[s] || 0) + 1;
      }
    }
    阶段角标 = 计数;
  }

  /* ═══════════════════════════════════════
   *  第二步：服务端内存筛选 + 分页
   * ═══════════════════════════════════════ */
  let orders: Order[] = [];
  let queryError: string | null = null;
  /* 数据库分页时总数取自 SQL count；内存过滤时总数为过滤后的长度（下方赋值） */
  let total = 0;

  if (error) {
    queryError = error.message;
  } else {
    let result = (data || []).map(normalizeOrder);

    /* 阶段筛选（服务端内存）：多徽章数组"包含该阶段"即命中 */
    if (status && !["", "active", "history", "all"].includes(status) && !type) {
      result = result.filter((o) => o.boardStages.includes(status as 阶段key));
    }

    /* 关键词搜索（服务端内存过滤，关联表字段用 SQL or 会解析失败） */
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase();
      result = result.filter((order) => {
        const orderNo = order.order_no?.toLowerCase() || "";
        const plate = order.vehicles?.plate_number?.toLowerCase() || "";
        const vin = order.vehicles?.vin?.toLowerCase() || "";
        const brand = order.vehicles?.brand?.toLowerCase() || "";
        const model = order.vehicles?.model?.toLowerCase() || "";
        const customerName = order.customers?.name?.toLowerCase() || "";
        const phone = order.customers?.phone?.toLowerCase() || "";
        const company = order.customers?.company?.toLowerCase() || "";
        return (
          orderNo.includes(k) ||
          plate.includes(k) ||
          vin.includes(k) ||
          brand.includes(k) ||
          model.includes(k) ||
          customerName.includes(k) ||
          phone.includes(k) ||
          company.includes(k)
        );
      });
    }

    orders = result;
    /* 数据库分页：总数用 SQL count；内存过滤：总数用过滤后长度 */
    total = canDbPaginate ? (count ?? 0) : orders.length;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  /* 数据库分页时 data 已是当前页，无需再切；内存过滤时在过滤结果上切当前页。
   * 分栏卡片视图（具体阶段筛选）显示该阶段全部工单，不分页 */
  const paginatedOrders = canDbPaginate
    ? orders
    : isDetailStage && !type
      ? orders
      : orders.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  const baseParams: Record<string, string> = {
    type,
    tabs: tabsParam,
    settlement,
    keyword,
  };

  const pageTitle = type ? typeLabelMap[type] || "工单管理" : "工单管理";

  return (
    <div>
      <WorkOrderTabBar tabs={tabsParam} />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">{pageTitle}</h1>
        {!type && status !== "history" && (
          <Link
            href="/work-orders/new"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            新建工单
          </Link>
        )}
      </div>

      {!type && (
        <div className="flex items-center gap-3 mb-4 overflow-x-auto pb-1">
          <div className="flex gap-2">
            {statusFilters.map((filter) => (
              <Link
                key={filter.value}
                href={buildLink(baseParams, { status: filter.value, page: "1" })}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  status === filter.value
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                {filter.label}
                {/* 角标=该阶段工单数（在修范围）：彩色小徽章更醒目；
                    0 不显示，"全部"显示在修总数（蓝色徽章） */}
                {阶段角标 && (阶段角标[filter.value] || 0) > 0 && (
                  <span
                    className={`ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-[11px] font-bold text-white ${
                      status === filter.value
                        ? "bg-white/25"
                        : filter.value === ""
                          ? "bg-blue-600"
                          : 阶段深色[filter.value as 阶段key] || "bg-gray-500"
                    }`}
                  >
                    {阶段角标[filter.value]}
                  </span>
                )}
              </Link>
            ))}
          </div>
          {/* 结算状态筛选 — 用 Link 避免 Server Component 中使用 onChange */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm text-gray-500 whitespace-nowrap">结算状态</span>
            <div className="flex gap-1">
              {SETTLEMENT_OPTIONS.map((opt) => (
                <Link
                  key={opt.value}
                  href={buildLink(baseParams, { settlement: opt.value, page: "1" })}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    settlement === opt.value
                      ? "bg-blue-100 text-blue-700 font-medium"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {opt.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex-1" />
          <WorkOrderSearch keyword={keyword} />
          {/* 手动刷新按钮 + 数据更新提示条（Realtime 监听，有更新弹提示不自动刷） */}
          <WorkOrdersRefreshBar />
        </div>
      )}

      {type && (
        <div className="flex items-center gap-3 mb-4 overflow-x-auto pb-1">
          <div className="flex gap-2">
            <Link
              href={buildLink(baseParams, { type: "" })}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            >
              ← 返回全部工单
            </Link>
          </div>
          <div className="flex-1" />
          <WorkOrderSearch keyword={keyword} />
          {/* 手动刷新按钮 + 数据更新提示条（Realtime 监听，有更新弹提示不自动刷） */}
          <WorkOrdersRefreshBar />
        </div>
      )}

      {!type && (
        <div className="flex items-center gap-2 mb-6">
          <Link
            href={buildLink(baseParams, {})}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200"
          >
            列表视图
          </Link>
          <Link
            href="/work-orders/board"
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
          >
            维修看板
          </Link>
        </div>
      )}

      {/* 数据加载错误提示 */}
      {queryError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="font-medium text-red-700">数据加载失败</p>
          <p className="text-sm text-red-600 mt-1">{queryError}</p>
          <p className="text-xs text-red-500 mt-2">请刷新页面重试，或检查网络连接</p>
        </div>
      )}

      <WorkOrdersContent
        orders={paginatedOrders}
        total={total}
        page={page}
        totalPages={totalPages}
        status={status}
        type={type}
        queryError={queryError}
        baseParams={baseParams}
      />
    </div>
  );
}
