import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { 清基础数据缓存 } from "@/lib/workOrderData";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (userData.user.id === id) {
    return NextResponse.json({ error: "不能删除当前登录账号" }, { status: 400 });
  }

  /* 仅管理员可删除员工账号 */
  const { data: 角色行 } = await supabase
    .from("profile_roles")
    .select("roles(name)")
    .eq("profile_id", userData.user.id);
  const 是管理员 = ((角色行 || []) as unknown as { roles?: { name?: string } | null }[]).some(
    (d) => d.roles?.name === "admin"
  );
  if (!是管理员) {
    return NextResponse.json({ error: "仅管理员可删除员工账号" }, { status: 403 });
  }

  const admin = createAdminClient();

  // 关联检查：有工单接待 / 维修记录 / 项目派单 时禁止物理删除
  const [{ count: receptionistCount }, { count: mechanicCount }] = await Promise.all([
    admin.from("work_orders").select("id", { count: "exact", head: true }).eq("receptionist_id", id),
    admin.from("work_order_items").select("id", { count: "exact", head: true }).eq("mechanic_id", id),
  ]);

  if ((receptionistCount || 0) > 0 || (mechanicCount || 0) > 0) {
    return NextResponse.json(
      {
        error: `该员工有 ${receptionistCount || 0} 条接待工单 + ${mechanicCount || 0} 条维修记录，无法删除。请改为「设为离职」。`,
      },
      { status: 409 }
    );
  }

  // 删除关联数据（保险起见即使有外键 CASCADE 也手动清理）
  await admin.from("profile_roles").delete().eq("profile_id", id);
  await admin.from("employee_contacts").delete().eq("profile_id", id);

  const { error: profileError } = await admin.from("profiles").delete().eq("id", id);
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const { error: userError } = await admin.auth.admin.deleteUser(id);
  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 });
  }

  清基础数据缓存();
  return NextResponse.json({ ok: true });
}
