import { PageHeader } from "@/components/PageHeader";
import { StickyPageHeader } from "@/components/StickyPageHeader";
import Link from "next/link";
import { PartBranchStatusList } from "@/components/PartBranchStatusList";
import { PendingPurchaseList } from "@/components/PendingPurchaseList";
import { PendingReceiptList } from "@/components/PendingReceiptList";
import { PendingStorageList } from "@/components/PendingStorageList";
import { CompletedStorageList } from "@/components/CompletedStorageList";
import { PendingReturnList } from "@/components/PendingReturnList";
import { CompletedReturnList } from "@/components/CompletedReturnList";
import { ProcurementTabBar } from "@/components/ProcurementTabBar";
import { BrowserNotificationToggle } from "@/components/BrowserNotificationToggle";

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

  return (
    <div>
      {/* 冻结页头：标题 + 按钮区 + Tab 行，滚动时固定不动。
          2026-08-20 需求8：手机端只做收货，副标题/导航按钮/Tab 卡片全部隐藏（md 起恢复显示） */}
      <StickyPageHeader>
      <PageHeader title="采购管理" description="按阶段集中处理工单配件的采购流转" descriptionClassName="hidden md:block" />

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
      {currentTab === "pending_receipt" && <PendingReceiptList />}
      {currentTab === "pending_storage" && <PendingStorageList />}
      {currentTab === "completed_storage" && <CompletedStorageList />}
      {currentTab === "pending_return" && <PendingReturnList />}
      {currentTab === "completed_return" && <CompletedReturnList />}
    </div>
  );
}
