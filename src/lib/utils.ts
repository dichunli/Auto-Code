export function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

export function formatDate(date: string | Date | null) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCurrency(amount: number | null) {
  if (amount == null) return "-";
  return `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function getStatusLabel(status: string) {
  const map: Record<string, string> = {
    received: "已接车",
    pending_diagnosis: "待诊断",
    pending_repair: "待维修",
    repairing: "维修中",
    pending_quality_check: "待质检",
    pending_close: "待结单",
    pending_settlement: "待结算",
    settled: "已结算",
    delivered: "已交车",
  };
  return map[status] || status;
}

export function getStatusColor(status: string) {
  const map: Record<string, string> = {
    received: "bg-gray-100 text-gray-800",
    pending_diagnosis: "bg-yellow-100 text-yellow-800",
    pending_repair: "bg-orange-100 text-orange-800",
    repairing: "bg-blue-100 text-blue-800",
    pending_quality_check: "bg-purple-100 text-purple-800",
    pending_close: "bg-indigo-100 text-indigo-800",
    pending_settlement: "bg-emerald-100 text-emerald-800",
    settled: "bg-green-100 text-green-800",
    delivered: "bg-slate-100 text-slate-800",
  };
  return map[status] || "bg-gray-100 text-gray-800";
}
