export async function compressImage(file: File, maxSizeKB: number = 150): Promise<Blob> {
  /* 如果原始文件已经很小，直接返回 */
  if (file.size / 1024 <= maxSizeKB) {
    return file;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    const startTime = Date.now();

    img.onload = async () => {
      URL.revokeObjectURL(url);

      let width = img.width;
      let height = img.height;
      /* 直接限制最大边长为 1280，不按文件大小反复试算 */
      const maxDimension = 1280;

      if (width > maxDimension || height > maxDimension) {
        const s = maxDimension / Math.max(width, height);
        width = Math.round(width * s);
        height = Math.round(height * s);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("无法创建 canvas 上下文"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      /* 浏览器 canvas 仅支持输出 jpeg/png/webp/gif，其他格式（如 iPhone 的 HEIC）强制转 jpeg */
      const canvasSupported = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      const mimeType = canvasSupported.includes(file.type) && file.type !== "image/png"
        ? file.type
        : "image/jpeg";

      /* 只画一次、只编码一次，固定 quality 0.7 */
      const blob = await new Promise<Blob | null>((res) => {
        canvas.toBlob((b) => res(b), mimeType, 0.7);
      });

      if (!blob) {
        reject(new Error("canvas 编码失败"));
        return;
      }

      console.log(
        `[压缩] ${file.name} ${Math.round(file.size / 1024)}KB → ${Math.round(blob.size / 1024)}KB ` +
        `(${img.width}x${img.height} → ${width}x${height})，耗时 ${Date.now() - startTime}ms`
      );
      resolve(blob);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };

    img.src = url;
  });
}
