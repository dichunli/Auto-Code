/* 单条退货记录标记完成（补记往来账）—— 原子事务函数（2026-08-19 批次4 口径统一）
 *
 * 背景（采购流程梳理 问题清单 中危7）：
 *   退货有两条完成路径，此前口径分裂：
 *   · 生成采退单 → 记应收冲减(credit) ✅ 有账
 *   · 单条「标记完成」→ 只改状态 ❌ 无账（退货越多账越乱）
 *   本函数：单条标记完成时同样记应收冲减，两条路径账目口径统一。
 *
 * 记账规则：金额 = 退货数量 × 工单配件行采购价(unit_cost)；
 * 供应商按退货记录的 supplier_name 文本匹配 suppliers 表（退货记录无 supplier_id 列）。
 * 匹配不到供应商或无采购价 → 只改状态不记账，返回 accounted=false 供前端提示。
 * 防重复：已 completed 的记录直接拒绝（避免重复记账）。
*/

CREATE OR REPLACE FUNCTION complete_return_record(
  p_record_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_unit_cost DECIMAL(10,2);
  v_supplier_id UUID;
  v_amount DECIMAL(12,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 锁记录并校验状态（防重复点击重复记账） */
  SELECT id, status, work_order_item_part_id, quantity, supplier_name
  INTO v_rec
  FROM supplier_return_records WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '退货记录不存在');
  END IF;
  IF v_rec.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', '该记录已是完成状态，请勿重复操作');
  END IF;

  /* 标记完成 */
  UPDATE supplier_return_records SET status = 'completed' WHERE id = p_record_id;

  /* 计算金额：数量 × 工单配件行采购价 */
  SELECT unit_cost INTO v_unit_cost
  FROM work_order_item_parts WHERE id = v_rec.work_order_item_part_id;

  /* 按名称文本匹配供应商（取第一匹配；重名时取创建最早的，保持稳定） */
  IF v_rec.supplier_name IS NOT NULL AND TRIM(v_rec.supplier_name) <> '' THEN
    SELECT id INTO v_supplier_id FROM suppliers
    WHERE name = v_rec.supplier_name
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  v_amount := ROUND(COALESCE(v_rec.quantity, 0) * COALESCE(v_unit_cost, 0), 2);

  IF v_supplier_id IS NOT NULL AND v_amount > 0 THEN
    INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type, created_by)
    VALUES (v_supplier_id, 'credit', v_amount, '采购退货', p_record_id, 'supplier_return_record', p_operator_id);
    RETURN jsonb_build_object('success', true, 'accounted', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'accounted', false);
END;
$$ LANGUAGE plpgsql;

/* 权限收尾(对齐 20260813 双保险) */
REVOKE EXECUTE ON FUNCTION public.complete_return_record(uuid, uuid) FROM anon, PUBLIC;

/* ============================================================
   验证方法(执行完本脚本后跑):
   SELECT proname FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname='complete_return_record'
     AND pg_get_functiondef(oid) LIKE '%权限门禁%';
   应返回 1 行。
   ============================================================
*/
