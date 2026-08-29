"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 单位表单数据（金额字段前端字符串，提交时转 number） ═══ */
export interface 单位表单数据 {
  name: string;
  contact: string;
  phone: string;
  address: string;
  credit_limit: string;
  payment_terms: string;
  notes: string;
  invoice_title: string;
  tax_no: string;
  bank_name: string;
  bank_account: string;
  invoice_address: string;
  invoice_phone: string;
}

export interface 单位联系人数据 {
  name: string;
  phone: string;
  title: string;
}

/* 把表单字段转成数据库写入值（trim、空串转 NULL） */
function 组装单位写入值(form: 单位表单数据) {
  return {
    name: form.name.trim(),
    contact: form.contact.trim() || null,
    phone: form.phone.trim() || null,
    address: form.address.trim() || null,
    credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : 0,
    payment_terms: form.payment_terms.trim() || "月结",
    notes: form.notes.trim() || null,
    invoice_title: form.invoice_title.trim() || null,
    tax_no: form.tax_no.trim() || null,
    bank_name: form.bank_name.trim() || null,
    bank_account: form.bank_account.trim() || null,
    invoice_address: form.invoice_address.trim() || null,
    invoice_phone: form.invoice_phone.trim() || null,
  };
}

/* ═══ 新建单位（含联系人） ═══ */
export async function 新建单位(参数: {
  form: 单位表单数据;
  contacts: 单位联系人数据[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.form.name.trim()) {
    return { success: false, error: "请填写单位名称" };
  }

  const supabase = await createClient();

  const { data: companyData, error } = await supabase
    .from("companies")
    .insert(组装单位写入值(参数.form))
    .select("id")
    .single();
  if (error || !companyData?.id) {
    return { success: false, error: error?.message || "未知错误" };
  }

  const validContacts = 参数.contacts.filter((c) => c.name.trim());
  if (validContacts.length > 0) {
    const { error: contactErr } = await supabase.from("company_contacts").insert(
      validContacts.map((c) => ({
        company_id: companyData.id,
        name: c.name.trim(),
        phone: c.phone.trim() || null,
        title: c.title.trim() || null,
      }))
    );
    if (contactErr) {
      return { success: false, error: "单位已保存，但联系人写入失败: " + contactErr.message };
    }
  }

  revalidatePath("/companies");
  return { success: true, id: companyData.id };
}

/* ═══ 更新单位（主表更新 + 联系人先删后插） ═══ */
export async function 更新单位(参数: {
  id: string;
  form: 单位表单数据;
  contacts: 单位联系人数据[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.form.name.trim()) {
    return { success: false, error: "请填写单位名称" };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("companies")
    .update(组装单位写入值(参数.form))
    .eq("id", 参数.id);
  if (error) {
    return { success: false, error: error.message };
  }

  /* 同步联系人：先删除旧的，再插入新的 */
  const { error: delErr } = await supabase.from("company_contacts").delete().eq("company_id", 参数.id);
  if (delErr) {
    return { success: false, error: "删除旧联系人失败: " + delErr.message };
  }
  const validContacts = 参数.contacts.filter((c) => c.name.trim());
  if (validContacts.length > 0) {
    const { error: insErr } = await supabase.from("company_contacts").insert(
      validContacts.map((c) => ({
        company_id: 参数.id,
        name: c.name.trim(),
        phone: c.phone.trim() || null,
        title: c.title.trim() || null,
      }))
    );
    if (insErr) {
      return { success: false, error: "联系人保存失败: " + insErr.message };
    }
  }

  revalidatePath("/companies");
  revalidatePath(`/companies/${参数.id}`);
  return { success: true };
}

/* ═══ 单位删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联客户防止误删。 */
export async function 删除单位(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：该单位下是否还有客户 */
  const { count: customerCount } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("company_id", id);
  if (customerCount && customerCount > 0) {
    return { success: false, error: `无法删除：该单位下还有 ${customerCount} 个客户，请先处理。` };
  }

  const { error } = await supabase.from("companies").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/companies");
  return { success: true };
}
