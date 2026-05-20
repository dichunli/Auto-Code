import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { hasPermission, type Permission } from "@/lib/permissions";

interface MenuItem {
  label: string;
  href: string;
  permission: Permission;
  desc: string;
  color: string;
}

const MENU_ITEMS: MenuItem[] = [
  {
    label: "接车登记",
    href: "/m/reception",
    permission: "work_order:create",
    desc: "登记客户车辆、记录维修需求",
    color: "bg-blue-500",
  },
  {
    label: "车况检查",
    href: "/m/inspection",
    permission: "work_order:diagnose",
    desc: "检查机油、灯光、轮胎等项目",
    color: "bg-green-500",
  },
  {
    label: "询价报价",
    href: "/m/quote",
    permission: "work_order:quote",
    desc: "填写报价、确认客户意见",
    color: "bg-orange-500",
  },
  {
    label: "手机收货",
    href: "/m/receiving",
    permission: "inventory:in",
    desc: "扫描采购单、确认入库数量",
    color: "bg-purple-500",
  },
  {
    label: "手机领料",
    href: "/m/picking",
    permission: "inventory:out",
    desc: "扫描工单、领取所需配件",
    color: "bg-pink-500",
  },
  {
    label: "派工领单",
    href: "/m/assignment",
    permission: "work_order:repair",
    desc: "领取工单、开始/完工施工",
    color: "bg-teal-500",
  },
];

export default async function MobileHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let roles: string[] = [];
  if (user) {
    const { data } = await supabase
      .from("profile_roles")
      .select("roles(name)")
      .eq("profile_id", user.id);
    roles = (data || [])
      .map((r: any) => r.roles?.name)
      .filter(Boolean) as string[];
  }

  const visibleItems = MENU_ITEMS.filter((item) =>
    hasPermission(roles, item.permission)
  );

  return (
    <div className="p-4 space-y-4">
      <div className="text-center py-6">
        <h1 className="text-xl font-bold text-gray-900">手机工作台</h1>
        <p className="text-sm text-gray-500 mt-1">请选择要操作的功能</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col items-center text-center gap-2 active:scale-95 transition-transform"
          >
            <div className={`w-10 h-10 rounded-full ${item.color} flex items-center justify-center text-white`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="text-sm font-medium text-gray-900">{item.label}</div>
            <div className="text-xs text-gray-500 leading-tight">{item.desc}</div>
          </Link>
        ))}
      </div>

      <div className="text-center pt-4">
        <Link href="/?desktop=1" className="text-sm text-blue-600 hover:text-blue-700">
          返回电脑版首页
        </Link>
      </div>
    </div>
  );
}
