"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

export interface LogActionParams {
  actionType: string;
  targetTable?: string;
  targetId?: string;
  targetName?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  description: string;
}

async function getClientIp() {
  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = headersList.get("x-real-ip");
  if (realIp) {
    return realIp;
  }
  return headersList.get("remote-addr") || "";
}

export async function logAction(params: LogActionParams) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let userName = "";
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();
    userName = profile?.full_name || "";
  }

  const { error } = await supabase.from("operation_logs").insert({
    user_id: user?.id || null,
    user_name: userName,
    action_type: params.actionType,
    target_table: params.targetTable || null,
    target_id: params.targetId || null,
    target_name: params.targetName || null,
    old_values: params.oldValues || null,
    new_values: params.newValues || null,
    description: params.description,
    ip_address: (await getClientIp()) || null,
  });

  if (error) {
    console.error("操作日志记录失败:", error);
  }
}

export async function logLogin(params: {
  userId: string;
  userName: string;
  description: string;
}) {
  const supabase = await createClient();

  const { error } = await supabase.from("operation_logs").insert({
    user_id: params.userId,
    user_name: params.userName,
    action_type: "login",
    description: params.description,
    ip_address: (await getClientIp()) || null,
  });

  if (error) {
    console.error("登录日志记录失败:", error);
  }
}
