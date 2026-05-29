import { NextResponse } from "next/server";
import { writeFile, mkdir, access } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

/* 使用 Node.js 运行时，避免 Edge Runtime 的 4.5MB 请求体限制 */
export const runtime = "nodejs";

/* 本地附件存储根目录 */
const UPLOAD_DIR = "E:/autorepair-uploads";

/* Office 文件扩展名 */
const officeExts = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];

/* Windows 上常见的 LibreOffice 安装路径 */
const sofficePaths = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

async function findSoffice(): Promise<string | null> {
  for (const p of sofficePaths) {
    try {
      await access(p);
      return p;
    } catch {
      /* 路径不存在，继续找下一个 */
    }
  }
  return null;
}

async function convertToPdf(inputPath: string, outputDir: string): Promise<string | null> {
  const soffice = await findSoffice();
  if (!soffice) return null;

  try {
    await execFileAsync(soffice, [
      "--headless",
      "--convert-to", "pdf",
      "--outdir", outputDir,
      inputPath,
    ]);

    const baseName = path.basename(inputPath, path.extname(inputPath));
    const pdfPath = path.join(outputDir, `${baseName}.pdf`);
    await access(pdfPath);
    return pdfPath;
  } catch {
    return null;
  }
}

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
    const result: { path: string; pdfPath?: string } = { path: `/api/media/${relativePath}` };

    /* 如果是 Office 文件，尝试转 PDF */
    if (officeExts.includes(ext.toLowerCase())) {
      const pdfFullPath = await convertToPdf(filePath, dir);
      if (pdfFullPath) {
        const pdfRelative = path.relative(UPLOAD_DIR, pdfFullPath).replace(/\\/g, "/");
        result.pdfPath = `/api/media/${pdfRelative}`;
      }
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "上传失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
