"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 客户新建/编辑 Server Action ═══
 * 客户的写库操作（新建 5 处、编辑 9 处）集中到这里走服务端，
 * 避免客户端 session 异常导致保存 401 / 被 RLS 拦截。
 * 页面上的只读查询（手机号联想、加载客户资料）仍走客户端。 */

export interface 客户表单数据 {
  name: string;
  phone: string;
  gender: string;
  address: string;
  company: string;
  id_card: string;
  notes: string;
}

export interface 备用手机号数据 {
  phone: string;
  label: string;
}

export interface 联系人数据 {
  name: string;
  phone: string;
  relationship: string;
  notes: string;
}

export interface 新建车辆数据 {
  plate_number: string;
  vin: string;
  brand: string;
  model: string;
  engine_no: string;
  chassis_code: string;
  transmission_type: string;
  transmission_code: string;
  color: string;
  year: string;
  mileage: string;
  notes: string;
}

interface 保存结果 {
  success: boolean;
  id?: string;
  error?: string;
}

/* ─── 新建客户（含照片、备用手机号、联系人、车辆） ─── */
export async function 新建客户(参数: {
  customer: 客户表单数据;
  hasPhone: boolean;
  customerPhotos: string[];
  customerPhones: 备用手机号数据[];
  contacts: 联系人数据[];
  vehicles: 新建车辆数据[];
}): Promise<保存结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const { customer, hasPhone, customerPhotos, customerPhones, contacts, vehicles } = 参数;

  /* 服务端再校验一遍必填（前端已校验，这里兜底） */
  if (!customer.name.trim()) {
    return { success: false, error: "请填写客户姓名" };
  }
  if (hasPhone && !customer.phone.trim()) {
    return { success: false, error: "请填写手机号" };
  }

  const supabase = await createClient();

  /* 手机号唯一性校验 */
  if (hasPhone && customer.phone.trim()) {
    const { data: existingPhone } = await supabase
      .from("customers")
      .select("id")
      .eq("phone", customer.phone.trim())
      .maybeSingle();
    if (existingPhone) {
      return { success: false, error: "该手机号已存在，请更换" };
    }
  }

  const { data: customerData, error: customerError } = await supabase
    .from("customers")
    .insert({
      name: customer.name.trim(),
      phone: hasPhone ? customer.phone.trim() : null,
      gender: customer.gender || null,
      address: customer.address.trim() || null,
      company: customer.company.trim() || null,
      id_card: customer.id_card.trim() || null,
      notes: customer.notes.trim() || null,
    })
    .select("id")
    .single();

  if (customerError) {
    return { success: false, error: "客户保存失败: " + customerError.message };
  }
  if (!customerData?.id) {
    return { success: false, error: "创建客户后未返回 ID" };
  }

  const customerId = customerData.id;

  /* 保存客户照片 */
  if (customerPhotos.length > 0) {
    await supabase.from("customer_photos").insert(
      customerPhotos.map((url) => ({ customer_id: customerId, category: "photo", url }))
    );
  }

  /* 保存备用手机号 */
  const validPhones = customerPhones.filter((p) => p.phone.trim());
  if (validPhones.length > 0) {
    const { error: phoneError } = await supabase.from("customer_phones").insert(
      validPhones.map((p) => ({
        customer_id: customerId,
        phone: p.phone.trim(),
        label: p.label.trim() || null,
      }))
    );
    if (phoneError) {
      return { success: false, error: "备用手机号保存失败: " + phoneError.message };
    }
  }

  /* 保存联系人 */
  const validContacts = contacts.filter((c) => c.name.trim() && c.phone.trim());
  if (validContacts.length > 0) {
    const { error: contactError } = await supabase.from("customer_contacts").insert(
      validContacts.map((c) => ({
        customer_id: customerId,
        name: c.name.trim(),
        phone: c.phone.trim(),
        relationship: c.relationship.trim() || null,
        notes: c.notes.trim() || null,
      }))
    );
    if (contactError) {
      return { success: false, error: "联系人保存失败: " + contactError.message };
    }
  }

  /* 批量创建车辆 */
  const validVehicles = vehicles.filter((v) => v.plate_number.trim());
  if (validVehicles.length > 0) {
    const { error: vehicleError } = await supabase.from("vehicles").insert(
      validVehicles.map((v) => ({
        customer_id: customerId,
        plate_number: v.plate_number.trim(),
        vin: v.vin.trim() || null,
        brand: v.brand.trim() || null,
        model: v.model.trim() || null,
        engine_no: v.engine_no.trim() || null,
        chassis_code: v.chassis_code.trim() || null,
        transmission_type: v.transmission_type.trim() || null,
        transmission_code: v.transmission_code.trim() || null,
        color: v.color.trim() || null,
        year: v.year ? parseInt(v.year) : null,
        mileage: v.mileage ? parseInt(v.mileage) : null,
        notes: v.notes.trim() || null,
      }))
    );
    if (vehicleError) {
      return { success: false, error: "车辆保存失败: " + vehicleError.message };
    }
  }

  revalidatePath("/customers");
  return { success: true, id: customerId };
}

