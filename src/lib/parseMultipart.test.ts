import { describe, it, expect } from "vitest";
import { 解析Multipart请求 } from "./parseMultipart";

/* 构造一个模拟的 multipart Request */
function 构造Multipart请求(
  parts: { name: string; filename?: string; contentType?: string; data: Buffer | string }[],
  boundary = "----TestBoundary"
): Request {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType || "application/octet-stream"}\r\n\r\n`
        )
      );
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`)
      );
    }
    chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data, "utf-8"));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(chunks);
  return new Request("http://localhost/api/upload", {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body: body as unknown as ReadableStream<Uint8Array>,
    duplex: "half",
  } as RequestInit);
}

describe("解析Multipart请求", () => {
  it("能解析只包含文件的请求", async () => {
    const request = 构造Multipart请求([
      { name: "file", filename: "test.jpg", contentType: "image/jpeg", data: Buffer.from([1, 2, 3, 4]) },
    ]);
    const result = await 解析Multipart请求(request);
    expect(result.file.filename).toBe("test.jpg");
    expect(result.file.contentType).toBe("image/jpeg");
    expect(result.file.data).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(result.folder).toBeNull();
  });

  it("能解析同时包含文件和 folder 的请求", async () => {
    const request = 构造Multipart请求([
      { name: "folder", data: "training" },
      { name: "file", filename: "video.mp4", contentType: "video/mp4", data: Buffer.from([5, 6, 7, 8]) },
    ]);
    const result = await 解析Multipart请求(request);
    expect(result.file.filename).toBe("video.mp4");
    expect(result.file.contentType).toBe("video/mp4");
    expect(result.file.data).toEqual(Buffer.from([5, 6, 7, 8]));
    expect(result.folder).toBe("training");
  });

  it("没有 boundary 时抛出错误", async () => {
    const body = Buffer.from("some data");
    const request = new Request("http://localhost/api/upload", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data" },
      body: body as unknown as ReadableStream<Uint8Array>,
      duplex: "half",
    } as RequestInit);
    await expect(解析Multipart请求(request)).rejects.toThrow("请求缺少 boundary");
  });

  it("没有文件时抛出错误", async () => {
    const request = 构造Multipart请求([{ name: "folder", data: "training" }]);
    await expect(解析Multipart请求(request)).rejects.toThrow("请求中没有找到文件");
  });

  it("能处理文件名包含中文的情况", async () => {
    const request = 构造Multipart请求([
      { name: "file", filename: "测试.mp4", contentType: "video/mp4", data: Buffer.from([9, 10]) },
    ]);
    const result = await 解析Multipart请求(request);
    expect(result.file.filename).toBe("测试.mp4");
    expect(result.file.data).toEqual(Buffer.from([9, 10]));
  });

  it("能处理较大文件数据", async () => {
    const largeData = Buffer.alloc(1024 * 1024, 0xab); /* 1MB */
    const request = 构造Multipart请求([
      { name: "file", filename: "big.mp4", contentType: "video/mp4", data: largeData },
    ]);
    const result = await 解析Multipart请求(request);
    expect(result.file.data.length).toBe(largeData.length);
    expect(result.file.data[0]).toBe(0xab);
    expect(result.file.data[largeData.length - 1]).toBe(0xab);
  });
});
