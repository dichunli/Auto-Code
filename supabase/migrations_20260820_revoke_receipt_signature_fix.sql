/* 撤销收货函数签名修正（2026-08-20 二期补充）
 *
 * 问题：migrations_20260820_arrival_receipts.sql 里 revoke_purchase_receipt 按
 * 两参签名 (uuid, uuid) CREATE OR REPLACE，但线上权威签名是三参
 * (uuid, uuid, uuid)（带 p_operator_id，0811 批次加的）。
 * 结果：两参版被当成新重载新建，Server Action 传 p_operator_id 仍命中旧三参版，
 * 到货单联动逻辑（已确认禁止撤销/验货中同步复位）根本没生效。
 * 本文件验证时发现：撤销后采购行清了、到货明细没复位，数据不一致。
 *
 * 处理：
 *   1. DROP 误建的两参版（无任何调用方，0819 教训：先 DROP 防新旧并存误调）
 *   2. 按三参权威签名回写"含到货单联动+权限门禁"的完整定义
 * 函数体与原两参版一致，仅签名补 p_operator_id（保持与 Server Action 传参一致）。
*/

DROP FUNCTION IF EXISTS public.revoke_purchase_receipt(uuid, uuid);

CREATE OR REPLACE FUNCTION public.revoke_purchase_receipt(
  p_order_id UUID,
  p_item_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_reason TEXT;
  v_any_handled BOOLEAN;
  v_ar_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_order FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;

  /* 1. 读出旧处理动作(删补货分支要用),再清空 */
  SELECT * INTO v_item FROM purchase_order_items
  WHERE id = p_item_id AND order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;

  /* 1.5 到货单联动(2026-08-20 二期) */
  IF v_item.arrival_item_id IS NOT NULL THEN
    SELECT ar.status INTO v_ar_status
    FROM arrival_receipt_items ai
    JOIN arrival_receipts ar ON ar.id = ai.arrival_id
    WHERE ai.id = v_item.arrival_item_id;
    IF v_ar_status IS NOT NULL AND v_ar_status <> 'receiving' THEN
      RETURN jsonb_build_object('success', false, 'error', '该明细的到货单已确认，库存已上架，不能撤销收货');
    END IF;
    /* 验货中 → 同步复位到货明细（可重新处理） */
    UPDATE arrival_receipt_items
    SET received_qty = NULL, handling = NULL, warehouse_id = NULL, location = NULL, photos = NULL
    WHERE id = v_item.arrival_item_id;
  END IF;

  UPDATE purchase_order_items
  SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL,
      arrival_item_id = NULL
  WHERE id = p_item_id;

  /* 2. 删除该动作生成的补货分支(未采购未到货的) */
  v_reason := CASE v_item.handle_action
    WHEN 'broken_exchange'   THEN 'broken_resupply'
    WHEN 'wrong_exchange'    THEN 'wrong_exchange'
    WHEN 'short_repurchase'  THEN 'short_resupply'
    ELSE NULL END;

  IF v_reason IS NOT NULL AND v_item.work_order_item_part_id IS NOT NULL THEN
    DELETE FROM work_order_item_parts
    WHERE work_order_item_id = (
            SELECT work_order_item_id FROM work_order_item_parts
            WHERE id = v_item.work_order_item_part_id
          )
      AND purchase_reason = v_reason
      AND is_purchased = false
      AND is_arrived = false;
  END IF;

  /* 3. 服务端重算状态 */
  SELECT bool_or(handle_action IS NOT NULL) INTO v_any_handled
  FROM purchase_order_items WHERE order_id = p_order_id;

  UPDATE purchase_orders
  SET status = CASE WHEN v_any_handled THEN 'partial_received' ELSE 'submitted' END
  WHERE id = p_order_id;

  /* 4. 若原先是待入库状态被回退,且同运单无其他待入库单,运单回退 */
  IF v_order.status = 'pending_storage' AND v_order.waybill_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM purchase_orders
       WHERE waybill_id = v_order.waybill_id AND status = 'pending_storage' AND id <> p_order_id
     ) THEN
    UPDATE logistics_waybills SET status = 'pending', received_at = NULL
    WHERE id = v_order.waybill_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 只剩一个三参版且带联动逻辑:
      SELECT pg_get_function_arguments(oid),
             pg_get_functiondef(oid) LIKE '%1.5 到货单联动%'
      FROM pg_proc WHERE proname = 'revoke_purchase_receipt';
      应只返回 1 行: (p_order_id uuid, p_item_id uuid, p_operator_id uuid), true
   2. 误建的两参版已不存在:
      SELECT COUNT(*) FROM pg_proc
      WHERE proname = 'revoke_purchase_receipt'
        AND pg_get_function_arguments(oid) = 'p_order_id uuid, p_item_id uuid';
      应返回 0。
*/
