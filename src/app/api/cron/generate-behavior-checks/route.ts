/**
 * 定时任务入口：每天生成当日行为考核记录
 *
 * Windows 计划任务每天凌晨调用（参照 sync-attendance 的既有配置方式）：
 *   curl "http://localhost:3000/api/cron/generate-behavior-checks?secret=配置的密钥"
 *
 * 密钥在 .env.local 配置：CRON_SECRET=一串随机字符
 *
 * 背景（待办清单第6项）：考核记录原来在页面渲染时"懒生成"，
 * 刷新/爬虫/预渲染都会触发插入。改为每日定时生成后，页面只读不写库。
 * 该接口幂等（已生成的跳过），同一天重复调用安全。
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { 生成今日考核记录 } from "@/lib/behaviorCheckGenerate";

export async function GET(request: NextRequest) {
  // 密钥校验，防止被外人乱调
  const 期望密钥 = process.env.CRON_SECRET;
  const 传入密钥 = request.nextUrl.searchParams.get("secret");
  if (!期望密钥 || 传入密钥 !== 期望密钥) {
    return NextResponse.json({ success: false, error: "密钥不对" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const 结果 = await 生成今日考核记录(supabase);
    if (!结果.success) {
      return NextResponse.json({ success: false, error: 结果.error }, { status: 500 });
    }
    return NextResponse.json({ success: true, generated: 结果.generated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "生成失败";
    console.error("[定时生成考核记录] 失败:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
