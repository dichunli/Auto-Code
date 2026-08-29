"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 工具借用 Server Action ═══
 * 借用登记（插借用记录 + 改工具状态）从客户端直写收口到服务端，
 * 两步写在同一个 action 里顺序执行，避免只成一半。
 * borrowerId 是页面上选择的借用人（浏览器端可代选员工），属于业务字段，照常由客户端传入。 */
export async function 借用工具(参数: {
  toolId: string;
  borrowerId: string;
  notes: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  const { error: insertError } = await supabase.from("tool_borrow_records").insert({
    tool_id: 参数.toolId,
    borrower_id: 参数.borrowerId,
    borrowed_at: new Date().toISOString(),
    notes: 参数.notes.trim() || null,
  });
  if (insertError) {
    return { success: false, error: insertError.message };
  }

  const { error: updateError } = await supabase
    .from("tools")
    .update({ status: "borrowed", updated_at: new Date().toISOString() })
    .eq("id", 参数.toolId);
  if (updateError) {
    return { success: false, error: updateError.message };
  }

  revalidatePath("/tools/management");
  return { success: true };
}

/* ═══ 工具归还 Server Action ═══
 * 归还登记（改借用记录 + 存归还照片 + 改工具状态）从客户端直写收口到服务端。
 * notes 由客户端合并好（含归还备注/仓位扫码信息）后整体传入；
 * 照片保存失败只记日志不中断流程（沿用原客户端 console.warn 语义）。 */
export async function 归还工具(参数: {
  recordId: string;
  toolId: string;
  returnerId: string;
  notes: string;
  photos: string[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  const { error: updateRecordError } = await supabase
    .from("tool_borrow_records")
    .update({
      returner_id: 参数.returnerId,
      returned_at: new Date().toISOString(),
      notes: 参数.notes,
    })
    .eq("id", 参数.recordId);
  if (updateRecordError) {
    return { success: false, error: updateRecordError.message };
  }

  /* 保存归还照片（失败不阻断归还流程） */
  if (参数.photos.length > 0) {
    const photos = 参数.photos.map((url) => ({
      borrow_record_id: 参数.recordId,
      tool_id: 参数.toolId,
      photo_url: url,
    }));
    const { error: photoError } = await supabase.from("tool_return_photos").insert(photos);
    if (photoError) console.error("归还照片保存失败:", photoError.message);
  }

  const { error: updateToolError } = await supabase
    .from("tools")
    .update({ status: "available", updated_at: new Date().toISOString() })
    .eq("id", 参数.toolId);
  if (updateToolError) {
    return { success: false, error: updateToolError.message };
  }

  revalidatePath("/tools/management");
  return { success: true };
}

/* ═══ 新建工具 Server Action ═══
 * 写操作从客户端直写收口到服务端；编码唯一性在服务端再查一次兜底，
 * created_by 取服务端验证的 user.id，不接受客户端传入。 */
export interface 工具表单 {
  code: string;
  name: string;
  imageUrl: string | null;
  instructions: string;
  location: string;
  status: string;
  requireReturnPhotos: boolean;
  requireLocationScan: boolean;
}

export async function 新建工具(表单: 工具表单): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const code = 表单.code.trim();
  const name = 表单.name.trim();
  if (!code || !name) {
    return { success: false, error: "请填写工具编码和名称" };
  }

  const supabase = await createClient();

  /* 服务端再查一次编码唯一性（忽略大小写），防止并发/绕过前端校验 */
  const { data: 重复 } = await supabase
    .from("tools")
    .select("id")
    .ilike("code", code)
    .maybeSingle();
  if (重复) {
    return { success: false, error: "工具编码已存在，请更换" };
  }

  const { error } = await supabase.from("tools").insert({
    code,
    name,
    image_url: 表单.imageUrl,
    instructions: 表单.instructions.trim() || null,
    location: 表单.location.trim() || null,
    status: 表单.status,
    require_return_photos: 表单.requireReturnPhotos,
    require_location_scan: 表单.requireLocationScan,
    created_by: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/tools/management");
  return { success: true };
}

/* ═══ 更新工具 Server Action ═══
 * 写操作从客户端直写收口到服务端；改编码时服务端再查一次唯一性兜底。 */
export async function 更新工具(id: string, 表单: 工具表单): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const code = 表单.code.trim();
  const name = 表单.name.trim();
  if (!code || !name) {
    return { success: false, error: "请填写工具编码和名称" };
  }

  const supabase = await createClient();

  /* 编码唯一性检查（排除自己，忽略大小写） */
  const { data: 重复 } = await supabase
    .from("tools")
    .select("id")
    .ilike("code", code)
    .maybeSingle();
  if (重复 && 重复.id !== id) {
    return { success: false, error: "工具编码已存在" };
  }

  const { error } = await supabase.from("tools").update({
    code,
    name,
    image_url: 表单.imageUrl,
    instructions: 表单.instructions.trim() || null,
    location: 表单.location.trim() || null,
    status: 表单.status,
    require_return_photos: 表单.requireReturnPhotos,
    require_location_scan: 表单.requireLocationScan,
  }).eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/tools/management");
  revalidatePath(`/tools/management/${id}`);
  return { success: true };
}
