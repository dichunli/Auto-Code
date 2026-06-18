import { 是Capacitor环境 } from "@/lib/capacitorEnv";

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

/* 加载图片为 HTMLImageElement */
function 加载图片(file: File): Promise<{ width: number; height: number; element: HTMLImageElement }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height, element: img });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };
    img.src = url;
  });
}

/* 支持的浏览器 canvas 输出格式 */
const 浏览器支持格式 = ["image/jpeg", "image/png", "image/webp"];

/**
 * 按最大边尺寸压缩图片
 * - 长边超过 maxDimension 时等比缩放
 * - 长边未超过时直接返回原文件
 * - JPEG / PNG / WebP 保持原格式，其他格式统一输出 JPEG
 * - JPEG 输出质量固定 0.8
 */
export async function compressImageByDimension(file: File, maxDimension: number = 1280): Promise<Blob> {
  const img = await 加载图片(file);

  const max = Math.max(img.width, img.height);
  if (max <= maxDimension) {
    /* 尺寸已符合要求，直接返回原文件 */
    return file;
  }

  const scale = maxDimension / max;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建 canvas 上下文");
  }
  ctx.drawImage(img.element, 0, 0, w, h);

  /* 输出格式：支持的保持原格式，否则转 JPEG */
  const originalType = file.type;
  const mimeType = 浏览器支持格式.includes(originalType) ? originalType : "image/jpeg";

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("canvas 编码失败"));
      },
      mimeType,
      mimeType === "image/jpeg" ? 0.8 : undefined
    );
  });
}

/**
 * 判断当前环境是否为移动浏览器（不含 APP）
 */
function 是移动端浏览器(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
}

/**
 * 统一图片压缩入口
 * - APP 或移动浏览器：按大边 1280 压缩
 * - PC 端：按 300KB 目标大小压缩
 */
export async function 压缩图片(file: File): Promise<Blob> {
  if (是Capacitor环境() || 是移动端浏览器()) {
    return compressImageByDimension(file, 1280);
  }
  return compressImage(file, 300);
}

export async function compressImage(file: File, maxSizeKB: number = 300): Promise<Blob> {
  /* 如果原始文件已经很小，直接返回 */
  if (file.size / 1024 <= maxSizeKB) {
    return file;
  }

  /* 浏览器 canvas 支持的输出格式 */
  const canvasSupported = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const originalType = file.type;

  /* 非标准格式（如 HEIC）强制转 JPEG */
  if (!canvasSupported.includes(originalType)) {
    return 尝试压缩(file, 1920, 0.8, "image/jpeg", maxSizeKB);
  }

  /* PNG 保留透明度但通常较大，先试原格式再降级 */
  if (originalType === "image/png") {
    /* 先用 PNG 缩放试试 */
    const pngResult = await 尝试压缩(file, 1920, 1, "image/png", maxSizeKB);
    if (pngResult.size / 1024 <= maxSizeKB) return pngResult;
    /* PNG 不行就转 JPEG */
    return 尝试压缩(file, 1920, 0.8, "image/jpeg", maxSizeKB);
  }

  /* JPEG / WebP / GIF：逐步降质量迭代压缩 */
  return 尝试压缩(file, 1920, 0.8, originalType, maxSizeKB);
}

/* 内部函数：按指定尺寸和质量压缩一次，如果超限则迭代降质量/降尺寸 */
async function 尝试压缩(
  file: File,
  maxDim: number,
  quality: number,
  mimeType: string,
  targetKB: number
): Promise<Blob> {
  const img = await 加载图片(file);

  /* 定义迭代策略：逐步降质量和降尺寸 */
  const 策略列表 = [
    { maxDim, quality },
    { maxDim, quality: quality * 0.7 },
    { maxDim, quality: quality * 0.5 },
    { maxDim: Math.round(maxDim * 0.7), quality: 0.6 },
    { maxDim: Math.round(maxDim * 0.5), quality: 0.5 },
    { maxDim: 800, quality: 0.4 },
  ];

  /* 去重：合并相同的 maxDim+quality 组合 */
  const 去重策略: { maxDim: number; quality: number }[] = [];
  for (const s of 策略列表) {
    const isDuplicate = 去重策略.some(
      (e) => e.maxDim === s.maxDim && Math.abs(e.quality - s.quality) < 0.01
    );
    if (!isDuplicate) 去重策略.push(s);
  }

  for (const 策略 of 去重策略) {
    const blob = await 执行压缩(img, 策略.maxDim, 策略.quality, mimeType);
    if (blob.size / 1024 <= targetKB) {
      return blob;
    }
  }

  /* 所有策略都失败，返回最后一种策略的结果 */
  const 最后策略 = 去重策略[去重策略.length - 1];
  return 执行压缩(img, 最后策略.maxDim, 最后策略.quality, mimeType);
}

/* 执行一次压缩：缩放 + canvas 编码 */
function 执行压缩(
  源: { width: number; height: number; element: HTMLImageElement },
  maxDim: number,
  quality: number,
  mimeType: string
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let w = 源.width;
    let h = 源.height;
    if (w > maxDim || h > maxDim) {
      const s = maxDim / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("无法创建 canvas 上下文"));
      return;
    }
    ctx.drawImage(源.element, 0, 0, w, h);
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("canvas 编码失败"));
      },
      mimeType,
      quality
    );
  });
}
