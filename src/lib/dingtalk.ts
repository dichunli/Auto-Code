/**
 * 钉钉开放平台 服务端 API 封装
 *
 * 只能在服务端（Server Action / API Route）使用！
 * AppKey / AppSecret 只存在服务器环境变量（.env.local）：
 *   DINGTALK_APP_KEY=xxxx
 *   DINGTALK_APP_SECRET=xxxx
 *
 * 用到的钉钉接口：
 *   1. 获取 access_token（新版 oauth2）
 *   2. 按手机号查钉钉用户编号（员工自动绑定用）
 *   3. 查询企业某天排班（算应出勤天数用）
 *   4. 查询打卡结果（考勤记录用）
 */

// ============================================================
// 类型定义
// ============================================================

/** 企业某日排班中的一条打卡点（一人一天通常有上班、下班两条） */
export interface 钉钉排班项 {
  userid: string;
  /** OnDuty 上班卡 / OffDuty 下班卡 */
  checkType: string;
  /** 计划打卡时间，如 "2026-08-09 08:30:00" */
  planTime: string;
  /** 班次名称，如 "早班" */
  shiftName: string;
}

/** 钉钉打卡结果中的一条 */
export interface 钉钉打卡项 {
  userid: string;
  /** OnDuty 上班卡 / OffDuty 下班卡 */
  checkType: string;
  /** 钉钉判定结果：Normal 正常 / Late 迟到 / SeriousLate 严重迟到 / Absenteeism 旷工迟到 / Early 早退 / NotSigned 未打卡 */
  timeResult: string;
  /** 应打卡时间（毫秒时间戳） */
  baseCheckTime: number;
  /** 实际打卡时间（毫秒时间戳），未打卡为 null */
  userCheckTime: number | null;
}

/** 钉钉接口通用返回外层 */
interface 钉钉旧版返回 {
  errcode: number;
  errmsg?: string;
  [key: string]: unknown;
}

// ============================================================
// 内部工具
// ============================================================

/** 请求超时：10 秒，避免钉钉接口偶发慢响应拖死同步任务 */
const 请求超时毫秒 = 10_000;

/** 把 Date 格式化成 "2026-08-09" */
function 格式化日期(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 把 Date 格式化成 "2026-08-09 08:30:00" */
function 格式化日期时间(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${格式化日期(d)} ${h}:${min}:${s}`;
}

/** 校验钉钉旧版接口返回，errcode 非 0 时抛出带中文说明的错误 */
function 校验钉钉返回(数据: 钉钉旧版返回, 接口名: string): void {
  if (数据.errcode !== 0) {
    throw new Error(`钉钉接口[${接口名}]报错 ${数据.errcode}: ${数据.errmsg || "无错误信息"}`);
  }
}

// ============================================================
// 1. access_token 获取与缓存
// ============================================================

/* 模块级缓存：PM2 单进程内有效；进程重启后重新获取即可，无副作用 */
let 缓存token: { value: string; expireAt: number } | null = null;

export async function 获取accessToken(): Promise<string> {
  // 提前 5 分钟认为过期，避免边界时刻 token 失效
  if (缓存token && Date.now() < 缓存token.expireAt - 5 * 60 * 1000) {
    return 缓存token.value;
  }

  const appKey = process.env.DINGTALK_APP_KEY;
  const appSecret = process.env.DINGTALK_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error("缺少环境变量 DINGTALK_APP_KEY / DINGTALK_APP_SECRET，请先在 .env.local 配置钉钉密钥");
  }

  const res = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey, appSecret }),
    signal: AbortSignal.timeout(请求超时毫秒),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`获取钉钉 accessToken 失败，HTTP ${res.status}`);
  }
  const 数据 = (await res.json()) as { accessToken?: string; expireIn?: number };
  if (!数据.accessToken) {
    throw new Error("获取钉钉 accessToken 失败：返回中没有 accessToken（请检查 AppKey/AppSecret 是否正确）");
  }

  缓存token = {
    value: 数据.accessToken,
    expireAt: Date.now() + (数据.expireIn ?? 7200) * 1000,
  };
  return 缓存token.value;
}

// ============================================================
// 2. 按手机号查钉钉用户编号（员工绑定用）
// ============================================================

/**
 * 按手机号查钉钉用户编号。
 * 手机号不在企业里时返回 null（不算错误）。
 */
export async function 按手机号查用户id(mobile: string): Promise<string | null> {
  const token = await 获取accessToken();
  const res = await fetch(
    `https://oapi.dingtalk.com/topapi/v2/user/getbymobile?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile }),
      signal: AbortSignal.timeout(请求超时毫秒),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    throw new Error(`按手机号查钉钉用户失败，HTTP ${res.status}`);
  }
  const 数据 = (await res.json()) as 钉钉旧版返回 & { result?: { userid?: string } };
  // errcode 60121 等表示"该手机号不在企业中"，返回 null 即可
  if (数据.errcode !== 0) {
    return null;
  }
  return 数据.result?.userid ?? null;
}

