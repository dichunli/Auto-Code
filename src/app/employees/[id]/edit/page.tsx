import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { EmployeeEditForm } from "./EmployeeEditForm";

interface EmployeeGroup {
  id: string;
  name: string;
}

interface Role {
  id: string;
  name: string;
  label: string;
}

interface MechanicLevel {
  id: string;
  name: string;
  level_code: string;
}

interface Employee {
  id: string;
  full_name: string;
  phone: string | null;
  group_id: string | null;
  mechanic_level_id: string | null;
  gender: string | null;
  entry_date: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  id_card: string | null;
  id_card_front_url: string | null;
  id_card_back_url: string | null;
  base_salary: number | null;
  dingtalk_userid: string | null;
}

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  relationship: string;
  is_primary: boolean;
}

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: groups }, { data: roles }, { data: levels }] = await Promise.all([
    supabase.from("employee_groups").select("id, name").order("sort_order").limit(100),
    supabase.from("roles").select("id, name, label").order("name").limit(100),
    supabase.from("mechanic_levels").select("id, name, level_code").order("level_code").limit(100),
  ]);

  const { data: employee } = await supabase
    .from("profiles")
    .select("id, full_name, phone, group_id, mechanic_level_id, gender, entry_date, address, notes, is_active, dingtalk_userid")
    .eq("id", id)
    .single();

  if (!employee) {
    notFound();
  }

  /* 敏感字段（身份证/底薪）从 profile_privates 补读（2026-09-14 起从 profiles 拆出） */
  const { data: 敏感信息 } = await supabase
    .from("profile_privates")
    .select("id_card, id_card_front_url, id_card_back_url, base_salary")
    .eq("profile_id", id)
    .maybeSingle();

  const [{ data: userRoles }, { data: userContacts }] = await Promise.all([
    supabase.from("profile_roles").select("role_id").eq("profile_id", id),
    supabase
      .from("employee_contacts")
      .select("id, name, phone, relationship, is_primary")
      .eq("profile_id", id)
      .order("is_primary", { ascending: false }),
  ]);

  const typedEmployee = {
    ...(employee as unknown as Employee),
    id_card: 敏感信息?.id_card ?? null,
    id_card_front_url: 敏感信息?.id_card_front_url ?? null,
    id_card_back_url: 敏感信息?.id_card_back_url ?? null,
    base_salary: 敏感信息?.base_salary ?? null,
  } as Employee;
  const typedGroups = (groups || []) as unknown as EmployeeGroup[];
  const typedRoles = (roles || []) as unknown as Role[];
  const typedLevels = (levels || []) as unknown as MechanicLevel[];
  const initialRoleIds = ((userRoles || []) as unknown as { role_id: string }[]).map((r) => r.role_id);
  const initialContacts = ((userContacts || []) as unknown as Contact[]).map((c) => ({
    id: c.id,
    name: c.name || "",
    phone: c.phone || "",
    relationship: c.relationship || "",
    is_primary: c.is_primary ?? false,
  }));

  return (
    <EmployeeEditForm
      employeeId={typedEmployee.id}
      groups={typedGroups}
      roles={typedRoles}
      levels={typedLevels}
      employee={typedEmployee}
      initialRoleIds={initialRoleIds}
      initialContacts={initialContacts}
    />
  );
}
