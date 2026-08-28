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

/* ═══ 客户详情页：新建车辆并关联当前客户 ═══
 * 原来是客户端直写 vehicles，收口到服务端；
 * 车牌 trim+大写、车牌/VIN 唯一性校验在服务端兜底。 */
export async function 为客户新建车辆(参数: {
  customerId: string;
  plate_number: string;
  vin: string;
  brand: string;
  model: string;
  color: string;
  year: string;
  mileage: string;
}): Promise<保存结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const 车牌 = 参数.plate_number.trim().toUpperCase();
  if (!车牌) {
    return { success: false, error: "请填写车牌号" };
  }

  const supabase = await createClient();

  /* 车牌唯一性校验（数据库唯一锁为最后防线） */
  const { data: existingPlate } = await supabase
    .from("vehicles")
    .select("id")
    .eq("plate_number", 车牌)
    .maybeSingle();
  if (existingPlate) {
    return { success: false, error: "该车牌号已被使用，请更换" };
  }

  const vin = 参数.vin.trim().toUpperCase();
  if (vin) {
    const { data: existingVin } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", vin)
      .maybeSingle();
    if (existingVin) {
      return { success: false, error: "该 VIN 码已被使用，请更换" };
    }
  }

  const { data: vehicleData, error } = await supabase
    .from("vehicles")
    .insert({
      customer_id: 参数.customerId,
      plate_number: 车牌,
      vin: vin || null,
      brand: 参数.brand.trim() || null,
      model: 参数.model.trim() || null,
      color: 参数.color.trim() || null,
      year: 参数.year ? parseInt(参数.year) : null,
      mileage: 参数.mileage ? parseInt(参数.mileage) : null,
    })
    .select("id")
    .single();
  if (error || !vehicleData) {
    return { success: false, error: error?.message || "创建车辆失败" };
  }

  revalidatePath(`/customers/${参数.customerId}`);
  revalidatePath("/vehicles");
  return { success: true, id: vehicleData.id };
}

/* ═══ 合并客户（改名 + RPC 数据迁移，两步都在服务端顺序执行） ═══
 * 原来客户端先 update 名称再调 RPC，中途失败留半成品；收口到服务端。 */
export async function 合并客户(参数: {
  sourceId: string;
  targetId: string;
  newName: string | null; // 非空时先把保留客户改名为该值
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (参数.sourceId === 参数.targetId) {
    return { success: false, error: "不能选择同一个客户" };
  }

  const supabase = await createClient();

  /* 先更新保留客户的名称（如果需要） */
  if (参数.newName && 参数.newName.trim()) {
    const { error: nameErr } = await supabase
      .from("customers")
      .update({ name: 参数.newName.trim() })
      .eq("id", 参数.targetId);
    if (nameErr) {
      return { success: false, error: "更新客户名称失败: " + nameErr.message };
    }
  }

  const { data, error } = await supabase.rpc("merge_customers", {
    source_id: 参数.sourceId,
    target_id: 参数.targetId,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const result = data as { success?: boolean; error?: string };
  if (!result?.success) {
    return { success: false, error: result?.error || "未知错误" };
  }

  revalidatePath("/customers");
  return { success: true };
}

/* ═══ 客户 Excel 导入（查重 + 分批插入都在服务端） ═══
 * 客户端只负责解析 Excel，把行数据传过来；
 * 电话查重、分批插入全部在服务端做，避免客户端 session 异常中断导入。 */
export interface 客户导入行 {
  name: string;
  phone: string;
  gender?: string | null;
  company?: string | null;
  address?: string | null;
  id_card?: string | null;
  star_level?: number | null;
  notes?: string | null;
}

export async function 导入客户(参数: {
  rows: 客户导入行[];
}): Promise<{ success: boolean; inserted?: number; skipped?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const parsedRows = 参数.rows.filter((r) => r.name && r.phone);
  if (parsedRows.length === 0) {
    return { success: false, error: "没有有效的数据行（客户姓名和电话不能为空）" };
  }

  const supabase = await createClient();

  /* 电话查重（分批查） */
  const phones = parsedRows.map((r) => r.phone);
  const existingPhones = new Set<string>();
  for (let i = 0; i < phones.length; i += 500) {
    const { data } = await supabase.from("customers").select("phone").in("phone", phones.slice(i, i + 500));
    data?.forEach((r) => existingPhones.add(r.phone as string));
  }

  const newRows = parsedRows.filter((r) => !existingPhones.has(r.phone));
  const skipped = parsedRows.length - newRows.length;
  if (newRows.length === 0) {
    return { success: true, inserted: 0, skipped };
  }

  /* 分批插入 */
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < newRows.length; i += batchSize) {
    const batch = newRows.slice(i, i + batchSize);
    const { error } = await supabase.from("customers").insert(batch);
    if (error) {
      return { success: false, error: `第 ${Math.floor(i / batchSize) + 1} 批导入失败: ${error.message}（已导入 ${inserted} 条）` };
    }
    inserted += batch.length;
  }

  revalidatePath("/customers");
  return { success: true, inserted, skipped };
}

/* ═══ 快速编辑客户（工单等页面的简易弹窗，只改姓名和手机号） ═══ */
export async function 快速更新客户(参数: {
  id: string;
  name: string;
  phone: string;
  hasPhone: boolean;
}): Promise<{ success: boolean; data?: { id: string; name: string; phone: string | null }; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.name.trim()) {
    return { success: false, error: "姓名不能为空" };
  }
  if (参数.hasPhone && !参数.phone.trim()) {
    return { success: false, error: "请输入手机号" };
  }

  const supabase = await createClient();

  /* 手机号唯一性校验（排除自己） */
  if (参数.hasPhone && 参数.phone.trim()) {
    const { data: existingPhone } = await supabase
      .from("customers")
      .select("id")
      .eq("phone", 参数.phone.trim())
      .neq("id", 参数.id)
      .maybeSingle();
    if (existingPhone) {
      return { success: false, error: "该手机号已被其他客户使用，请更换" };
    }
  }

  const { data, error } = await supabase
    .from("customers")
    .update({ name: 参数.name.trim(), phone: 参数.hasPhone ? 参数.phone.trim() : null })
    .eq("id", 参数.id)
    .select("id, name, phone")
    .single();
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${参数.id}`);
  return { success: true, data: data as { id: string; name: string; phone: string | null } };
}
