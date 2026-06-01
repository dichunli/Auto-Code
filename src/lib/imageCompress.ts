/* ==================== VIN 识别专用压缩（返回 base64） ==================== */

export interface 压缩选项 {
  最大宽度?: number;
  质量?: number;
}

/* 压缩图片为 base64，用于 VIN/OCR 识别 */
export function 压缩图片为Base64(
  file: File | Blob,
  选项: 压缩选项 = {}
): Promise<string> {
  const { 最大宽度 = 1024, 质量 = 0.75 } = 选项;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > 最大宽度) {
        height = Math.round((height * 最大宽度) / width);
        width = 最大宽度;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas 不支持"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 质量));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };

    img.src = url;
  });
}

/* file / blob 转 base64（不压缩） */
export function 文件转Base64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* 从 base64 dataURL 创建 Blob */
export function base64转Blob(base64: string): Blob {
  const byteString = atob(base64.split(",")[1] || "");
  const mimeString = base64.split(",")[0].split(":")[1]?.split(";")[0] || "image/jpeg";
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

/* 裁剪 base64 图片：指定 x, y, width, height（像素坐标，基于原图尺寸） */
export function 裁剪Base64图片(
  base64: string,
  x: number,
  y: number,
  裁剪宽: number,
  裁剪高: number,
  质量: number = 0.75
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 裁剪宽;
      canvas.height = 裁剪高;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas 不支持"));
        return;
      }
      ctx.drawImage(img, x, y, 裁剪宽, 裁剪高, 0, 0, 裁剪宽, 裁剪高);
      resolve(canvas.toDataURL("image/jpeg", 质量));
    };
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = base64;
  });
}

export async function compressImage(file: File, maxSizeKB: number = 150): Promise<Blob> {
  /* 如果原始文件已经很小，直接返回 */
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

      resolve(blob);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };

    img.src = url;
  });
}
