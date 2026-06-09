import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import WorkOrdersContent from "./WorkOrdersContent";
import { WorkOrderTabBar } from "@/components/WorkOrderTabBar";
import WorkOrderSearch from "@/components/WorkOrderSearch";

/* ═════════════════════════════════════════════════════════════════
 * 工单列表页 — Server Component
 *
 * 数据查询在服务端完成，彻底消除客户端 session 问题对列表加载的影响。
 * 筛选通过 URL query params + 服务端重新查询实现。
 * ═════════════════════════════════════════════════════════════════ */

interface WorkOrderItem {
  id: string;
  status?: string | null;
  mechanic_id?: string | null;
  item_type?: string | null;
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
}

export interface Order {
  id: string;
  order_no: string;
  status: string;
  boardStage: string;
  total_cost: number | null;
  created_at: string;
  order_type: string;
  vehicles: { plate_number: string; brand: string; model: string; vin: string } | null;
  customers: { name: string; phone: string; company: string } | null;
}

const SETTLED_STATUSES = ["settled", "delivered", "pending_close", "pending_settlement"];
const HISTORY_STATUSES = ["settled", "delivered"];

const statusFilters = [
  { value: "", label: "全部" },
  { value: "pending_diagnosis", label: "待诊断" },
  { value: "pending_dispatch", label: "待派工" },
  { value: "pending_construction", label: "待施工" },
  { value: "in_progress", label: "施工中" },
  { value: "paused", label: "已中断" },
  { value: "completed", label: "已完工" },
  { value: "pending_qc", label: "已质检" },
  { value: "settled", label: "已结单" },
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

function computeBoardStage(raw: RawWorkOrder): string {
  const orderStatus = raw.status;
  if (SETTLED_STATUSES.includes(orderStatus)) return "settled";
  if (orderStatus === "pending_quality_check") return "pending_qc";

  const labors = (raw.work_order_items || []).filter((it: WorkOrderItem) => it.item_type === "labor");
  if (labors.length === 0) return "pending_diagnosis";

  if (labors.some((it: WorkOrderItem) => it.status === "paused")) return "paused";
  if (labors.some((it: WorkOrderItem) => it.status === "in_progress")) return "in_progress";
  if (labors.every((it: WorkOrderItem) => it.status === "completed")) return "completed";

  const hasUnassigned = labors.some(
    (it: WorkOrderItem) => (it.status === "pending" || !it.status) && !it.mechanic_id
  );
  if (hasUnassigned) return "pending_dispatch";

  return "pending_construction";
}

function normalizeOrder(raw: RawWorkOrder): Order {
  const v = raw.vehicles;
  const c = raw.customers;
  return {
    id: raw.id,
    order_no: raw.order_no,
    status: raw.status,
    boardStage: computeBoardStage(raw),
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

  /* ═══════════════════════════════════════
   *  第一步：数据库查询（SQL 层筛选）
   * ═══════════════════════════════════════ */
  let query = supabase
    .from("work_orders")
    .select(
      `id, order_no, status, order_type, total_cost, created_at,
       vehicles(plate_number, brand, model, vin),
       customers(name, phone, company),
       work_order_items(id, status, mechanic_id, item_type)`,
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  /* 工单类型筛选（SQL 层） */
  if (type) {
    query = query.eq("order_type", type);
  }

  /* 状态筛选（SQL 层能处理的） */
  if (status === "active" && !type) {
    query = query.not("status", "in", HISTORY_STATUSES).eq("order_type", "normal");
  } else if (status === "history" && !type) {
    query = query.in("status", HISTORY_STATUSES);
  }

  /* 结算状态筛选（SQL 层） */
  if (settlement && !type) {
    if (settlement === "unsettled") {
      query = query.not("status", "in", ["pending_settlement", "settled", "delivered"]);
    } else if (settlement === "pending") {
      query = query.eq("status", "pending_settlement");
    } else if (settlement === "settled") {
      query = query.in("status", ["settled", "delivered"]);
    }
  }

  /* 关键词搜索（SQL 层：工单号 + 车牌 + VIN + 客户名） */
  if (keyword.trim()) {
    const k = keyword.trim();
    query = query.or(
      `order_no.ilike.%${k}%,vehicles.plate_number.ilike.%${k}%,vehicles.vin.ilike.%${k}%,customers.name.ilike.%${k}%`
    );
  }

  const { data, error } = await query;

  /* ═══════════════════════════════════════
   *  第二步：服务端内存筛选 + 分页
   * ═══════════════════════════════════════ */
  let orders: Order[] = [];
  let queryError: string | null = null;

  if (error) {
    queryError = error.message;
  } else {
    let result = (data || []).map(normalizeOrder);

    /* boardStage 筛选（服务端内存） */
    if (status && !["", "active", "history", "all"].includes(status) && !type) {
      result = result.filter((o) => o.boardStage === status);
    }

    /* 关键词搜索补充（SQL or 可能不支持所有字段，这里做二次过滤） */
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
  }

  const total = orders.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fromIdx = (page - 1) * pageSize;
  const paginatedOrders = orders.slice(fromIdx, fromIdx + pageSize);

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
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm text-gray-500 whitespace-nowrap">结算状态</span>
            <form method="GET" className="inline">
              {type && <input type="hidden" name="type" value={type} />}
              {tabsParam && <input type="hidden" name="tabs" value={tabsParam} />}
              {status && <input type="hidden" name="status" value={status} />}
              {keyword && <input type="hidden" name="keyword" value={keyword} />}
              <select
                name="settlement"
                defaultValue={settlement}
                onChange={(e) => {
                  const form = e.target.form;
                  if (form) form.submit();
                }}
                className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {SETTLEMENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </form>
          </div>
          <div className="flex-1" />
          <WorkOrderSearch keyword={keyword} baseParams={baseParams} />
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
          <WorkOrderSearch keyword={keyword} baseParams={baseParams} />
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
