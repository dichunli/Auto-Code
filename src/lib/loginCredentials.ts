/*
 * 登录账号处理 — 纯逻辑，从登录页抽出以便单元测试。
 *
 * 系统支持两种账号登录：
 * 1. 手机号（11 位，1 开头）→ 转成内部邮箱 phone-<手机号>@auto.local 给 Supabase
 * 2. 邮箱 → 原样作为 Supabase 登录邮箱
 *
 * ⚠️ 注意：登录页「兼容模式」的原生 JS 脚本里有一份等价逻辑（写死在
 * dangerouslySetInnerHTML 字符串中，无法 import 本文件）。若要修改账号转邮箱
 * 规则，必须同时改 login/page.tsx 里那段原生脚本，否则两种登录方式行为不一致。
 */

/* 内部邮箱后缀：手机号账号会被拼成 phone-<号码>@auto.local */
export const 内部邮箱后缀 = "@auto.local";
export const 手机号邮箱前缀 = "phone-";

/* 是否为合法手机号：1 开头、第二位 3-9、共 11 位 */
export function 是手机号(value: string): boolean {
  return /^1[3-9]\d{9}$/.test(value);
}

/*
 * 把用户输入的账号转成 Supabase 登录用的邮箱：
 * - 手机号 → phone-<手机号>@auto.local
 * - 其它（邮箱）→ 原样返回
 */
export function 账号转邮箱(account: string): string {
  if (是手机号(account)) {
    return 手机号邮箱前缀 + account + 内部邮箱后缀;
  }
  return account;
}