// ============================================================
// 3. 查询企业某天排班
// ============================================================

/**
 * 拉取全企业某一天的排班（所有考勤组）。
 * 返回按打卡点的扁平列表：一人一天通常有 OnDuty、OffDuty 两条。
 * 自动翻页直到取完。
 */
export async function 拉取某日排班(date: Date): Promise<钉钉排班项[]> {
  const token = await 获取accessToken();
  const 结果: 钉钉排班项[] = [];
  let offset = 0;
  const size = 200;

  for (;;) {
    const res = await fetch(
      `https://oapi.dingtalk.com/topapi/attendance/listschedule?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workDate: 格式化日期(date), offset, size }),
        signal: AbortSignal.timeout(请求超时毫秒),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      throw new Error(`拉取钉钉排班失败，HTTP ${res.status}`);
    }
    interface 排班原始项 {
      userid?: string;
      check_type?: string;
      plan_check_time?: string;
      shift?: { name?: string };
    }
    const 数据 = (await res.json()) as 钉钉旧版返回 & {
      result?: { schedules?: 排班原始项[]; has_more?: boolean };
    };
    校验钉钉返回(数据, "查询排班");

    const 本页 = 数据.result?.schedules ?? [];
    for (const item of 本页) {
      if (!item.userid) continue;
      结果.push({
        userid: item.userid,
        checkType: item.check_type ?? "",
        planTime: item.plan_check_time ?? "",
        shiftName: item.shift?.name ?? "",
      });
    }

    if (!数据.result?.has_more || 本页.length < size) break;
    offset += size;
  }
  return 结果;
}

// ============================================================
// 4. 查询打卡结果
// ============================================================

/** 钉钉打卡结果接口限制：单次时间跨度最多 7 天、用户最多 50 个 */
const 单次最多天数 = 7;
const 单次最多人数 = 50;

/**
 * 拉取一批用户在一段时间内的打卡结果。
 * 内部自动按 7 天切片、按 50 人分组、自动翻页，调用方不用关心接口限制。
 */
export async function 拉取打卡记录(
  userIds: string[],
  from: Date,
  to: Date
): Promise<钉钉打卡项[]> {
  if (userIds.length === 0) return [];
  const token = await 获取accessToken();
  const 结果: 钉钉打卡项[] = [];

  // 按 50 人分组
  for (let i = 0; i < userIds.length; i += 单次最多人数) {
    const 这批用户 = userIds.slice(i, i + 单次最多人数);

    // 按 7 天切片
    const 片头 = new Date(from);
    while (片头 <= to) {
      const 片尾 = new Date(片头);
      片尾.setDate(片尾.getDate() + 单次最多天数 - 1);
      片尾.setHours(23, 59, 59);
      if (片尾 > to) 片尾.setTime(to.getTime());

      const 片头零时 = new Date(片头);
      片头零时.setHours(0, 0, 0);

      // 翻页取完本片
      let offset = 0;
      const limit = 50;
      for (;;) {
        const res = await fetch(
          `https://oapi.dingtalk.com/attendance/list?access_token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workDateFrom: 格式化日期时间(片头零时),
              workDateTo: 格式化日期时间(片尾),
              userIdList: 这批用户,
              offset,
              limit,
            }),
            signal: AbortSignal.timeout(请求超时毫秒),
            cache: "no-store",
          }
        );
        if (!res.ok) {
          throw new Error(`拉取钉钉打卡结果失败，HTTP ${res.status}`);
        }
        interface 打卡原始项 {
          userId?: string;
          checkType?: string;
          timeResult?: string;
          baseCheckTime?: number;
          userCheckTime?: number;
        }
        const 数据 = (await res.json()) as 钉钉旧版返回 & {
          recordresult?: 打卡原始项[];
          hasMore?: boolean;
        };
        校验钉钉返回(数据, "查询打卡结果");

        const 本页 = 数据.recordresult ?? [];
        for (const item of 本页) {
          if (!item.userId || item.baseCheckTime == null) continue;
          结果.push({
            userid: item.userId,
            checkType: item.checkType ?? "",
            timeResult: item.timeResult ?? "",
            baseCheckTime: item.baseCheckTime,
            userCheckTime: item.userCheckTime ?? null,
          });
        }

        if (!数据.hasMore || 本页.length < limit) break;
        offset += limit;
      }

      // 下一片从明天开始
      片头.setDate(片头.getDate() + 单次最多天数);
    }
  }

  return 结果;
}
