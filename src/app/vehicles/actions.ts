"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
