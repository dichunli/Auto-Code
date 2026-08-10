/**
 * 定时任务入口：每天自动同步考勤
 *
 * Windows 计划任务每天凌晨调用：
 *   curl "http://localhost:3000/api/cron/sync-attendance?secret=配置的密钥"
 *
 * 可选参数：
 *   days=N  补拉过去 N 天（默认 1，即只同步昨天；最大 62）
 *
 * 密钥在 .env.local 配置：CRON_SECRET=一串随机字符
 */

import { NextRequest, NextResponse } from "next/server";
import { 同步考勤数据 } from "@/lib/attendanceSync";

export async function GET(request: NextRequest) {
  // 密钥校验，防止被外人乱调
  const 期望密钥 = process.env.CRON_SECRET;
  const 传入密钥 = request.nextUrl.searchParams.get("secret");
  if (!期望密钥 || 传入密钥 !== 期望密钥) {
    return NextResponse.json({ success: false, error: "密钥不对" }, { status: 401 });
  }

  try {
    // 默认只同步昨天（今天的卡还没打完，同步进来会是半成品）
    const to = new Date();
    to.setDate(to.getDate() - 1);
    to.setHours(23, 59, 59);
    const from = new Date(to);
    from.setHours(0, 0, 0);

    // 可选：补拉过去 N 天
    const days参数 = Number(request.nextUrl.searchParams.get("days") || "1");
    const days = Math.min(Math.max(Math.floor(days参数) || 1, 1), 62);
    from.setDate(from.getDate() - (days - 1));

    const data = await 同步考勤数据(from, to);
    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "同步失败";
    console.error("[定时同步考勤] 失败:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
