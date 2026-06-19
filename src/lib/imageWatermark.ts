/* 图片水印工具 — 在图片右下角叠加半透明时间水印 */

/* 添加时间水印（接受 File 或 Blob，返回 JPEG Blob，质量 0.9） */
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

      /* 动态计算水印尺寸：按图片短边比例缩放 */
      const 短边 = Math.min(img.width, img.height);
      const 字体大小 = Math.max(14, Math.floor(短边 / 25));
      const 水平边距 = Math.max(12, Math.floor(短边 / 50));
      const 垂直边距 = Math.max(8, Math.floor(短边 / 70));
      const 圆角 = Math.max(6, Math.floor(字体大小 / 3));

      ctx.font = `bold ${字体大小}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
      const metrics = ctx.measureText(文字);
      const 文字宽度 = metrics.width;
      const 文字高度 = 字体大小;
      const 水印宽度 = 文字宽度 + 水平边距 * 2;
      const 水印高度 = 文字高度 + 垂直边距 * 2;
      const bgX = img.width - 水印宽度 - 水平边距;
      const bgY = img.height - 水印高度 - 垂直边距;

      /* 绘制圆角半透明背景 */
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      绘制圆角矩形(ctx, bgX, bgY, 水印宽度, 水印高度, 圆角);
      ctx.fill();
      ctx.restore();

      /* 添加轻微阴影 */
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(文字, bgX + 水平边距, bgY + 水印高度 / 2);
      ctx.restore();

      /* 输出为 JPEG，质量 0.9（平衡清晰度与体积） */
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("水印处理失败"));
        },
        "image/jpeg",
        0.9
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };

    img.src = url;
  });
}

/* 绘制圆角矩形路径 */
function 绘制圆角矩形(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  宽度: number,
  高度: number,
  圆角: number
) {
  const r = Math.min(圆角, 高度 / 2, 宽度 / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + 宽度 - r, y);
  ctx.quadraticCurveTo(x + 宽度, y, x + 宽度, y + r);
  ctx.lineTo(x + 宽度, y + 高度 - r);
  ctx.quadraticCurveTo(x + 宽度, y + 高度, x + 宽度 - r, y + 高度);
  ctx.lineTo(x + r, y + 高度);
  ctx.quadraticCurveTo(x, y + 高度, x, y + 高度 - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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
