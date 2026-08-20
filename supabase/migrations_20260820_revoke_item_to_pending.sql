/* 单个配件撤销退回待采购 —— 原子事务函数（2026-08-20）
 *
 * 背景：整单级已有 cancel_purchase_order(revoke)（2026-08-17），本函数是它的
 * 配件级版本——收货前发现某个配件这次不需要买了，把该配件单独退回待采购列表，
 * 整单其余配件不受影响。
 *
 * 与相邻通道的区别（四条通道并存是有意的）：
 *   · cancel_purchase_order(revoke)：整单所有配件回待采购，单据标 cancelled
 *   · delete_purchase_item：作废——删明细+删工单配件行（货根本没来/彻底不要）
 *   · revoke_purchase_receipt：撤销已完成的收货处理（handle_action 已落库的）
 *   · 本函数：未处理配件退回待采购（工单行 is_purchased 回 false、暂存件回暂存表）
 *
 * 收尾规矩：明细删空时整单标 cancelled 留档（采购单只废不删，2026-08-16 拍板）。
*/

CREATE OR REPLACE FUNCTION revoke_purchase_item_to_pending(
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
  v_supplier_name TEXT;
  v_remaining INTEGER;
  v_any_handled BOOLEAN;
  v_any_unhandled BOOLEAN;
  v_new_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(对齐 cancel_purchase_order):采购写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 锁单 */
  SELECT * INTO v_order FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;

  SELECT * INTO v_item FROM purchase_order_items
  WHERE id = p_item_id AND order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;

  /* 仅未处理的配件可退回；已处理的请先点行内「撤销」收货处理 */
  IF v_item.handle_action IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '该配件已做过收货处理，请先撤销收货处理');
  END IF;

  /* 1. 工单配件行回待采购：取消"已采购"标记，配件重新出现在待采购列表 */
  IF v_item.work_order_item_part_id IS NOT NULL THEN
    UPDATE work_order_item_parts SET is_purchased = false
    WHERE id = v_item.work_order_item_part_id;
  ELSE
    /* 2. 暂存件（无工单配件关联）重建回暂存表，语义同整单撤销 */
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_order.supplier_id;
    INSERT INTO custom_purchase_staging (
      part_id, part_number, name, brand, specification,
      document_name, unit, unit_cost, quantity,
      supplier_id, supplier_name, source, created_by
    ) VALUES (
      v_item.part_id, v_item.part_number, v_item.name, v_item.brand, v_item.specification,
      v_item.supplier_part_name, v_item.unit, v_item.unit_cost, v_item.quantity,
      v_order.supplier_id, v_supplier_name, 'custom', p_operator_id
    );
  END IF;

  /* 3. 删采购明细 */
  DELETE FROM purchase_order_items WHERE id = p_item_id;

  /* 4. 整单收尾：明细删空→标 cancelled 留档（只废不删）；有剩余→重算状态
       （状态口径与 delete_purchase_item 一致） */
  SELECT COUNT(*),
         bool_or(handle_action IS NOT NULL),
         bool_or(handle_action IS NULL)
  INTO v_remaining, v_any_handled, v_any_unhandled
  FROM purchase_order_items WHERE order_id = p_order_id;

  IF v_remaining = 0 THEN
    UPDATE purchase_orders
    SET status = 'cancelled',
        notes = '[配件全部退回待采购] ' || COALESCE(notes, '')
    WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'order_cancelled', true);
  END IF;

  v_new_status := CASE
    WHEN v_any_handled AND v_any_unhandled THEN 'partial_received'
    WHEN v_any_handled THEN 'pending_storage'
    ELSE 'submitted' END;
  UPDATE purchase_orders SET status = v_new_status WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'order_cancelled', false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* 权限收尾（对齐 20260813 双保险）：回收 anon/PUBLIC，authenticated 不受影响 */
REVOKE EXECUTE ON FUNCTION public.revoke_purchase_item_to_pending(uuid, uuid, uuid) FROM anon, PUBLIC;

/* ============================================================
   验证方法（执行完本脚本后跑）：
   SELECT proname FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname='revoke_purchase_item_to_pending';
   应返回 1 行。
   ============================================================
*/
