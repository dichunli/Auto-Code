import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

const reportCards = [
  { href: "/reports/revenue", title: "营收报表", desc: "按日/月查看营业收入与回款情况", color: "bg-blue-50 text-blue-700 border-blue-100" },
  { href: "/reports/profit", title: "利润分析", desc: "收入、成本、毛利与利润率分析", color: "bg-green-50 text-green-700 border-green-100" },
  { href: "/reports/work-orders", title: "工单统计", desc: "工单数量、状态分布与金额统计", color: "bg-purple-50 text-purple-700 border-purple-100" },
  { href: "/reports/inventory", title: "库存周转", desc: "配件库存量、价值与周转天数", color: "bg-orange-50 text-orange-700 border-orange-100" },
  { href: "/reports/auto-linked-parts", title: "自动关联配件", desc: "查看自动从工单建立的配件与车型关联记录", color: "bg-yellow-50 text-yellow-700 border-yellow-100" },
  { href: "/reports/performance", title: "员工业绩", desc: "技师工单数、项目金额与工时统计", color: "bg-teal-50 text-teal-700 border-teal-100" },
  { href: "/reports/construction-stats", title: "施工用时统计", desc: "项目施工时长、中断时长与技师效率对比", color: "bg-indigo-50 text-indigo-700 border-indigo-100" },
];

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="报表统计"
        description="查看汽修厂经营数据与业务分析报表"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {reportCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`rounded-xl border p-6 hover:shadow-sm transition-shadow ${card.color}`}
          >
            <h3 className="text-lg font-bold">{card.title}</h3>
            <p className="text-sm mt-2 opacity-80">{card.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
