import { NextResponse } from "next/server";
import { vin17OcrImage } from "@/lib/17vin/client";

/* 临时测试接口：直接测试 17VIN OCR token 计算 */
export async function GET() {
  try {
    /* 用一个假的 base64 图片测试（足够触发 token 校验即可） */
    const fakeBase64 = "dGVzdA==";
    const fakeUrlencode = encodeURIComponent(fakeBase64);

    const result = (await vin17OcrImage(fakeUrlencode)) as {
      code: number;
      msg?: string;
    };

    return NextResponse.json({
      success: true,
      result,
      note: "如果返回 code=-1 或类似错误但不是 token 错误，说明 token 计算正确",
    });
  } catch (err: unknown) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
