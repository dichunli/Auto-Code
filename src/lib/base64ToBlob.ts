/**
 * 将 base64 Data URL 转换为 Blob 对象
 * 用于将 Camera.getPhoto 返回的 base64 图片传给 MLKit readBarcodesFromImage
 *
 * @param dataurl - 形如 "data:image/jpeg;base64,/9j/4AAQ..." 的 Data URL
 * @returns Blob 对象
 */
export function base64转Blob(dataurl: string): Blob {
  const arr = dataurl.split(",");
  const mime = arr[0].match(/:(.*?);/)?.[1] || "image/jpeg";
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}