/* ─── 更新客户（主表更新 + 手机号/联系人/照片/标签先删后插） ─── */
export async function 更新客户(参数: {
  id: string;
  customer: 客户表单数据;
  hasPhone: boolean;
  originalPhone: string;
  starLevel: number;
  customerPhotos: string[];
  customerPhones: 备用手机号数据[];
  contacts: 联系人数据[];
  selectedTagIds: string[];
}): Promise<保存结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const { id, customer, hasPhone, originalPhone, starLevel, customerPhotos, customerPhones, contacts, selectedTagIds } = 参数;

  if (!customer.name.trim()) {
    return { success: false, error: "请填写客户姓名" };
  }
  if (hasPhone && !customer.phone.trim()) {
    return { success: false, error: "请填写手机号" };
  }

  const supabase = await createClient();

  /* 手机号唯一性校验（变更时才检查） */
  if (hasPhone && customer.phone.trim() && customer.phone.trim() !== originalPhone.trim()) {
    const { data: existingPhone } = await supabase
      .from("customers")
      .select("id")
      .eq("phone", customer.phone.trim())
      .neq("id", id)
      .maybeSingle();
    if (existingPhone) {
      return { success: false, error: "该手机号已被其他客户使用，请更换" };
    }
  }

  const { error } = await supabase
    .from("customers")
    .update({
      name: customer.name.trim(),
      phone: hasPhone ? customer.phone.trim() : null,
      gender: customer.gender || null,
      address: customer.address.trim() || null,
      company: customer.company.trim() || null,
      id_card: customer.id_card.trim() || null,
      notes: customer.notes.trim() || null,
      star_level: starLevel || null,
    })
    .eq("id", id);

  if (error) {
    return { success: false, error: "保存失败: " + error.message };
  }

  /* 备用手机号：删除旧记录，插入新记录 */
  const { error: delPhoneError } = await supabase.from("customer_phones").delete().eq("customer_id", id);
  if (delPhoneError) {
    return { success: false, error: "删除旧手机号失败: " + delPhoneError.message };
  }
  const validPhones = customerPhones.filter((p) => p.phone.trim());
  if (validPhones.length > 0) {
    const { error: insPhoneError } = await supabase.from("customer_phones").insert(
      validPhones.map((p) => ({
        customer_id: id,
        phone: p.phone.trim(),
        label: p.label.trim() || null,
      }))
    );
    if (insPhoneError) {
      return { success: false, error: "备用手机号保存失败: " + insPhoneError.message };
    }
  }

  /* 联系人：删除旧记录，插入新记录 */
  const { error: delContactError } = await supabase.from("customer_contacts").delete().eq("customer_id", id);
  if (delContactError) {
    return { success: false, error: "删除旧联系人失败: " + delContactError.message };
  }
  const validContacts = contacts.filter((c) => c.name.trim() && c.phone.trim());
  if (validContacts.length > 0) {
    const { error: insContactError } = await supabase.from("customer_contacts").insert(
      validContacts.map((c) => ({
        customer_id: id,
        name: c.name.trim(),
        phone: c.phone.trim(),
        relationship: c.relationship.trim() || null,
        notes: c.notes.trim() || null,
      }))
    );
    if (insContactError) {
      return { success: false, error: "联系人保存失败: " + insContactError.message };
    }
  }

  /* 客户照片：删除旧记录，插入新记录 */
  await supabase.from("customer_photos").delete().eq("customer_id", id);
  if (customerPhotos.length > 0) {
    await supabase.from("customer_photos").insert(
      customerPhotos.map((url) => ({ customer_id: id, category: "photo", url }))
    );
  }

  /* 客户标签：删除旧记录，插入新记录 */
  const { error: delTagError } = await supabase.from("customer_tags").delete().eq("customer_id", id);
  if (delTagError) {
    return { success: false, error: "删除旧标签失败: " + delTagError.message };
  }
  if (selectedTagIds.length > 0) {
    const { error: insTagError } = await supabase.from("customer_tags").insert(
      selectedTagIds.map((tagId) => ({ customer_id: id, tag_id: tagId }))
    );
    if (insTagError) {
      return { success: false, error: "标签保存失败: " + insTagError.message };
    }
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  return { success: true, id };
}

/* ═══ 客户删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联数据防止误删。 */
export async function 删除客户(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：关联车辆 */
  const { count: vehicleCount } = await supabase
    .from("vehicles")
    .select("*", { count: "exact", head: true })
    .eq("customer_id", id);
  if (vehicleCount && vehicleCount > 0) {
    return { success: false, error: `无法删除：该客户下还有 ${vehicleCount} 辆车辆，请先处理。` };
  }

  /* 删除前检查：关联工单 */
  const { count: orderCount } = await supabase
    .from("work_orders")
    .select("*", { count: "exact", head: true })
    .eq("customer_id", id);
  if (orderCount && orderCount > 0) {
    return { success: false, error: `无法删除：该客户还有 ${orderCount} 条工单记录。` };
  }

  /* 删除前检查：关联会员 */
  const { count: memberCount } = await supabase
    .from("members")
    .select("*", { count: "exact", head: true })
    .eq("customer_id", id);
  if (memberCount && memberCount > 0) {
    return { success: false, error: "无法删除：该客户已办理会员，请先处理。" };
  }

  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/customers");
  return { success: true };
}
