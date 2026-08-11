/* 采购收货处理 —— 原子事务函数 */
/* 创建日期: 2026-08-11 */
/* 背景:
     原收货处理(10 种处理动作)在浏览器分 4~5 步写库:
       更新明细 → 克隆补货分支(仅 console.warn 静默吞错) → 重读全单明细在客户端算状态 → 写回状态 → 运单联动(静默吞错);
     撤销收货、少发弃货删除同样是多步无事务连环写。
   本迁移把三类操作各自收敛为一个事务函数:
     一、receive_purchase_item   —— 收货处理(正常/破损/错发/多发/少发 10 种动作)
     二、revoke_purchase_receipt —— 撤销收货
     三、delete_purchase_item    —— 少发弃货且数量为 0 时删除明细
   补货分支映射(与前端 ACTION_TO_PURCHASE_REASON 一致):
     broken_exchange → broken_resupply(破损补发)
     wrong_exchange  → wrong_exchange(错发换货)
     short_repurchase→ short_resupply(少发补货,数量=订购数-实收数)
*/

/* ============================================================
   一、收货处理(原子事务)
   参数:
     p_order_id        采购单 id
     p_item_id         采购明细 id
     p_handle_action   处理动作(10 种枚举)
     p_received_qty    实收数量
     p_evidence_photos 凭证照片 JSONB 数组(仅 p_set_evidence=true 时写入)
     p_set_evidence    是否更新凭证字段(区分"不传"与"传空")
     p_operator_id     操作人 id
   ============================================================ */
CREATE OR REPLACE FUNCTION receive_purchase_item(
  p_order_id UUID,
  p_item_id UUID,
  p_handle_action TEXT,
  p_received_qty INTEGER,
  p_evidence_photos JSONB,
  p_set_evidence BOOLEAN,
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
  v_branch_qty INTEGER;
  v_all_handled BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF p_handle_action NOT IN (
    'normal','broken_exchange','broken_discard','wrong_exchange','wrong_discard',
    'excess_return','excess_paid','excess_free','short_repurchase','short_discard'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的处理动作');
  END IF;
  IF p_received_qty IS NULL OR p_received_qty < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '实收数量必须 ≥ 0');
  END IF;

  /* 锁单,防并发收货状态算错 */
  SELECT * INTO v_order FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status NOT IN ('submitted', 'approved', 'partial_received') THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单当前状态不允许收货');
  END IF;

  /* 1. 更新明细处理结果 */
  UPDATE purchase_order_items
  SET handle_action = p_handle_action,
      received_qty = p_received_qty,
      evidence_photos = CASE WHEN p_set_evidence
                             THEN COALESCE(p_evidence_photos, '[]'::JSONB)
                             ELSE evidence_photos END
  WHERE id = p_item_id AND order_id = p_order_id
  RETURNING * INTO v_item;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;

  /* 2. 需要补货的动作 → 克隆工单配件行 */
  v_reason := CASE p_handle_action
    WHEN 'broken_exchange'   THEN 'broken_resupply'
    WHEN 'wrong_exchange'    THEN 'wrong_exchange'
    WHEN 'short_repurchase'  THEN 'short_resupply'
    ELSE NULL END;

  IF v_reason IS NOT NULL AND v_item.work_order_item_part_id IS NOT NULL THEN
    /* 少发补货数量 = 订购数 - 实收数;其他场景沿用原数量 */
    IF p_handle_action = 'short_repurchase' THEN
      v_branch_qty := v_item.quantity - p_received_qty;
    ELSE
      SELECT quantity INTO v_branch_qty FROM work_order_item_parts
      WHERE id = v_item.work_order_item_part_id;
    END IF;

    IF COALESCE(v_branch_qty, 0) > 0 THEN
      INSERT INTO work_order_item_parts (
        work_order_item_id, part_name_id, branch_group_id, is_selected,
        part_id, part_number, name, alias_name, unit, brand, specification,
        unit_cost, unit_price, quantity, customer_opinion,
        is_purchased, is_arrived, supplier_name, logistics_agreement, notes,
        purchase_reason
      )
      SELECT
        work_order_item_id, part_name_id, branch_group_id, false,
        part_id, part_number, name, alias_name, unit, brand, specification,
        unit_cost, unit_price, v_branch_qty, 'agree',
        false, false, supplier_name, logistics_agreement, notes,
        v_reason
      FROM work_order_item_parts
      WHERE id = v_item.work_order_item_part_id;
    END IF;
  END IF;

  /* 3. 服务端重算采购单状态(不再由客户端重读重算) */
  SELECT bool_and(handle_action IS NOT NULL) INTO v_all_handled
  FROM purchase_order_items WHERE order_id = p_order_id;

  IF v_all_handled THEN
    UPDATE purchase_orders SET status = 'pending_storage' WHERE id = p_order_id;
    /* 运单标记已签收 */
    IF v_order.waybill_id IS NOT NULL THEN
      UPDATE logistics_waybills SET status = 'received', received_at = NOW()
      WHERE id = v_order.waybill_id;
    END IF;
  ELSE
    UPDATE purchase_orders SET status = 'partial_received' WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'all_handled', v_all_handled);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   二、撤销收货(原子事务)
   ============================================================ */
