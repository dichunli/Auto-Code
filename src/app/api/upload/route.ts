import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

/* 使用 Node.js 运行时，避免 Edge Runtime 的 4.5MB 请求体限制 */
export const runtime = "nodejs";

/* 本地附件存储根目录 */
const UPLOAD_DIR = "E:/autorepair-uploads";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "没有文件" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    /* 按日期分目录，避免单目录文件过多 */
    const now = new Date();
    const dateDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const dir = path.join(UPLOAD_DIR, dateDir);
    await mkdir(dir, { recursive: true });

    /* 生成唯一文件名 */
    const ext = path.extname(file.name) || ".bin";
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    const filePath = path.join(dir, fileName);

    await writeFile(filePath, buffer);

    /* 返回相对路径，供前端通过 /api/media/... 访问 */
    const relativePath = `${dateDir}/${fileName}`;
    return NextResponse.json({ path: `/api/media/${relativePath}` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "上传失败" }, { status: 500 });
  }
}
