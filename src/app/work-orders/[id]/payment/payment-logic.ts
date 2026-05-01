export function roundToTwo(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseAmount(value: string): number {
  const v = parseFloat(value);
  return isNaN(v) || v < 0 ? 0 : roundToTwo(v);
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "未知错误";
}

export interface SettlementValidationInput {
  orderId: string;
  totalPaying: number;
  selectedAccountId: string;
  parsedDiscount: number;
  totalCost: number;
  advancePayment: number;
  totalPaid: number;
  payments: Array<{
    method: string;
    amount: string;
    member_id?: string;
  }>;
  members: Array<{
    id: string;
    name: string;
    balance: number;
  }>;
}

export function validateSettlement(input: SettlementValidationInput): string | null {
  const {
    orderId,
    totalPaying,
    selectedAccountId,
    parsedDiscount,
    totalCost,
    advancePayment,
    totalPaid,
    payments,
    members,
  } = input;

  if (!orderId || totalPaying <= 0) {
    return "请填写支付金额";
  }
  if (!selectedAccountId) {
    return "请选择收款账户";
  }
  if (parsedDiscount > totalCost) {
    return "折扣金额不能大于工单总额";
  }

  const discountedTotal = roundToTwo(totalCost - parsedDiscount);
  if (advancePayment + totalPaid > discountedTotal) {
    return "已预付/已付金额已超过折扣后总额，请调整折扣金额";
  }

  const remainingBefore = roundToTwo(discountedTotal - advancePayment - totalPaid);
  if (totalPaying > remainingBefore + 0.01) {
    return "本次支付金额不能超过待收金额";
  }

  for (const p of payments) {
    const amt = parseAmount(p.amount);
    if (amt > 0 && p.method === "member") {
      if (!p.member_id) {
        return "请选择会员";
      }
      const member = members.find((m) => m.id === p.member_id);
      if (!member) {
        return "会员不存在，请刷新页面";
      }
      if (amt > roundToTwo(member.balance)) {
        return `会员 ${member.name} 余额不足（当前余额: ${formatCurrency(member.balance)}）`;
      }
    }
  }

  return null;
}

// 轻量复用，避免循环依赖
function formatCurrency(amount: number | null) {
  if (amount == null) return "-";
  return `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
