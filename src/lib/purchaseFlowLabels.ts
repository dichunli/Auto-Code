/* ============================================================
 * 采购流程跨阶段状态约定 —— 唯一来源
 *
 * 收货 → 采购 → 入库 → 退货 四个列表通过数据库字段值接力：
 *   收货写入 purchase_reason → 采购列表识别显示
 *   入库写入 return reason   → 退货列表识别显示
 * 此前 ACTION_LABELS 在收货/入库两个组件里各抄一份（靠注释人肉保持一致），
 * 是典型的漂移隐患。任何改动必须先想清楚对四个列表的影响。
 * ============================================================ */

/* 处理动作标签（收货/入库的处理结果列共用） */
export const ACTION_LABELS: Record<string, { text: string; color: string }> = {
  normal: { text: "正常", color: "bg-green-100 text-green-700" },
  broken_exchange: { text: "破损换货", color: "bg-orange-100 text-orange-700" },
  broken_discard: { text: "破损弃货", color: "bg-orange-100 text-orange-700" },
  wrong_exchange: { text: "错发换货", color: "bg-purple-100 text-purple-700" },
  wrong_discard: { text: "错发弃货", color: "bg-purple-100 text-purple-700" },
  excess_return: { text: "多发退货", color: "bg-blue-100 text-blue-700" },
  excess_paid: { text: "多发备用·付款", color: "bg-blue-100 text-blue-700" },
  excess_free: { text: "多发备用·免费", color: "bg-blue-100 text-blue-700" },
  short_repurchase: { text: "少发补货", color: "bg-red-100 text-red-700" },
  short_discard: { text: "少发弃货", color: "bg-red-100 text-red-700" },
};

/* 哪些收货动作需要生成新的"待采购"行（写入 work_order_item_parts.purchase_reason） */
export const ACTION_TO_PURCHASE_REASON: Record<string, string> = {
  broken_exchange: "broken_resupply",
  wrong_exchange: "wrong_exchange",
  short_repurchase: "short_resupply",
};

/* 哪些收货动作在入库后要生成"待退货"记录（supplier_return_records.return_reason） */
export const ACTION_TO_RETURN_REASON: Record<string, string> = {
  broken_exchange: "damaged",
  broken_discard: "damaged",
  wrong_exchange: "wrong_ship",
  wrong_discard: "wrong_ship",
  excess_return: "excess",
};

/* 待采购列表的 purchase_reason 徽标（识别收货阶段写入的值） */
export const PURCHASE_REASON_LABELS: Record<string, { text: string; color: string }> = {
  broken_resupply: { text: "破损补发", color: "bg-orange-50 text-orange-700 border-orange-200" },
  wrong_exchange: { text: "错发换货", color: "bg-purple-50 text-purple-700 border-purple-200" },
  short_resupply: { text: "少发补货", color: "bg-red-50 text-red-700 border-red-200" },
};

/* 待退货列表的退货原因中文化 */
export const RETURN_REASON_LABELS: Record<string, string> = {
  wrong_ship: "错发",
  excess: "多发退货",
  damaged: "损坏",
  cancel: "客户悔单",
  quality: "质量问题",
};
