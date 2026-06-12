import { unlink } from "fs/promises";
import path from "path";
import { createClient } from "@/lib/supabase/server";

/* 本地附件存储根目录 */
const UPLOAD_DIR = process.env.UPLOAD_DIR || "E:/autorepair-uploads";

export async function POST(request: Request) {
  try {
    /* 认证检查 */
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "未登录" }, { status: 401 });
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
