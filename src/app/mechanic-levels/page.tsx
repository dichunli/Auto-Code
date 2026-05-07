import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { MechanicLevelList } from "./MechanicLevelList";

export default async function MechanicLevelsPage() {
  const supabase = await createClient();

  let { data: levels, error } = await supabase
    .from("mechanic_levels")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[mechanic-levels] order by sort_order failed:", error.message);
    const fallback = await supabase
      .from("mechanic_levels")
      .select("*")
      .order("created_at", { ascending: true });
    levels = fallback.data;
    error = fallback.error;
    if (error) console.error("[mechanic-levels] fallback also failed:", error.message);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="技师等级管理"
        description="管理技师等级与分成系数"
        action={{ href: "/mechanic-levels/new", label: "新建等级" }}
      />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <p className="font-medium mb-1">数据库查询错误</p>
          <p className="font-mono text-xs">{error.message}</p>
        </div>
      )}

      <MechanicLevelList levels={levels || []} />

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
        <p className="font-medium mb-1">说明</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>个人分成系数</strong>：技师单独完成项目时的提成倍率（如 1.20 = 提成 120%）</li>
          <li><strong>团队分配权重</strong>：多人合作时，按此权重分配提成比例</li>
          <li>两个系数可以独立设置，互不影响</li>
        </ul>
      </div>
    </div>
  );
}
