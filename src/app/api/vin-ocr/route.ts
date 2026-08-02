import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { vin17OcrImage, vin17OcrAndDecode } from "@/lib/17vin/client";

/* VIN OCR API：接收图片base64，压缩后调用17VIN识别 */
export async function POST(request: Request) {
  try {
    /* ── 认证：优先 Bearer token（APP 环境），其次 cookie（浏览器）──
       必须登录才能调用，防止未登录者盗刷付费的 17VIN OCR 配额 */
    let userId: string | null = null;
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (token && token !== "undefined" && token !== "null") {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (url && key) {
          const tempClient = createSupabaseClient(url, key, {
            auth: { autoRefreshToken: false, persistSession: false },
          });
          const { data, error } = await tempClient.auth.getUser(token);
          if (!error && data.user) {
            userId = data.user.id;
          }
        }
      }
    }

    if (!userId) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
      }
      userId = user.id;
    }

    const { base64Image, withDecode = false } = (await request.json()) as {
      base64Image: string;
      withDecode?: boolean;
    };

    if (!base64Image) {
      return NextResponse.json({ success: false, error: "缺少图片数据" }, { status: 400 });
    }

    /* 1. 去掉 data URL 前缀，提取纯base64 */
    const base64Body = base64Image.split(",")[1] || base64Image;
    const imageBuffer = Buffer.from(base64Body, "base64");

    /* 2. 用 sharp 压缩图片（限制800宽度，质量60） */
    const compressedBuffer = await sharp(imageBuffer)
      .resize(800, null, { withoutEnlargement: true })
      .jpeg({ quality: 60, progressive: true })
      .toBuffer();

    /* 3. 转回base64并URL编码 */
    const compressedBase64 = compressedBuffer.toString("base64");
    const base64Urlencode = encodeURIComponent(compressedBase64);

    /* 4. 传给17VIN */
    const result = withDecode
      ? await vin17OcrAndDecode(base64Urlencode)
      : await vin17OcrImage(base64Urlencode);

    return NextResponse.json({ success: true, result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "识别失败";
    console.error("[VIN OCR] 错误:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
