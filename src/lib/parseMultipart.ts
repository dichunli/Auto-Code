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

/* 从 Content-Type header 中提取 boundary */
function 提取Boundary(contentType: string): string | null {
  const match = contentType.match(/boundary=([^;]+)/i);
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/* 读取请求体为 Buffer */
async function 读取请求体(request: Request): Promise<Buffer> {
  try {
    const ab = await request.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    /* 备用方案：用 getReader */
    const chunks: Uint8Array[] = [];
    const reader = request.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }
}

/* 解析 Content-Disposition，支持多种形式 */
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
export async function 解析Multipart请求(request: Request, maxSize: number = 500 * 1024 * 1024): Promise<MultipartResult> {
  const contentType = request.headers.get("content-type") || "";
  const boundary = 提取Boundary(contentType);
  if (!boundary) {
    throw new Error("请求缺少 boundary");
  }

  const body = await 读取请求体(request);

  if (body.length === 0) {
    throw new Error("请求体为空");
  }

  if (body.length > maxSize) {
    throw new Error(`文件超过大小限制（最大 ${Math.round(maxSize / 1024 / 1024)}MB）`);
  }

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const 前缀BoundaryBuffer = Buffer.from(`\r\n--${boundary}`);
  const endBoundaryBuffer = Buffer.from(`--${boundary}--`);
  const 前缀EndBoundaryBuffer = Buffer.from(`\r\n--${boundary}--`);

  let file: MultipartFile | null = null;
  let folder: string | null = null;

  /* 找第一个 boundary 的位置（可能在请求体开头或 preamble 之后） */
  let start = body.indexOf(boundaryBuffer);

  if (start === -1) {
    throw new Error("请求中没有找到 boundary");
  }

  while (start !== -1) {
    const partStart = start + boundaryBuffer.length;
    /* 搜索后续 boundary 时必须带 \r\n 前缀，避免在二进制文件数据中误匹配 */
    let partEnd = body.indexOf(前缀BoundaryBuffer, partStart);
    const isLastPart = partEnd === -1;
    if (isLastPart) {
      partEnd = body.indexOf(前缀EndBoundaryBuffer, partStart);
      if (partEnd === -1) {
        /* 备用：搜索不带 \r\n 前缀的结束 boundary */
        partEnd = body.indexOf(endBoundaryBuffer, partStart);
        if (partEnd === -1) break;
      }
    }

    let part = body.slice(partStart, partEnd);
    /* 去掉 part 开头可能的 \r\n */
    if (part.length >= 2 && part[0] === 0x0d && part[1] === 0x0a) {
      part = part.slice(2);
    }

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      if (isLastPart) break;
      start = partEnd + 2; /* 跳过 \r\n，指向 --boundary */
      continue;
    }

    const headersText = part.slice(0, headerEnd).toString("utf-8");
    let data = part.slice(headerEnd + 4);
    /* 去掉 data 结尾可能的 \r\n */
    if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
      data = data.slice(0, -2);
    }

    const { name: fieldName, filename } = 解析ContentDisposition(headersText);

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
    start = partEnd + 2; /* 跳过 \r\n，指向 --boundary */
  }

  if (!file) {
    throw new Error("请求中没有找到文件");
  }

  return { file, folder };
}
