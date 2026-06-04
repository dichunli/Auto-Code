import { NextResponse } from "next/server";
import { vin17OcrImage, vin17OcrAndDecode } from "@/lib/17vin/client";

/* VIN OCR API：接收图片base64，调用17VIN识别 */
export async function POST(request: Request) {
  try {
    const { base64UrlencodeImage, withDecode = false } = (await request.json()) as {
      base64UrlencodeImage: string;
      withDecode?: boolean;
    };

    if (!base64UrlencodeImage) {
      return NextResponse.json({ success: false, error: "缺少图片数据" }, { status: 400 });
    }

    const result = withDecode
      ? await vin17OcrAndDecode(base64UrlencodeImage)
      : await vin17OcrImage(base64UrlencodeImage);

    return NextResponse.json({ success: true, result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "识别失败";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
