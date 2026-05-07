import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface ContactInput {
  name: string;
  phone: string;
  relationship: string;
  is_primary: boolean;
}

interface CreateEmployeeBody {
  accountPhone: string;
  password: string;
  fullName: string;
  phone?: string;
  groupId?: string;
  roleIds?: string[];
  levelId?: string;
  gender?: string;
  entryDate?: string;
  address?: string;
  notes?: string;
  contacts?: ContactInput[];
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateEmployeeBody;
  const {
    accountPhone,
    password,
    fullName,
    phone,
    groupId,
    roleIds,
    levelId,
    gender,
    entryDate,
    address,
    notes,
    contacts,
  } = body;

  if (!accountPhone || !password || !fullName) {
    return NextResponse.json({ error: "请填写手机号、密码和姓名" }, { status: 400 });
  }
  if (!/^1[3-9]\d{9}$/.test(accountPhone)) {
    return NextResponse.json({ error: "请输入正确的11位手机号码" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "密码至少6位" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const admin = createAdminClient();
  const email = `phone-${accountPhone}@auto.local`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created.user) {
    const msg = createError?.message || "创建用户失败";
    if (msg.toLowerCase().includes("already")) {
      return NextResponse.json({ error: "该手机号已注册" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const userId = created.user.id;

  const { error: profileError } = await admin
    .from("profiles")
    .upsert({
      id: userId,
      full_name: fullName,
      phone: phone || null,
      group_id: groupId || null,
      mechanic_level_id: levelId || null,
      gender: gender || null,
      entry_date: entryDate || null,
      address: address || null,
      notes: notes || null,
      is_active: true,
    }, { onConflict: "id" });

  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (roleIds && roleIds.length > 0) {
    const roleRows = roleIds.map((rid) => ({ profile_id: userId, role_id: rid }));
    const { error: roleError } = await admin.from("profile_roles").insert(roleRows);
    if (roleError) {
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: roleError.message }, { status: 500 });
    }
  }

  const validContacts = (contacts || []).filter(
    (c) => c.name?.trim() && c.relationship
  );
  if (validContacts.length > 0) {
    const contactRows = validContacts.map((c) => ({
      profile_id: userId,
      name: c.name.trim(),
      phone: c.phone || null,
      relationship: c.relationship,
      is_primary: c.is_primary,
    }));
    const { error: contactError } = await admin
      .from("employee_contacts")
      .insert(contactRows);
    if (contactError) {
      return NextResponse.json({ error: contactError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ id: userId });
}
