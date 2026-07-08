/* 单张图片上传工具（dataUrl → 服务端 → Supabase Storage） */
import { base64转Blob } from "@/lib/imageCompress";

export async function 上传图片(dataUrl: string, folder = "tools"): Promise<string | null> {
  try {
    const blob = base64转Blob(dataUrl);
    const ext = blob.type === "image/png" ? "png" : "jpg";
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const formData = new FormData();
    formData.append("file", blob, fileName);
    formData.append("folder", folder);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const json = await res.json();

    if (json.success && json.path) {
      return json.path;
    }
    console.error("上传图片失败:", json.error || "未知错误");
    return null;
  } catch (err: unknown) {
    console.error("上传图片异常:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
