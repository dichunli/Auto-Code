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
  if (currentTab === "pending_receipt") {
    const supabase = await createClient();
    const [{ data: orders }, { data: waybills }] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select(`
          id, order_no, status, created_at, waybill_id, waybill_exempt, supplier_order_no, supplier_order_amount, supplier_slip_photos,
          suppliers(name, region),
          logistics_waybills:waybill_id(id, tracking_no, logistics_company_name, logistics_companies(name)),
          purchase_order_items(
            id, name, brand, specification, quantity, unit, notes, photos,
            part_id, part_number, supplier_part_name, handle_action, waybill_id, waybill_exempt
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
    ]);
    手机待收订单 = ((orders || []) as unknown) as 待收订单[];
    手机待签收运单 = ((waybills || []) as unknown) as 待签收运单[];
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

      {/* 内容区 */}
      {(currentTab === "pending_inquiry" ||
        currentTab === "pending_quote" ||
        currentTab === "pending_confirm") && (
        <PartBranchStatusList status={currentTab} />
      )}
      {currentTab === "pending_purchase" && <PendingPurchaseList />}
      {/* 待收货（2026-08-21 需求4）：桌面端表格版 / 手机端竖排卡片版，同一 URL 按屏幕宽度自动切换 */}
      {currentTab === "pending_receipt" && (
        <>
          <div className="hidden md:block"><PendingReceiptList /></div>
          <div className="md:hidden">
            <MobileReceivingOrders 订单列表={手机待收订单} 待签收运单={手机待签收运单} />
          </div>
        </>
      )}
      {currentTab === "pending_storage" && <PendingStorageList />}
      {currentTab === "completed_storage" && <CompletedStorageList />}
      {currentTab === "pending_return" && <PendingReturnList />}
      {currentTab === "completed_return" && <CompletedReturnList />}
    </div>
  );
}
