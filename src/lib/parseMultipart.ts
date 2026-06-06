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
  const chunks: Uint8Array[] = [];
  const reader = request.body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/* 解析 multipart 请求体 */
export async function 解析Multipart请求(request: Request): Promise<MultipartResult> {
  const contentType = request.headers.get("content-type") || "";
  const boundary = 提取Boundary(contentType);
  if (!boundary) {
    throw new Error("请求缺少 boundary");
  }

  const body = await 读取请求体(request);
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

    const nameMatch = headersText.match(/name="([^"]+)"/);
    const filenameMatch = headersText.match(/filename="([^"]*)"/);
    const fieldName = nameMatch ? nameMatch[1] : null;

    if (fieldName === "file" && filenameMatch) {
      const ctMatch = headersText.match(/Content-Type:\s*([^\r\n]+)/i);
      file = {
        filename: filenameMatch[1],
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
