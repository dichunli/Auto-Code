/* 图片水印工具 — 在图片右下角叠加半透明时间水印 */

/* 添加时间水印（接受 File 或 Blob，返回 JPEG Blob，质量 0.85） */
export async function 添加水印(
  input: File | Blob,
  水印文字?: string
): Promise<Blob> {
  const 文字 = 水印文字 || 生成时间文字();

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(input);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("无法创建画布"));
        return;
      }

      ctx.drawImage(img, 0, 0);

      /* 动态计算水印尺寸：按图片宽度比例缩放 */
      const 字体大小 = Math.max(16, Math.floor(img.width / 30));
      const 边距 = Math.max(10, Math.floor(img.width / 60));
      ctx.font = `${字体大小}px sans-serif`;
      const metrics = ctx.measureText(文字);
      const 水印宽度 = metrics.width + 边距 * 2;
      const 水印高度 = Math.max(30, Math.floor(img.height / 20)) + 边距;
      const bgX = img.width - 水印宽度;
      const bgY = img.height - 水印高度;

      /* 半透明黑色背景 */
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(bgX, bgY, 水印宽度, 水印高度);

      /* 白色文字 */
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(文字, bgX + 边距, bgY + 水印高度 / 2);

      /* 输出为 JPEG，质量 0.85（太高质量会导致文件膨胀） */
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("水印处理失败"));
        },
        "image/jpeg",
        0.85
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };

    img.src = url;
  });
}

/* 生成当前时间的中文格式文字 */
function 生成时间文字(): string {
  return new Date().toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
