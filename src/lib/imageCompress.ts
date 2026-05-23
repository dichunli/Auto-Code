export async function compressImage(file: File, maxSizeKB: number = 150): Promise<Blob> {
  /* 如果原始文件已经小于目标大小，直接返回原文件，省掉压缩时间 */
  if (file.size / 1024 <= maxSizeKB) {
    return file;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(url);

      let width = img.width;
      let height = img.height;
      const maxDimension = 1920;

      /* 根据原始大小估算缩放比例，先缩放到接近目标的尺寸 */
      const originalSizeKB = file.size / 1024;
      if (originalSizeKB > maxSizeKB) {
        const scaleRatio = Math.sqrt(maxSizeKB / originalSizeKB) * 2.5;
        if (scaleRatio < 1) {
          width = Math.round(width * scaleRatio);
          height = Math.round(height * scaleRatio);
        }
      }

      /* 同时限制最大边长 */
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

      const mimeType = file.type === "image/png" ? "image/jpeg" : file.type || "image/jpeg";

      /* 从高到低尝试几个 quality，通常 1~2 次就能命中目标 */
      const qualities = [0.88, 0.72, 0.55, 0.38, 0.22];
      for (const q of qualities) {
        const blob = await new Promise<Blob | null>((res) => {
          canvas.toBlob((b) => res(b), mimeType, q);
        });
        if (blob && blob.size / 1024 <= maxSizeKB) {
          resolve(blob);
          return;
        }
      }

      /* 如果所有 quality 都达不到目标，再缩小画布尺寸 */
      let finalScale = 0.75;
      while (finalScale > 0.2) {
        const w = Math.round(width * finalScale);
        const h = Math.round(height * finalScale);
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);

        const blob = await new Promise<Blob | null>((res) => {
          canvas.toBlob((b) => res(b), mimeType, 0.2);
        });
        if (blob && blob.size / 1024 <= maxSizeKB) {
          resolve(blob);
          return;
        }
        finalScale *= 0.75;
      }

      /* 实在压不动就返回原文件 */
      resolve(file);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };

    img.src = url;
  });
}
