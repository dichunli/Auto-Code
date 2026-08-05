import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StickyPageHeader } from "@/components/StickyPageHeader";
import { ProcurementTabBar } from "@/components/ProcurementTabBar";
import { 获取询价单列表 } from "../quote/actions";
import QuoteSheetsContent from "./QuoteSheetsContent";

/* 询价单管理页：首屏数据服务端取（列表页规范），操作走 Server Action */

export default async function QuoteSheetsPage() {
  const 结果 = await 获取询价单列表();

  return (
    <div>
      <StickyPageHeader>
        <PageHeader title="询价单" description="发给供应商的询价链接：查看报价进度、采用或作废" />

        {/* 顶部按钮区（与采购管理一致） */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex flex-wrap gap-2 flex-1">
            <Link href="/procurement/orders" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">采购订单</Link>
            <Link href="/suppliers" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">供应商管理</Link>
            <Link href="/inventory/in" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">入库登记</Link>
            <Link href="/supplier-returns" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">退货记录</Link>
            <Link href="/supplier-transactions" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">往来款项</Link>
            <Link href="/logistics" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">物流运单</Link>
          </div>
        </div>

        <ProcurementTabBar currentTab="quote_sheets" />
      </StickyPageHeader>

      {结果.success && 结果.data ? (
        <QuoteSheetsContent 初始列表={结果.data.列表} 当前时间戳={结果.data.服务器时间戳} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-red-500">
          加载失败：{结果.error || "未知错误"}
        </div>
      )}
    </div>
  );
}
