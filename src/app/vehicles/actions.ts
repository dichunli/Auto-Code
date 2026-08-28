"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { 保养单草稿前缀, 计算需求顺延 } from "@/lib/maintenance";

/* ═══ 车辆删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联工单防止误删。 */
export async function 删除车辆(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：该车辆是否还有工单记录 */
  const { count: orderCount } = await supabase
    .from("work_orders")
    .select("*", { count: "exact", head: true })
    .eq("vehicle_id", id);
  if (orderCount && orderCount > 0) {
    return { success: false, error: `无法删除：该车辆还有 ${orderCount} 条工单记录。` };
  }

  const { error } = await supabase.from("vehicles").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/vehicles");
  return { success: true };
}

/* ═══ 变更车辆车主 ═══ */
export async function 变更车主(参数: {
  vehicleId: string;
  customerId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicles")
    .update({ customer_id: 参数.customerId })
    .eq("id", 参数.vehicleId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/vehicles");
  return { success: true };
}

/* ═══ 新建车辆（可现场新建车主，含照片） ═══
 * 车牌 trim+大写、VIN 唯一性校验在服务端兜底（数据库层也有唯一锁）。
 * 原来是客户端 4 步连写（建车主→查重→建车→插照片）。 */
export interface 新车表单 {
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
  vehicle_model_id: number | null;
}

export async function 新建车辆(参数: {
  existingCustomerId: string;
  newCustomer: { name: string; phone: string; gender: string } | null;
  companyId: string;
  form: 新车表单;
  photos: { category: string; url: string }[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const 车牌 = 参数.form.plate_number.trim().toUpperCase();
  if (!车牌) {
    return { success: false, error: "请填写车牌号" };
  }

  const supabase = await createClient();

  /* 1. 车主：现场新建 或 选已有 */
  let customerId = 参数.existingCustomerId;
  if (参数.newCustomer) {
    if (!参数.newCustomer.name.trim()) {
      return { success: false, error: "请填写新车主的姓名" };
    }
    const { data: cust, error: custErr } = await supabase
      .from("customers")
      .insert({
        name: 参数.newCustomer.name.trim(),
        phone: 参数.newCustomer.phone.trim() || null,
        gender: 参数.newCustomer.gender || null,
      })
      .select("id")
      .single();
    if (custErr || !cust) {
      return { success: false, error: "创建车主失败: " + (custErr?.message || "未知错误") };
    }
    customerId = cust.id;
  }
  if (!customerId) {
    return { success: false, error: "请选择车主" };
  }

  /* 2. 唯一性校验（服务端兜底，数据库唯一锁为最后防线） */
  const { data: existingPlate } = await supabase
    .from("vehicles")
    .select("id")
    .eq("plate_number", 车牌)
    .maybeSingle();
  if (existingPlate) {
    return { success: false, error: "该车牌号已被使用，请更换" };
  }

  const vin = 参数.form.vin.trim().toUpperCase();
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

  /* 3. 创建车辆 */
  const { data: vehicleData, error } = await supabase
    .from("vehicles")
    .insert({
      customer_id: customerId,
      company_id: 参数.companyId || null,
      vehicle_model_id: 参数.form.vehicle_model_id,
      plate_number: 车牌,
      vin: vin || null,
      brand: 参数.form.brand.trim() || null,
      model: 参数.form.model.trim() || null,
      engine_no: 参数.form.engine_no.trim() || null,
      chassis_code: 参数.form.chassis_code.trim() || null,
      transmission_type: 参数.form.transmission_type.trim() || null,
      transmission_code: 参数.form.transmission_code.trim() || null,
      color: 参数.form.color.trim() || null,
      year: 参数.form.year ? parseInt(参数.form.year) : null,
      mileage: 参数.form.mileage ? parseInt(参数.form.mileage) : null,
      notes: 参数.form.notes.trim() || null,
    })
    .select("id")
    .single();
  if (error || !vehicleData) {
    return { success: false, error: error?.message || "保存失败" };
  }

  /* 4. 照片（storage_path 非空字段，与 url 同值） */
  if (参数.photos.length > 0) {
    const { error: photoErr } = await supabase.from("vehicle_photos").insert(
      参数.photos.map((p) => ({
        vehicle_id: vehicleData.id,
        category: p.category,
        url: p.url,
        storage_path: p.url,
      }))
    );
    if (photoErr) {
      return { success: false, error: "车辆已保存，但照片记录写入失败: " + photoErr.message };
    }
  }

  revalidatePath("/vehicles");
  return { success: true, id: vehicleData.id };
}

/* ═══ 更新车辆（可现场新建车主，照片全量替换） ═══
 * 车牌/VIN 变更时的唯一性校验在服务端做（排除自己）；
 * 原来是客户端 5 步连写（建车主→查重→改车→删旧照片→插新照片）。 */
export async function 更新车辆(参数: {
  id: string;
  existingCustomerId: string;
  newCustomer: { name: string; phone: string; gender: string } | null;
  companyId: string;
  form: 新车表单;
  photos: { category: string; url: string }[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const 车牌 = 参数.form.plate_number.trim().toUpperCase();
  if (!车牌) {
    return { success: false, error: "请填写车牌号" };
  }

  const supabase = await createClient();

  /* 读当前车辆（唯一性校验只在新值变化时才查） */
  const { data: 当前车辆 } = await supabase
    .from("vehicles")
    .select("plate_number, vin")
    .eq("id", 参数.id)
    .single();
  if (!当前车辆) {
    return { success: false, error: "车辆不存在" };
  }

  /* 1. 车主：现场新建 或 选已有 */
  let finalCustomerId = 参数.existingCustomerId;
  if (参数.newCustomer) {
    if (!参数.newCustomer.name.trim()) {
      return { success: false, error: "请填写新车主的姓名" };
    }
    const { data: cust, error: custErr } = await supabase
      .from("customers")
      .insert({
        name: 参数.newCustomer.name.trim(),
        phone: 参数.newCustomer.phone.trim() || null,
        gender: 参数.newCustomer.gender || null,
      })
      .select("id")
      .single();
    if (custErr || !cust) {
      return { success: false, error: "创建车主失败: " + (custErr?.message || "未知错误") };
    }
    finalCustomerId = cust.id;
  }
  if (!finalCustomerId) {
    return { success: false, error: "请选择车主" };
  }

  /* 2. 唯一性校验（仅当值发生变化时，排除自己） */
  if (车牌 !== (当前车辆.plate_number || "").toUpperCase()) {
    const { data: existingPlate } = await supabase
      .from("vehicles")
      .select("id")
      .eq("plate_number", 车牌)
      .neq("id", 参数.id)
      .maybeSingle();
    if (existingPlate) {
      return { success: false, error: "该车牌号已被其他车辆使用，请更换" };
    }
  }

  const vin = 参数.form.vin.trim().toUpperCase();
  if (vin && vin !== (当前车辆.vin || "").toUpperCase()) {
    const { data: existingVin } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", vin)
      .neq("id", 参数.id)
      .maybeSingle();
    if (existingVin) {
      return { success: false, error: "该 VIN 码已被其他车辆使用，请更换" };
    }
  }

  /* 3. 更新车辆 */
  const { error } = await supabase
    .from("vehicles")
    .update({
      customer_id: finalCustomerId,
      company_id: 参数.companyId || null,
      vehicle_model_id: 参数.form.vehicle_model_id,
      plate_number: 车牌,
      vin: 参数.form.vin.trim() || null,
      brand: 参数.form.brand.trim() || null,
      model: 参数.form.model.trim() || null,
      engine_no: 参数.form.engine_no.trim() || null,
      chassis_code: 参数.form.chassis_code.trim() || null,
      transmission_type: 参数.form.transmission_type.trim() || null,
      transmission_code: 参数.form.transmission_code.trim() || null,
      color: 参数.form.color.trim() || null,
      year: 参数.form.year && /^\d+$/.test(参数.form.year) ? parseInt(参数.form.year) : null,
      mileage: 参数.form.mileage && /^\d+$/.test(参数.form.mileage) ? parseInt(参数.form.mileage) : null,
      notes: 参数.form.notes.trim() || null,
    })
    .eq("id", 参数.id);
  if (error) {
    return { success: false, error: error.message };
  }

  /* 4. 照片全量替换 */
  const { error: delErr } = await supabase.from("vehicle_photos").delete().eq("vehicle_id", 参数.id);
  if (delErr) {
    return { success: false, error: "车辆已保存，但旧照片清理失败: " + delErr.message };
  }
  if (参数.photos.length > 0) {
    const { error: photoErr } = await supabase.from("vehicle_photos").insert(
      参数.photos.map((p) => ({
        vehicle_id: 参数.id,
        category: p.category,
        url: p.url,
        storage_path: p.url,
      }))
    );
    if (photoErr) {
      return { success: false, error: "车辆已保存，但照片保存失败: " + photoErr.message };
    }
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${参数.id}`);
  return { success: true };
}

/* ═══ Excel 批量导入车辆（整条流水线在服务端完成） ═══
 * 客户端只负责解析 Excel，把行数据传过来；查重、找/建车主、
 * 找/建单位、分批插入全部在服务端做，避免客户端 session 异常中断导入。 */
export interface 车辆导入行 {
  plate: string;
  vin: string;
  brand: string;
  model: string;
  engine_no: string;
  color: string;
  year: number | null;
  mileage: number | null;
  ownerName: string;
  ownerPhone: string;
  companyName: string;
  notes: string;
}

export async function 导入车辆(参数: {
  rows: 车辆导入行[];
}): Promise<{ success: boolean; inserted?: number; skipped?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.rows || 参数.rows.length === 0) {
    return { success: false, error: "没有有效的数据行（车牌号不能为空）" };
  }

  const supabase = await createClient();
  const parsedRows = 参数.rows.filter((r) => r.plate);

  /* 1. 车牌 / VIN 查重（分批查） */
  const allPlates = parsedRows.map((r) => r.plate).filter(Boolean);
  const allVins = parsedRows.map((r) => r.vin).filter(Boolean);
  const existingPlates = new Set<string>();
  const existingVins = new Set<string>();

  for (let i = 0; i < allPlates.length; i += 500) {
    const { data } = await supabase.from("vehicles").select("plate_number").in("plate_number", allPlates.slice(i, i + 500));
    data?.forEach((r) => existingPlates.add(r.plate_number as string));
  }
  for (let i = 0; i < allVins.length; i += 500) {
    const { data } = await supabase.from("vehicles").select("vin").in("vin", allVins.slice(i, i + 500));
    data?.forEach((r) => { if (r.vin) existingVins.add(r.vin as string); });
  }

  const newRows = parsedRows.filter((r) => {
    if (existingPlates.has(r.plate)) return false;
    if (r.vin && existingVins.has(r.vin)) return false;
    return true;
  });
  const skipped = parsedRows.length - newRows.length;
  if (newRows.length === 0) {
    return { success: true, inserted: 0, skipped };
  }

  /* 2. 批量查找车主（电话优先、姓名补充）和单位 */
  const phoneToCustomerId = new Map<string, string>();
  const nameToCustomerId = new Map<string, string>();
  const companyNameToId = new Map<string, string>();

  const uniquePhones = [...new Set(newRows.map((r) => r.ownerPhone).filter(Boolean))];
  const uniqueNames = [...new Set(newRows.map((r) => r.ownerName).filter(Boolean))];
  const uniqueCompanies = [...new Set(newRows.map((r) => r.companyName).filter(Boolean))];

  for (let i = 0; i < uniquePhones.length; i += 500) {
    const { data } = await supabase.from("customers").select("id, phone").in("phone", uniquePhones.slice(i, i + 500));
    data?.forEach((r) => phoneToCustomerId.set(r.phone as string, r.id as string));
  }
  const unmatchedNames = uniqueNames.filter(
    (n) => !newRows.some((r) => r.ownerName === n && r.ownerPhone && phoneToCustomerId.has(r.ownerPhone))
  );
  for (let i = 0; i < unmatchedNames.length; i += 500) {
    const { data } = await supabase.from("customers").select("id, name").in("name", unmatchedNames.slice(i, i + 500));
    data?.forEach((r) => {
      if (!nameToCustomerId.has(r.name as string)) nameToCustomerId.set(r.name as string, r.id as string);
    });
  }
  for (let i = 0; i < uniqueCompanies.length; i += 500) {
    const { data } = await supabase.from("companies").select("id, name").in("name", uniqueCompanies.slice(i, i + 500));
    data?.forEach((r) => companyNameToId.set(r.name as string, r.id as string));
  }

  /* 3. 为找不到车主的行创建新客户（先过滤掉手机号已存在的） */
  const createdPhoneToId = new Map<string, string>();
  const customersToCreate: { name: string; phone: string }[] = [];
  for (const row of newRows) {
    if (!row.ownerPhone && !row.ownerName) continue;
    let foundId: string | null = null;
    if (row.ownerPhone) foundId = phoneToCustomerId.get(row.ownerPhone) || null;
    if (!foundId && row.ownerName) foundId = nameToCustomerId.get(row.ownerName) || null;
    if (!foundId && row.ownerPhone) {
      const key = `${row.ownerName}|${row.ownerPhone}`;
      if (!createdPhoneToId.has(key)) {
        customersToCreate.push({ name: row.ownerName || row.ownerPhone, phone: row.ownerPhone });
        createdPhoneToId.set(key, "pending");
      }
    }
  }
  if (customersToCreate.length > 0) {
    const phonesToCreate = customersToCreate.map((c) => c.phone);
    const { data: existingPhoneData } = await supabase.from("customers").select("id, phone").in("phone", phonesToCreate);
    const existingPhoneSet = new Set((existingPhoneData || []).map((r) => r.phone as string));
    const filteredCreate = customersToCreate.filter((c) => !existingPhoneSet.has(c.phone));

    if (filteredCreate.length > 0) {
      const { data: insertedCustomers, error: custErr } = await supabase
        .from("customers")
        .insert(filteredCreate)
        .select("id, phone");
      if (custErr) {
        return { success: false, error: "创建车主失败: " + custErr.message };
      }
      insertedCustomers?.forEach((r) => createdPhoneToId.set(r.phone as string, r.id as string));
    }
    existingPhoneData?.forEach((r) => createdPhoneToId.set(r.phone as string, r.id as string));
  }

  /* 4. 为找不到单位的行创建新单位 */
  const createdCompanyToId = new Map<string, string>();
  const companiesToCreate: { name: string }[] = [];
  for (const row of newRows) {
    if (!row.companyName) continue;
    if (!companyNameToId.has(row.companyName) && !createdCompanyToId.has(row.companyName)) {
      companiesToCreate.push({ name: row.companyName });
      createdCompanyToId.set(row.companyName, "pending");
    }
  }
  if (companiesToCreate.length > 0) {
    const { data: insertedCompanies, error: compErr } = await supabase
      .from("companies")
      .insert(companiesToCreate)
      .select("id, name");
    if (compErr) {
      return { success: false, error: "创建单位失败: " + compErr.message };
    }
    insertedCompanies?.forEach((r) => createdCompanyToId.set(r.name as string, r.id as string));
  }

  /* 5. 组装并分批插入车辆 */
  const vehicleRecords = newRows.map((row) => {
    let customerId: string | null = null;
    if (row.ownerPhone) {
      customerId = phoneToCustomerId.get(row.ownerPhone) || createdPhoneToId.get(row.ownerPhone) || null;
    }
    if (!customerId && row.ownerName) {
      customerId = nameToCustomerId.get(row.ownerName) || null;
    }
    let companyId: string | null = null;
    if (row.companyName) {
      companyId = companyNameToId.get(row.companyName) || createdCompanyToId.get(row.companyName) || null;
    }
    return {
      plate_number: row.plate,
      vin: row.vin || null,
      brand: row.brand || null,
      model: row.model || null,
      engine_no: row.engine_no || null,
      color: row.color || null,
      year: row.year,
      mileage: row.mileage,
      customer_id: customerId,
      company_id: companyId,
      notes: row.notes || null,
    };
  });

  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < vehicleRecords.length; i += batchSize) {
    const batch = vehicleRecords.slice(i, i + batchSize);
    const { error } = await supabase.from("vehicles").insert(batch);
    if (error) {
      return { success: false, error: `第 ${Math.floor(i / batchSize) + 1} 批导入失败: ${error.message}（已导入 ${inserted} 条）` };
    }
    inserted += batch.length;
  }

  revalidatePath("/vehicles");
  return { success: true, inserted, skipped };
}

/* ═══ 替换车牌（手机接车 VIN 重复时把旧车牌换成新车牌）═══
 * 客户端直写收口到服务端；车牌唯一性由数据库唯一约束兜底。 */
export async function 替换车牌(参数: {
  vehicleId: string;
  plate: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const 车牌 = 参数.plate.trim().toUpperCase();
  if (!车牌) {
    return { success: false, error: "车牌号不能为空" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicles")
    .update({ plate_number: 车牌 })
    .eq("id", 参数.vehicleId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/vehicles");
  return { success: true };
}

/* ═══ 新建保养模板（车辆保养模板页提交）═══
 * 模板 + 项目 + 配件三层插入全部挪到服务端，
 * 避免客户端 session 异常导致只存了半截模板。 */
export interface 保养模板配件输入 {
  part_name_id: string;
  part_id: string;
  quantity: string;
  name: string;
  brand: string;
  specification: string;
  unit_cost: string;
  unit_price: string;
}

export interface 保养模板项目输入 {
  service_item_id: string;
  name: string;
  item_type: "labor" | "part" | "other";
  quantity: string;
  unit_price: string;
  mechanic_id: string;
  standard_hours: string;
  parts: 保养模板配件输入[];
}

export async function 新建保养模板(参数: {
  vehicleId: string;
  name: string;
  previousCost: string;
  customerNotes: string;
  items: 保养模板项目输入[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.name.trim()) {
    return { success: false, error: "请输入模板名称" };
  }

  const supabase = await createClient();

  /* 1. 创建模板 */
  const { data: template, error: tErr } = await supabase
    .from("vehicle_maintenance_templates")
    .insert({
      vehicle_id: 参数.vehicleId,
      name: 参数.name.trim(),
      previous_cost: 参数.previousCost ? parseFloat(参数.previousCost) : null,
      customer_notes: 参数.customerNotes || null,
    })
    .select("id")
    .single();
  if (tErr || !template) {
    return { success: false, error: tErr?.message || "创建模板失败" };
  }

  /* 2. 逐个项目 + 配件（与原来客户端循环逻辑一致） */
  for (const item of 参数.items) {
    if (!item.name) continue;
    const { data: createdItem, error: itemErr } = await supabase
      .from("vehicle_maintenance_template_items")
      .insert({
        template_id: template.id,
        service_item_id: item.service_item_id || null,
        name: item.name,
        item_type: item.item_type,
        quantity: parseFloat(item.quantity) || 1,
        unit_price: parseFloat(item.unit_price) || 0,
        standard_hours: item.standard_hours ? parseFloat(item.standard_hours) : null,
        mechanic_id: item.mechanic_id || null,
      })
      .select("id")
      .single();
    if (itemErr || !createdItem) {
      return { success: false, error: itemErr?.message || "创建模板项目失败" };
    }

    for (const part of item.parts) {
      if (!part.part_name_id && !part.name) continue;
      const { error: partErr } = await supabase
        .from("vehicle_maintenance_template_parts")
        .insert({
          template_item_id: createdItem.id,
          part_name_id: part.part_name_id || null,
          part_id: part.part_id || null,
          quantity: parseInt(part.quantity) || 1,
          name: part.name || null,
          brand: part.brand || null,
          specification: part.specification || null,
          unit_cost: parseFloat(part.unit_cost) || null,
          unit_price: parseFloat(part.unit_price) || null,
        });
      if (partErr) {
        return { success: false, error: partErr.message };
      }
    }
  }

  revalidatePath(`/vehicles/${参数.vehicleId}/templates`);
  return { success: true };
}

/* ═══ 创建保养单（从工单复制生成 DRAFT- 草稿）═══
 * 检查已有 → 清残留草稿 → 建草稿 → 复制需求/项目/配件，整条流水线在服务端完成。
 * 配件目录（branch_group_id）必须重新生成，不能沿用源工单目录——
 * 否则两单共用目录，切换选中分支/加减分支会跨单互串。 */
export async function 创建保养单(参数: {
  vehicleId: string;
  customerId: string;
  orderId: string;
}): Promise<{
  success: boolean;
  orderId?: string;
  existingOrder?: { id: string; order_no: string };
  error?: string;
}> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 1. 检查是否已有正式保养单（排除 DRAFT- 草稿） */
  const { data: 已有 } = await supabase
    .from("work_orders")
    .select("id, order_no")
    .eq("vehicle_id", 参数.vehicleId)
    .eq("order_type", "maintenance")
    .not("order_no", "like", 保养单草稿前缀 + "%")
    .limit(1);
  if (已有 && 已有.length > 0) {
    return { success: true, existingOrder: 已有[0] };
  }

  /* 2. 删除该车辆旧的未保存草稿（上次创建后直接关窗口残留的） */
  await supabase
    .from("work_orders")
    .delete()
    .eq("vehicle_id", 参数.vehicleId)
    .eq("order_type", "maintenance")
    .like("order_no", 保养单草稿前缀 + "%");

  /* 3. 获取源工单信息 */
  const { data: 当前工单 } = await supabase
    .from("work_orders")
    .select("mileage_in, customer_complaint")
    .eq("id", 参数.orderId)
    .single();

  /* 草稿单号：DRAFT- 前缀，保存时才换成正式 BY- 单号。
   * 列表和导入都排除 DRAFT- 前缀，直接关窗口的残留等于不存在 */
  const 草稿单号 = 保养单草稿前缀 + Date.now();

  /* 4. 创建保养单草稿（复制工单基本信息） */
  const { data: 新工单, error: 创建错误 } = await supabase
    .from("work_orders")
    .insert({
      order_no: 草稿单号,
      vehicle_id: 参数.vehicleId,
      customer_id: 参数.customerId,
      order_type: "maintenance",
      status: "pending_diagnosis",
      mileage_in: (当前工单 as { mileage_in?: number } | null)?.mileage_in || 0,
      customer_complaint: (当前工单 as { customer_complaint?: string | null } | null)?.customer_complaint || null,
    })
    .select("id")
    .single();
  if (创建错误 || !新工单) {
    return { success: false, error: 创建错误?.message || "未返回工单信息" };
  }
  const 新工单ID = 新工单.id;

  /* ── 复制源工单内容：需求 → 项目 → 配件（白名单列）── */

  /* 5. 复制需求 */
  const { data: 源需求列表 } = await supabase
    .from("work_order_requirements")
    .select("id, seq, description, diagnosis, remarks, submitted_by, assigned_to, assignment_type")
    .eq("work_order_id", 参数.orderId)
    .order("seq", { ascending: true })
    .order("created_at", { ascending: true });

  const 需求ID映射: Record<string, string> = {};
  if (源需求列表 && 源需求列表.length > 0) {
    for (const 源需求 of 源需求列表) {
      const { data: 新需求 } = await supabase
        .from("work_order_requirements")
        .insert({
          work_order_id: 新工单ID,
          seq: 源需求.seq,
          description: 源需求.description,
          diagnosis: 源需求.diagnosis,
          remarks: 源需求.remarks,
          submitted_by: 源需求.submitted_by,
          assigned_to: 源需求.assigned_to,
          assignment_type: 源需求.assignment_type,
        })
        .select("id")
        .single();
      if (新需求) {
        需求ID映射[源需求.id] = 新需求.id;
      }
    }
  }

  /* 6. 复制项目 */
  const { data: 源项目列表 } = await supabase
    .from("work_order_items")
    .select("id, requirement_id, service_item_id, name, alias_name, item_type, description, quantity, unit_price, mechanic_id, status, customer_opinion, is_outsourced, outsourced_supplier_id, business_type, rework_source_item_id, rework_reason, rework_loss_amount, sort_order, require_qc")
    .eq("work_order_id", 参数.orderId)
    .order("created_at", { ascending: true });

  const 项目ID映射: Record<string, string> = {};
  if (源项目列表 && 源项目列表.length > 0) {
    for (const 源项目 of 源项目列表) {
      const 新项目数据: Record<string, unknown> = {
        work_order_id: 新工单ID,
        service_item_id: 源项目.service_item_id,
        name: 源项目.name,
        alias_name: 源项目.alias_name,
        item_type: 源项目.item_type,
        description: 源项目.description,
        quantity: 源项目.quantity,
        unit_price: 源项目.unit_price,
        mechanic_id: 源项目.mechanic_id,
        status: 源项目.status,
        customer_opinion: 源项目.customer_opinion,
        is_outsourced: 源项目.is_outsourced,
        outsourced_supplier_id: 源项目.outsourced_supplier_id,
        business_type: 源项目.business_type,
        rework_source_item_id: 源项目.rework_source_item_id,
        rework_reason: 源项目.rework_reason,
        rework_loss_amount: 源项目.rework_loss_amount,
        sort_order: 源项目.sort_order,
        /* 复制时保留原项目的"必须质检"设置 */
        require_qc: 源项目.require_qc,
      };
      if (源项目.requirement_id && 需求ID映射[源项目.requirement_id]) {
        新项目数据.requirement_id = 需求ID映射[源项目.requirement_id];
      }
      const { data: 新项目 } = await supabase
        .from("work_order_items")
        .insert(新项目数据)
        .select("id")
        .single();
      if (新项目) {
        项目ID映射[源项目.id] = 新项目.id;
      }
    }
  }

  /* 7. 复制配件 */
  const 源项目ID列表 = (源项目列表 || []).map((i: { id: string }) => i.id);
  if (源项目ID列表.length > 0) {
    const { data: 源配件列表 } = await supabase
      .from("work_order_item_parts")
      .select("id, work_order_item_id, part_name_id, part_id, batch_id, part_number, name, alias_name, unit, brand, specification, unit_cost, unit_price, quantity, customer_opinion, is_purchased, is_arrived, supplier_name, logistics_agreement, status, notes, cost_price, is_selected, sort_order, revoke_reason, branch_group_id")
      .in("work_order_item_id", 源项目ID列表)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (源配件列表 && 源配件列表.length > 0) {
      /* 目录ID映射：源目录 → 新目录。同组的多个分支仍映射到同一个新目录，保持组内关系。 */
      const 目录映射 = new Map<string, string>();
      const 新配件列表 = 源配件列表
        .filter((源配件) => 项目ID映射[源配件.work_order_item_id])
        .map((源配件) => {
          let 新目录id: string | null = null;
          if (源配件.branch_group_id) {
            if (!目录映射.has(源配件.branch_group_id)) {
              目录映射.set(源配件.branch_group_id, crypto.randomUUID());
            }
            新目录id = 目录映射.get(源配件.branch_group_id)!;
          }
          return {
            work_order_item_id: 项目ID映射[源配件.work_order_item_id],
            part_name_id: 源配件.part_name_id,
            part_id: 源配件.part_id,
            batch_id: 源配件.batch_id,
            part_number: 源配件.part_number,
            name: 源配件.name,
            alias_name: 源配件.alias_name,
            unit: 源配件.unit,
            brand: 源配件.brand,
            specification: 源配件.specification,
            unit_cost: 源配件.unit_cost,
            unit_price: 源配件.unit_price,
            quantity: 源配件.quantity,
            customer_opinion: 源配件.customer_opinion,
            is_purchased: 源配件.is_purchased,
            is_arrived: 源配件.is_arrived,
            supplier_name: 源配件.supplier_name,
            logistics_agreement: 源配件.logistics_agreement,
            status: 源配件.status,
            notes: 源配件.notes,
            cost_price: 源配件.cost_price,
            is_selected: 源配件.is_selected,
            sort_order: 源配件.sort_order,
            revoke_reason: 源配件.revoke_reason,
            branch_group_id: 新目录id,
          };
        });

      for (let i = 0; i < 新配件列表.length; i += 50) {
        const 批次 = 新配件列表.slice(i, i + 50);
        await supabase.from("work_order_item_parts").insert(批次);
      }
    }
  }

  return { success: true, orderId: 新工单ID };
}

/* ═══ 从保养单导入项目到当前工单 ═══
 * 覆盖删旧 → 需求顺延 → 建需求 → 插项目 → 插配件，全部挪到服务端。
 * 配件写入沿用 add_work_order_item_parts RPC（与"添加工单配件"同一通道）。 */
export interface 保养导入项目 {
  id: string;
  service_item_id: string | null;
  name: string;
  item_type: string;
  quantity: number;
  unit_price: number;
  description: string | null;
  mechanic_id: string | null;
}

export interface 保养导入配件 {
  part_name_id: string | null;
  part_id: string | null;
  name: string;
  part_number: string | null;
  unit: string | null;
  brand: string | null;
  specification: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number | null;
  notes: string | null;
}

export async function 导入保养单到工单(参数: {
  orderId: string;
  orderNo: string;
  处理模式: "跳过" | "覆盖";
  重复项目名: string[];
  项目列表: 保养导入项目[];
  配件映射: Record<string, 保养导入配件[]>;
}): Promise<{ success: boolean; 跳过数量?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 1. 当前工单已有项目（覆盖时按名删除，跳过时按名过滤） */
  const { data: 已有项目 } = await supabase
    .from("work_order_items")
    .select("id, name")
    .eq("work_order_id", 参数.orderId);
  const 已有名称集 = new Set((已有项目 || []).map((i: { name: string }) => i.name));

  /* 2. 覆盖模式：先删除当前工单中同名的项目（配件随级联删除） */
  if (参数.处理模式 === "覆盖" && 参数.重复项目名.length > 0) {
    const 待删除ID = (已有项目 || [])
      .filter((i: { id: string; name: string }) => 参数.重复项目名.includes(i.name))
      .map((i: { id: string; name: string }) => i.id);
    if (待删除ID.length > 0) {
      const { error: 删除错误 } = await supabase
        .from("work_order_items")
        .delete()
        .in("id", 待删除ID);
      if (删除错误) {
        return { success: false, error: 删除错误.message };
      }
    }
  }

  /* 3. 已有需求 seq 全部顺延，为导入需求腾出位置 1（各行 update 互不依赖，并行发起） */
  const { data: 已有需求列表 } = await supabase
    .from("work_order_requirements")
    .select("id, seq")
    .eq("work_order_id", 参数.orderId)
    .order("seq", { ascending: true });
  if (已有需求列表 && 已有需求列表.length > 0) {
    const 顺延后seq = 计算需求顺延(已有需求列表.map((r: { seq: number | null }) => r.seq || 1));
    await Promise.all(
      已有需求列表.map((r, i) =>
        supabase
          .from("work_order_requirements")
          .update({ seq: 顺延后seq[i] })
          .eq("id", r.id)
      )
    );
  }

  /* 4. 创建需求，seq=1（需求1） */
  const { data: 需求, error: 需求错误 } = await supabase
    .from("work_order_requirements")
    .insert({
      work_order_id: 参数.orderId,
      seq: 1,
      description: `保养单导入: ${参数.orderNo}`,
      diagnosis: "",
    })
    .select("id")
    .single();
  if (需求错误) {
    return { success: false, error: 需求错误.message };
  }

  /* 5. 跳过模式剔除重名项目（客户端已按勾选过滤，这里只按名称剔除） */
  let 跳过数量 = 0;
  const 待导入项目 = 参数.项目列表.filter((项目) => {
    if (参数.处理模式 === "跳过" && 已有名称集.has(项目.name)) {
      跳过数量++;
      return false;
    }
    return true;
  });

  /* 6. 项目并行插入（每条返回自己的 id，对应关系可靠） */
  const 新项目结果 = await Promise.all(
    待导入项目.map((项目) =>
      supabase
        .from("work_order_items")
        .insert({
          work_order_id: 参数.orderId,
          requirement_id: 需求?.id || null,
          service_item_id: 项目.service_item_id,
          name: 项目.name,
          item_type: 项目.item_type,
          quantity: 项目.quantity || 1,
          unit_price: 项目.unit_price || 0,
          description: 项目.description,
          mechanic_id: 项目.mechanic_id,
          customer_opinion: "agree",
          business_type: "normal",
        })
        .select("id")
        .single()
    )
  );

  /* 7. 勾选配件按新项目分组，走 add_work_order_item_parts RPC（与"添加工单配件"同一通道） */
  const 按项目配件 = new Map<string, Record<string, unknown>[]>();
  待导入项目.forEach((项目, idx) => {
    const 新项目 = 新项目结果[idx]?.data;
    if (!新项目) return;
    const 清单 = (参数.配件映射[项目.id] || []).map((配件) => ({
      part_name_id: 配件.part_name_id,
      part_id: 配件.part_id,
      name: 配件.name,
      part_number: 配件.part_number,
      unit: 配件.unit,
      brand: 配件.brand,
      specification: 配件.specification,
      quantity: 配件.quantity || 1,
      unit_price: 配件.unit_price,
      unit_cost: 配件.unit_cost,
      notes: 配件.notes,
      customer_opinion: "agree",
      is_selected: true,
    }));
    if (清单.length > 0) {
      按项目配件.set(新项目.id, 清单);
    }
  });

  if (按项目配件.size > 0) {
    const 配件结果列表 = await Promise.all(
      [...按项目配件.entries()].map(async ([新项目id, 清单]) => {
        const { data, error } = await supabase.rpc("add_work_order_item_parts", {
          p_item_id: 新项目id,
          p_parts: 清单,
        });
        if (error) return { success: false, error: error.message };
        const 结果 = data as unknown as { success: boolean; error?: string };
        if (!结果?.success) return { success: false, error: 结果?.error || "导入配件失败" };
        return { success: true, error: undefined };
      })
    );
    const 失败 = 配件结果列表.find((r) => !r.success);
    if (失败) {
      return { success: false, error: 失败.error || "导入配件失败" };
    }
  }

  revalidatePath(`/work-orders/${参数.orderId}`);
  return { success: true, 跳过数量 };
}