CREATE OR REPLACE FUNCTION revoke_purchase_receipt(
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
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
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

  UPDATE purchase_order_items
  SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL
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
   三、少发弃货且数量为 0:删除采购明细(原子事务)
   同时删除关联工单配件行;采购单无剩余明细时整单删除
   ============================================================ */CREATE OR REPLACE FUNCTION delete_purchase_item(
  p_order_id UUID,
  p_item_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_remaining INTEGER;
  v_any_handled BOOLEAN;
  v_any_unhandled BOOLEAN;
  v_new_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  /* 锁单 */
  PERFORM 1 FROM purchase_orders WHERE id = p_order_id FOR UPDATE;

  SELECT * INTO v_item FROM purchase_order_items
  WHERE id = p_item_id AND order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;

  /* 1. 删采购明细 */
  DELETE FROM purchase_order_items WHERE id = p_item_id;

  /* 2. 删关联工单配件行 */
  IF v_item.work_order_item_part_id IS NOT NULL THEN
    DELETE FROM work_order_item_parts WHERE id = v_item.work_order_item_part_id;
  END IF;

  /* 3. 采购单剩余明细:无则整单删除,有则重算状态 */
  SELECT COUNT(*),
         bool_or(handle_action IS NOT NULL),
         bool_or(handle_action IS NULL)
  INTO v_remaining, v_any_handled, v_any_unhandled
  FROM purchase_order_items WHERE order_id = p_order_id;

  IF v_remaining = 0 THEN
    DELETE FROM purchase_orders WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'order_deleted', true);
  END IF;

  v_new_status := CASE
    WHEN v_any_handled AND v_any_unhandled THEN 'partial_received'
    WHEN v_any_handled THEN 'pending_storage'
    ELSE 'submitted' END;
  UPDATE purchase_orders SET status = v_new_status WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'order_deleted', false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   四、部分收货(采购单详情页用,原子事务)
   支持一张单分多次收货:实收数量原子累加,收满的行自动标记 normal;
   全单收满才推进待入库。不直接加库存——库存统一由入库确认
   (complete_purchase_inbound)增加,保证每笔库存都有入库单和应付款。
   破损/错发等异常请走采购管理页待收货列表的完整处理动作。
   ============================================================ */
CREATE OR REPLACE FUNCTION receive_purchase_item_partial(
  p_order_id UUID,
  p_item_id UUID,
  p_qty INTEGER,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_new_received INTEGER;
  v_ordered INTEGER;
  v_all_handled BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '收货数量必须大于 0');
  END IF;

  SELECT * INTO v_order FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status NOT IN ('submitted', 'approved', 'partial_received') THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单当前状态不允许收货');
  END IF;

  /* 原子累加实收数量;超收直接报错,整单回滚 */
  UPDATE purchase_order_items
  SET received_qty = COALESCE(received_qty, 0) + p_qty
  WHERE id = p_item_id AND order_id = p_order_id
  RETURNING received_qty, quantity INTO v_new_received, v_ordered;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;
  IF v_new_received > v_ordered THEN
    RAISE EXCEPTION '超过订购数量:订 % 件,已收 % 件,本次又收 % 件', v_ordered, v_new_received - p_qty, p_qty;
  END IF;

  /* 收满的行标记正常处理 */
  IF v_new_received = v_ordered THEN
    UPDATE purchase_order_items SET handle_action = 'normal'
    WHERE id = p_item_id AND handle_action IS NULL;
  END IF;

  /* 全单收满 → 待入库;否则部分收货 */
  SELECT bool_and(handle_action IS NOT NULL) INTO v_all_handled
  FROM purchase_order_items WHERE order_id = p_order_id;

  IF v_all_handled THEN
    UPDATE purchase_orders SET status = 'pending_storage' WHERE id = p_order_id;
    IF v_order.waybill_id IS NOT NULL THEN
      UPDATE logistics_waybills SET status = 'received', received_at = NOW()
      WHERE id = v_order.waybill_id;
    END IF;
  ELSE
    UPDATE purchase_orders SET status = 'partial_received' WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'all_received', v_all_handled);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;
