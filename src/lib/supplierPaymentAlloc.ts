/* 供应商付款核销的纯函数（2026-09-14 供应商款项改造批次1）
 * 从 SupplierPaymentsContent 抽出来：涉钱逻辑必须有单元测试 */

/* 应付清单行（与 list_supplier_payables RPC 返回对齐，组件侧另有扩展字段） */
export interface 应付行 {
  transaction_id: string;
  remaining: number; /* 未付余额（元） */
}

export type 应付勾选行<T extends 应付行 = 应付行> = T & {
  checked: boolean;
  allocStr: string;
};

/* 金额文本转分（浮点安全）；非法输入按 0 */
export function 转分(文本: string): number {
  const n = parseFloat(文本);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/* 元（number）转分 */
export function 元到分(金额: number): number {
  return Math.round(金额 * 100);
}

/* FIFO 自动勾稽：付款金额 + 历史可核销额度，按清单顺序（调用方保证从老到新排好）逐笔填满。
 * 勾不完的额度留在"预付余额"，不在本函数体现。 */
export function 先进先出勾稽<T extends 应付行>(
  清单: T[],
  付款分: number,
  可用分: number
): 应付勾选行<T>[] {
  let 剩余额度 = 付款分 + 可用分;
  return 清单.map((row) => {
    const 行剩余分 = 元到分(row.remaining);
    if (剩余额度 > 0 && 行剩余分 > 0) {
      const 勾 = Math.min(行剩余分, 剩余额度);
      剩余额度 -= 勾;
      return { ...row, checked: true, allocStr: (勾 / 100).toFixed(2) };
    }
    return { ...row, checked: false, allocStr: "" };
  });
}

/* 勾选行的核销合计（分） */
export function 核销合计分(清单: 应付勾选行[]): number {
  return 清单.reduce((sum, r) => sum + (r.checked ? 转分(r.allocStr) : 0), 0);
}
