import { unlink } from "fs/promises";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/* 本地附件存储根目录 */
const UPLOAD_DIR = process.env.UPLOAD_DIR || "E:/autorepair-uploads";

export async function POST(request: Request) {
  try {
    /* 认证检查：优先从 Authorization 头取 token（APP 环境），其次读 cookie */
    let userId: string | null = null;
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (url && key) {
        const tempClient = createSupabaseClient(url, key);
        const { data, error } = await tempClient.auth.getUser(token);
        if (!error && data.user) {
          userId = data.user.id;
        }
      }
    }

    if (!userId) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return Response.json({ error: "未登录" }, { status: 401 });
      }
      userId = user.id;
    }

    const body = await request.json();
    const filePath = body.path as string;

    if (!filePath || typeof filePath !== "string") {
      return Response.json({ error: "缺少 path 参数" }, { status: 400 });
    }

    /* 将 /api/media/... 路径转换为磁盘路径 */
    const relativePath = filePath.replace(/^\/api\/media\//, "");
    const fullPath = path.resolve(UPLOAD_DIR, relativePath);

    /* 安全检查：防止目录遍历 */
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    if (!fullPath.startsWith(resolvedUploadDir)) {
      return Response.json({ error: "非法路径" }, { status: 403 });
    }

    /* 不允许删除 UPLOAD_DIR 根目录 */
    if (fullPath === resolvedUploadDir) {
      return Response.json({ error: "非法路径" }, { status: 403 });
    }

    /* 归属校验（待办清单第4项）：被业务数据引用的文件只有 admin/boss 能删；
     * 未被引用的（刚上传又取消的孤儿文件）登录用户即可删。
     * 前端正常流程不受影响——先删数据库记录再删文件时，文件已不被引用。 */
    const supabase服务端 = await createClient();
    const 引用检查 = await Promise.all([
      supabase服务端.from("vehicle_photos").select("id", { count: "exact", head: true }).eq("storage_path", relativePath),
      supabase服务端.from("part_images").select("id", { count: "exact", head: true }).eq("storage_path", relativePath),
      supabase服务端.from("work_order_item_part_media").select("id", { count: "exact", head: true }).eq("storage_path", relativePath),
      supabase服务端.from("work_order_inspection_media").select("id", { count: "exact", head: true }).eq("storage_path", relativePath),
      supabase服务端.from("work_order_requirement_media").select("id", { count: "exact", head: true }).eq("storage_path", relativePath),
      supabase服务端.from("work_order_item_media").select("id", { count: "exact", head: true }).eq("storage_path", relativePath),
    ]);
    const 被引用 = 引用检查.some((r) => (r.count ?? 0) > 0);

    if (被引用) {
      const { data: 角色行 } = await supabase服务端
        .from("profile_roles")
        .select("roles(name)")
        .eq("profile_id", userId);
      const 角色们 = ((角色行 || []) as unknown as { roles: { name: string } | { name: string }[] | null }[])
        .flatMap((r) => (Array.isArray(r.roles) ? r.roles : r.roles ? [r.roles] : []))
        .map((r) => r.name);
      if (!角色们.some((n) => n === "admin" || n === "boss")) {
        return Response.json({ error: "该文件正被业务数据使用，只有管理员能删除" }, { status: 403 });
      }
    }

    await unlink(fullPath);

    return Response.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "删除失败";
    /* 文件不存在不算错误 */
    if (message.includes("ENOENT") || message.includes("no such file")) {
      return Response.json({ success: true });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
