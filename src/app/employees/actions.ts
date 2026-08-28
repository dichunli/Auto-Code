"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 员工档案写操作 Server Action ═══
 * 编辑员工页的写库操作（解绑钉钉 / 保存档案）从客户端直写收口到服务端，
 * 避免客户端 session 异常导致 401/RLS 拦截。 */

/* 联系人参数（id 为空表示新增联系人） */
interface 联系人参数 {
  id?: string;
  name: string;
  phone: string | null;
  relationship: string;
  is_primary: boolean;
}

/* ─── 解除钉钉绑定（解绑后该员工不再参与考勤同步） ─── */
export async function 解绑钉钉账号(employeeId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ dingtalk_userid: null })
    .eq("id", employeeId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath(`/employees/${employeeId}`);
  return { success: true };
}

/* ─── 保存员工档案（主表 + 角色 + 联系人，一次提交内顺序执行） ─── */
export async function 保存员工档案(参数: {
  employeeId: string;
  fullName: string;
  phone: string;
  groupId: string;
  levelId: string;
  gender: string;
  entryDate: string;
  address: string;
  notes: string;
  isActive: boolean;
  idCard: string;
  idCardFrontUrl: string;
  idCardBackUrl: string;
  /* 底薪数字字段按规范用字符串传入，服务端转 number */
  baseSalary: string;
  roleIds: string[];
  contacts: 联系人参数[];
  originalContactIds: string[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const {
    employeeId,
    fullName,
    phone,
    groupId,
    levelId,
    gender,
    entryDate,
    address,
    notes,
    isActive,
    idCard,
    idCardFrontUrl,
    idCardBackUrl,
    baseSalary,
    roleIds,
    contacts,
    originalContactIds,
  } = 参数;

  const supabase = await createClient();

  /* 1. 更新员工主表 */
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      phone: phone || null,
      group_id: groupId || null,
      mechanic_level_id: levelId || null,
      gender: gender || null,
      entry_date: entryDate || null,
      address: address || null,
      notes: notes || null,
      is_active: isActive,
      id_card: idCard || null,
      id_card_front_url: idCardFrontUrl || null,
      id_card_back_url: idCardBackUrl || null,
      base_salary: baseSalary.trim() ? Number(baseSalary) : null,
    })
    .eq("id", employeeId);

  if (profileError) {
    return { success: false, error: profileError.message };
  }

  /* 2. 同步角色：服务端读现有角色，算出差集后增删 */
  const { data: existingRoles } = await supabase
    .from("profile_roles")
    .select("role_id")
    .eq("profile_id", employeeId);
  const existingRoleIds = (existingRoles || []).map((r: { role_id: string }) => r.role_id);
  const rolesToAdd = roleIds.filter((id) => !existingRoleIds.includes(id));
  const rolesToRemove = existingRoleIds.filter((id) => !roleIds.includes(id));

  if (rolesToAdd.length > 0) {
    const roleRows = rolesToAdd.map((rid) => ({
      profile_id: employeeId,
      role_id: rid,
    }));
    const { error: addRoleError } = await supabase.from("profile_roles").insert(roleRows);
    if (addRoleError) {
      return { success: false, error: addRoleError.message };
    }
  }
  if (rolesToRemove.length > 0) {
    const { error: removeRoleError } = await supabase
      .from("profile_roles")
      .delete()
      .eq("profile_id", employeeId)
      .in("role_id", rolesToRemove);
    if (removeRoleError) {
      return { success: false, error: removeRoleError.message };
    }
  }

  /* 3. 同步联系人：新增 / 更新 / 删除 */
  const validContacts = contacts.filter((c) => c.name.trim());
  const contactsToAdd = validContacts.filter((c) => !c.id);
  const contactsToUpdate = validContacts.filter((c) => c.id);
  const keptContactIds = new Set(contactsToUpdate.map((c) => c.id));
  const contactIdsToRemove = originalContactIds.filter((id) => !keptContactIds.has(id));

  if (contactsToAdd.length > 0) {
    const contactRows = contactsToAdd.map((c) => ({
      profile_id: employeeId,
      name: c.name.trim(),
      phone: c.phone || null,
      relationship: c.relationship || "other",
      is_primary: c.is_primary,
    }));
    const { error: addContactError } = await supabase.from("employee_contacts").insert(contactRows);
    if (addContactError) {
      return { success: false, error: addContactError.message };
    }
  }

  for (const c of contactsToUpdate) {
    const { error: updateContactError } = await supabase
      .from("employee_contacts")
      .update({
        name: c.name.trim(),
        phone: c.phone || null,
        relationship: c.relationship || "other",
        is_primary: c.is_primary,
      })
      .eq("id", c.id);
    if (updateContactError) {
      return { success: false, error: updateContactError.message };
    }
  }

  if (contactIdsToRemove.length > 0) {
    const { error: removeContactError } = await supabase
      .from("employee_contacts")
      .delete()
      .eq("profile_id", employeeId)
      .in("id", contactIdsToRemove);
    if (removeContactError) {
      return { success: false, error: removeContactError.message };
    }
  }

  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/employees");
  return { success: true };
}
