import type { NextApiRequest, NextApiResponse } from "next";
import { writeFile, mkdir, access } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { 解析Multipart请求 } from "@/lib/parseMultipart";

const execFileAsync = promisify(execFile);

/* Pages Router 配置：允许最大 100MB 请求体 */
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "100mb",
    },
  },
};

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    /* 读取请求体为 Buffer */
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    await new Promise<void>((resolve, reject) => {
      req.on("end", resolve);
      req.on("error", reject);
    });
    const body = Buffer.concat(chunks);

    /* 构造 Web API Request 对象，复用 parseMultipart */
    const contentType = req.headers["content-type"] || "";
    const request = new Request("http://localhost/api/upload", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      }),
    });

    const multipart = await 解析Multipart请求(request);
    const { file } = multipart;
    const folder = multipart.folder;

    if (!file || file.data.length === 0) {
      return res.status(400).json({ error: "没有文件" });
    }

    const buffer = file.data;

    /* 按日期分目录，避免单目录文件过多 */
    const now = new Date();
    const dateDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    /* 培训视频存到 training/ 子目录 */
    const subDir = folder === "training" ? `training/${dateDir}` : dateDir;
    const dir = path.join(UPLOAD_DIR, subDir);
    await mkdir(dir, { recursive: true });

    /* 生成唯一文件名 */
    const ext = path.extname(file.filename) || ".bin";
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    const filePath = path.join(dir, fileName);

    await writeFile(filePath, buffer);

    /* 返回相对路径，供前端通过 /api/media/... 访问 */
    const relativePath = `${subDir}/${fileName}`;
    const result: { path: string; pdfPath?: string } = { path: `/api/media/${relativePath}` };

    /* 如果是 Office 文件，尝试转 PDF */
    if (officeExts.includes(ext.toLowerCase())) {
      const pdfFullPath = await convertToPdf(filePath, dir);
      if (pdfFullPath) {
        const pdfRelative = path.relative(UPLOAD_DIR, pdfFullPath).replace(/\\/g, "/");
        result.pdfPath = `/api/media/${pdfRelative}`;
      }
    }

    return res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "上传失败";
    console.error("[upload] error:", message);
    return res.status(500).json({ error: message });
  }
}
