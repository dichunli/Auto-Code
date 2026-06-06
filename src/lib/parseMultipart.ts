/* 简化的 multipart/form-data 解析器
   专门处理 /api/upload 场景：一个文件字段 + 可选 folder 文本字段
   避免 Next.js request.formData() 对大文件解析失败的问题
*/

export interface MultipartFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface MultipartResult {
  file: MultipartFile;
  folder: string | null;
}

/* 调试日志：生产环境可关闭 */
const 启用调试 = process.env.NODE_ENV === "development" || false;
function 调试(...args: unknown[]) {
  if (启用调试) {
     
    console.log("[multipart]", ...args);
  }
}

/* 从 Content-Type header 中提取 boundary */
function 提取Boundary(contentType: string): string | null {
  const match = contentType.match(/boundary=([^;]+)/i);
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/* 读取请求体为 Buffer */
async function 读取请求体(request: Request): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = request.body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/* 解析 Content-Disposition，支持多种形式：
   name="file"
   name=file
   filename="test.mp4"
   filename=test.mp4
   filename*=UTF-8''%E6%B5%8B%E8%AF%95.mp4  (RFC 5987)
*/
function 解析ContentDisposition(headersText: string): { name: string | null; filename: string | null } {
  const disposition = headersText.match(/Content-Disposition:\s*([^\r\n]+)/i)?.[1] || "";

  /* name 字段：支持有引号和无引号 */
  const nameMatch = disposition.match(/name=(?:"([^"]+)"|([^;\s]+))/);
  const name = nameMatch ? (nameMatch[1] ?? nameMatch[2]) : null;

  /* filename 字段：优先 RFC 5987 的 filename*，再试 filename */
  let filename: string | null = null;
  const filenameStarMatch = disposition.match(/filename\*=([^'"]*'[^'"]*'[^;\s]+)/);
  if (filenameStarMatch) {
    const encoded = filenameStarMatch[1];
    const lastQuoteIndex = encoded.lastIndexOf("'");
    const value = lastQuoteIndex !== -1 ? encoded.slice(lastQuoteIndex + 1) : encoded;
    try {
      filename = decodeURIComponent(value);
    } catch {
      filename = value;
    }
  } else {
    const filenameMatch = disposition.match(/filename=(?:"([^"]*)"|([^;\s]+))/);
    filename = filenameMatch ? (filenameMatch[1] ?? filenameMatch[2]) : null;
  }

  return { name, filename };
}

/* 解析 multipart 请求体 */
export async function 解析Multipart请求(request: Request): Promise<MultipartResult> {
  const contentType = request.headers.get("content-type") || "";
  const boundary = 提取Boundary(contentType);
  if (!boundary) {
    throw new Error("请求缺少 boundary");
  }

  const body = await 读取请求体(request);
  调试("body size", body.length, "boundary", boundary);

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const endBoundaryBuffer = Buffer.from(`--${boundary}--`);

  let file: MultipartFile | null = null;
  let folder: string | null = null;

  let start = body.indexOf(boundaryBuffer);
  while (start !== -1) {
    const partStart = start + boundaryBuffer.length;
    let partEnd = body.indexOf(boundaryBuffer, partStart);
    const isLastPart = partEnd === -1;
    if (isLastPart) {
      partEnd = body.indexOf(endBoundaryBuffer, partStart);
      if (partEnd === -1) break;
    }

    let part = body.slice(partStart, partEnd);
    /* 去掉 part 开头可能的 \r\n */
    if (part.length >= 2 && part[0] === 0x0d && part[1] === 0x0a) {
      part = part.slice(2);
    }

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      if (isLastPart) break;
      start = partEnd;
      continue;
    }

    const headersText = part.slice(0, headerEnd).toString("utf-8");
    let data = part.slice(headerEnd + 4);
    /* 去掉 data 结尾可能的 \r\n */
    if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
      data = data.slice(0, -2);
    }

    const { name: fieldName, filename } = 解析ContentDisposition(headersText);
    调试("part", { fieldName, filename, dataLength: data.length, headersText });

    if (fieldName === "file" && filename !== null) {
      const ctMatch = headersText.match(/Content-Type:\s*([^\r\n]+)/i);
      file = {
        filename: filename || `upload_${Date.now()}.bin`,
        contentType: ctMatch ? ctMatch[1].trim() : "application/octet-stream",
        data,
      };
    } else if (fieldName === "folder") {
      folder = data.toString("utf-8").trim() || null;
    }

    if (isLastPart) break;
    start = partEnd;
  }

  if (!file) {
    throw new Error("请求中没有找到文件");
  }

  return { file, folder };
}
