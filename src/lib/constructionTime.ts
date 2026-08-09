/* 施工/中断时长计算（纯函数）
 *
 * 数据来自 work_order_item_construction_logs：start/resume 记开始，pause/complete 记结束。
 * 配对规则与数据库 add_construction_log 的窗口函数结算一致：
 *   施工秒 = 每个 start/resume 行 → 下一行的时间（无下一行则算到"此刻"）
 *   中断秒 = 每个 pause 行 → 下一行的时间（无下一行则算到"此刻"）
 * 连续两个 start/resume（异常数据）时前一段丢弃，与 RPC 行为一致。
 */

export interface 施工日志行 {
  action: string; // start / pause / resume / complete
  created_at: string;
}

export interface 施工中断秒数 {
  施工秒: number;
  中断秒: number;
}

export function 计算施工中断秒数(日志: 施工日志行[], 此刻: Date = new Date()): 施工中断秒数 {
  const 排序 = [...日志].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  let 施工秒 = 0;
  let 中断秒 = 0;

  for (let i = 0; i < 排序.length; i++) {
    const 行 = 排序[i];
    const 下一行 = 排序[i + 1];
    const 段尾 = 下一行 ? new Date(下一行.created_at).getTime() : 此刻.getTime();
    const 段长 = Math.max(0, Math.round((段尾 - new Date(行.created_at).getTime()) / 1000));

    if (行.action === "start" || 行.action === "resume") {
      /* 下一行还是 start/resume 属异常数据（重复开工），前一段不计（同 RPC） */
      if (!下一行 || 下一行.action === "pause" || 下一行.action === "complete") {
        施工秒 += 段长;
      }
    } else if (行.action === "pause") {
      中断秒 += 段长;
    }
  }
  return { 施工秒, 中断秒 };
}

/* 时长格式化：>1天 "3天2小时"；>1小时 "2小时35分"；>1分钟 "45分"；<1分钟 "不足1分钟" */
export function 格式化时长(秒: number): string {
  if (秒 < 60) return "不足1分钟";
  const 分钟 = Math.floor(秒 / 60);
  const 天 = Math.floor(分钟 / 1440);
  const 小时 = Math.floor((分钟 % 1440) / 60);
  const 分 = 分钟 % 60;
  if (天 > 0) return 小时 > 0 ? `${天}天${小时}小时` : `${天}天`;
  if (小时 > 0) return 分 > 0 ? `${小时}小时${分}分` : `${小时}小时`;
  return `${分}分`;
}

/* 计时器样式：HH:MM:SS（如 "01:23:45"）；超过 1 天加天数前缀（如 "2天 03:04:05"）。
 * 配合前端每秒跳动使用，位数固定，配合 tabular-nums 不抖动。 */
export function 格式化计时器(秒: number): string {
  const 总秒 = Math.max(0, Math.floor(秒));
  const 天 = Math.floor(总秒 / 86400);
  const 时 = Math.floor((总秒 % 86400) / 3600);
  const 分 = Math.floor((总秒 % 3600) / 60);
  const 余秒 = 总秒 % 60;
  const 两位 = (n: number) => String(n).padStart(2, "0");
  const 时分秒 = `${两位(时)}:${两位(分)}:${两位(余秒)}`;
  return 天 > 0 ? `${天}天 ${时分秒}` : 时分秒;
}
