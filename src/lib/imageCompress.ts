export async function compressImage(file: File, maxSizeKB: number = 150): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let width = img.width;
      let height = img.height;
      const maxDimension = 1920;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
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

      let quality = 0.92;
      const mimeType = file.type === "image/png" ? "image/jpeg" : file.type || "image/jpeg";

      const tryCompress = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("压缩失败"));
              return;
            }
            const sizeKB = blob.size / 1024;
            if (sizeKB > maxSizeKB && quality > 0.15) {
              quality -= 0.08;
              if (width > 400 && height > 400) {
                width = Math.round(width * 0.85);
                height = Math.round(height * 0.85);
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
              }
              tryCompress();
            } else {
              resolve(blob);
            }
          },
          mimeType,
          quality
        );
      };

      tryCompress();
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };

    img.src = url;
  });
}
