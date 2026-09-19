/* ============================================================
 * 撤销入库：物理删流水改为追加反向流水（2026-09-19，严谨性整改阶段二 · 任务11 补）
 *
 * 问题：revoke_completed_inbound 回滚库存时是 DELETE inventory_logs
 *   ——原入库流水被物理抹掉，审计链出"空洞"：
 *   事后无法回答"这批货到底入过没有、什么时候入的、谁入的"。
 *
 * 口径（修复后）：
 *   1. 原入库流水【保留】（不再 DELETE）——入库事实永远可查
 *   2. 追加一条 type='adjust' 的净额回滚流水（reference_type='revoke_inbound'，
 *      reference_id=采购单 id），before/after 精确到每个配件
 *   3. 库存回滚逻辑（净额=入库量-退库回补量）一字未动，
 *      只是把 UPDATE 改成带回写流水的数据修改 CTE
 *
 * 其余步骤（安全检查/仓位扣回/删入库单/删批次/删应付款/状态回退）
 *   与 0913_a 版逐字一致。
 * 幂等：CREATE OR REPLACE（参数列表未变），可重跑。
 * ============================================================ */

CREATE OR REPLACE FUNCTION revoke_completed_inbound(
  p_purchase_order_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_批次们 UUID[];
  v_inbound_ids UUID[];
  v_涉及单们 UUID[];
  v_批次入库单数 INT;
  v_不足编码 TEXT;
  v_当前库存 INTEGER;
  v_需扣回 BIGINT;
  v_仓位不足编码 TEXT;
  v_其它入库单单号 TEXT;
BEGIN
  /* 0. 登录校验 + 角色门禁 */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 1. 锁定采购单并校验状态 */
  SELECT * INTO v_order FROM purchase_orders WHERE id = p_purchase_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', '仅「已入库」状态的采购单可撤销');
  END IF;

  /* 2. 找该单明细挂的批次（空=蓝卡流程，非空=黄卡流程要整批回滚） */
  SELECT COALESCE(ARRAY_AGG(DISTINCT receiving_batch_id), '{}') INTO v_批次们
  FROM purchase_order_items
  WHERE order_id = p_purchase_order_id AND receiving_batch_id IS NOT NULL;

  IF array_length(v_批次们, 1) IS NULL THEN
    /* 蓝卡流程：单单回滚 */
    v_涉及单们 := ARRAY[p_purchase_order_id];
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_inbound_ids
    FROM inbound_orders
    WHERE purchase_order_id = p_purchase_order_id AND status = 'completed';
  ELSE
    /* 黄卡流程：整批回滚（批次入库单是批次级一张单，不能按单拆） */
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_inbound_ids
    FROM inbound_orders
    WHERE receiving_batch_id = ANY(v_批次们) AND status = 'completed';
    /* 批次下所有采购单都纳入回滚范围 */
    SELECT COALESCE(ARRAY_AGG(DISTINCT order_id), '{}') INTO v_涉及单们
    FROM purchase_order_items
    WHERE receiving_batch_id = ANY(v_批次们);
  END IF;

  IF array_length(v_inbound_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error',
      '数据异常:采购单已是已入库状态但找不到入库单，请联系管理员核对');
  END IF;

  /* 3. 安全检查一：涉及单里已有 completed 采退单的禁止回滚（货可能已寄回供应商） */
  IF EXISTS (
    SELECT 1 FROM supplier_return_records srr
    JOIN purchase_order_items poi ON poi.work_order_item_part_id = srr.work_order_item_part_id
    WHERE poi.order_id = ANY(v_涉及单们) AND srr.status = 'completed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      '涉及采购单已生成采退单(货可能已寄回供应商)，请先在「已退货」页撤销采退单，再撤销入库');
  END IF;

  /* 4. 安全检查二：涉及单还有【不在本次范围】的已完成入库单时拦截 */
  SELECT inbound_no INTO v_其它入库单单号
  FROM inbound_orders
  WHERE status = 'completed'
    AND purchase_order_id = ANY(v_涉及单们)
    AND NOT (id = ANY(v_inbound_ids))
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      '涉及采购单还有另一张已完成入库单 ' || v_其它入库单单号 || '（货是分次入的），暂不支持撤销，请联系管理员人工处理');
  END IF;

  /* 5. 库存预检：净扣量=入库量-退库回补量，不足即报错（不钳制） */
  WITH 入库量 AS (
    SELECT ii.part_id, SUM(ii.quantity) AS qty
    FROM inbound_order_items ii
    WHERE ii.inbound_order_id = ANY(v_inbound_ids)
      AND ii.part_id IS NOT NULL AND ii.quantity > 0
    GROUP BY ii.part_id
  ),
  退库回补量 AS (
    SELECT poi.part_id, SUM(poi.quantity) AS qty
    FROM purchase_order_items poi
    WHERE poi.order_id = ANY(v_涉及单们)
      AND poi.handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard')
      AND poi.part_id IS NOT NULL AND poi.quantity > 0
    GROUP BY poi.part_id
  ),
  净额 AS (
    SELECT COALESCE(i.part_id, r.part_id) AS part_id,
           COALESCE(i.qty, 0) - COALESCE(r.qty, 0) AS net
    FROM 入库量 i FULL OUTER JOIN 退库回补量 r ON r.part_id = i.part_id
  )
  SELECT p.part_number, p.quantity, x.net INTO v_不足编码, v_当前库存, v_需扣回
  FROM 净额 x JOIN parts p ON p.id = x.part_id
  WHERE p.quantity < x.net
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '配件 % 当前库存 % 不足扣回 %(可能已领料或盘点调整)，请先人工核对库存',
      COALESCE(v_不足编码, '(无编码)'), v_当前库存, v_需扣回;
  END IF;

  /* 6. 净额回滚总库存 + 逐配件写反向流水（原入库流水保留，审计链不出洞） */
  WITH 入库量 AS (
    SELECT ii.part_id, SUM(ii.quantity) AS qty
    FROM inbound_order_items ii
    WHERE ii.inbound_order_id = ANY(v_inbound_ids)
      AND ii.part_id IS NOT NULL AND ii.quantity > 0
    GROUP BY ii.part_id
  ),
  退库回补量 AS (
    SELECT poi.part_id, SUM(poi.quantity) AS qty
    FROM purchase_order_items poi
    WHERE poi.order_id = ANY(v_涉及单们)
      AND poi.handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard')
      AND poi.part_id IS NOT NULL AND poi.quantity > 0
    GROUP BY poi.part_id
  ),
  净额 AS (
    SELECT COALESCE(i.part_id, r.part_id) AS part_id,
           COALESCE(i.qty, 0) - COALESCE(r.qty, 0) AS net
    FROM 入库量 i FULL OUTER JOIN 退库回补量 r ON r.part_id = i.part_id
  ),
  回滚 AS (
    UPDATE parts p SET quantity = p.quantity - x.net
    FROM 净额 x
    WHERE p.id = x.part_id AND x.net <> 0
    RETURNING p.id AS part_id, p.quantity AS after_qty, p.quantity + x.net AS before_qty, x.net AS net
  )
  INSERT INTO inventory_logs (
    part_id, type, change_qty, before_qty, after_qty,
    reference_type, reference_id, operator_id, notes
  )
  SELECT part_id, 'adjust', -net, before_qty, after_qty,
         'revoke_inbound', p_purchase_order_id, p_operator_id,
         '撤销入库净额回滚（原入库流水保留）'
  FROM 回滚;

  /* 7. 仓位按入库量扣回（仓位只与入库量对称，不按退库量回补） */
  WITH 仓位入库量 AS (
    SELECT ii.part_id, ii.warehouse_id, COALESCE(ii.location, '') AS location, SUM(ii.quantity) AS qty
    FROM inbound_order_items ii
    WHERE ii.inbound_order_id = ANY(v_inbound_ids)
      AND ii.part_id IS NOT NULL AND ii.quantity > 0 AND ii.warehouse_id IS NOT NULL
    GROUP BY ii.part_id, ii.warehouse_id, COALESCE(ii.location, '')
  )
  SELECT p.part_number, y.qty INTO v_仓位不足编码, v_需扣回
  FROM 仓位入库量 y
  JOIN parts p ON p.id = y.part_id
  LEFT JOIN part_stock_locations psl
    ON psl.part_id = y.part_id AND psl.warehouse_id = y.warehouse_id
   AND COALESCE(psl.location, '') = y.location
  WHERE psl.id IS NULL OR psl.quantity < y.qty
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '配件 % 仓位库存不足扣回 %(可能已领料)，请先人工核对仓位',
      COALESCE(v_仓位不足编码, '(无编码)'), v_需扣回;
  END IF;

  WITH 仓位入库量 AS (
    SELECT ii.part_id, ii.warehouse_id, COALESCE(ii.location, '') AS location, SUM(ii.quantity) AS qty
    FROM inbound_order_items ii
    WHERE ii.inbound_order_id = ANY(v_inbound_ids)
      AND ii.part_id IS NOT NULL AND ii.quantity > 0 AND ii.warehouse_id IS NOT NULL
    GROUP BY ii.part_id, ii.warehouse_id, COALESCE(ii.location, '')
  )
  UPDATE part_stock_locations psl SET quantity = psl.quantity - y.qty
  FROM 仓位入库量 y
  WHERE psl.part_id = y.part_id AND psl.warehouse_id = y.warehouse_id
    AND COALESCE(psl.location, '') = y.location;

  /* 8. 删除入库相关数据（库存流水不再删除——保留原流水 + 第 6 步的反向流水） */
  DELETE FROM inbound_order_items WHERE inbound_order_id = ANY(v_inbound_ids);
  DELETE FROM inbound_orders WHERE id = ANY(v_inbound_ids);
  /* 未确认的 draft 确认单一并删除（没加过库存，但留着会误导再次确认） */
  DELETE FROM inbound_order_items
  WHERE inbound_order_id IN (
    SELECT id FROM inbound_orders
    WHERE status = 'draft'
      AND (purchase_order_id = ANY(v_涉及单们)
           OR (array_length(v_批次们, 1) IS NOT NULL AND receiving_batch_id = ANY(v_批次们)))
  );
  DELETE FROM inbound_orders
  WHERE status = 'draft'
    AND (purchase_order_id = ANY(v_涉及单们)
         OR (array_length(v_批次们, 1) IS NOT NULL AND receiving_batch_id = ANY(v_批次们)));
  /* 库存批次：蓝卡按采购单、黄卡按批次（与各自入库时的 reference_id 对称） */
  DELETE FROM part_batches
  WHERE inbound_type = 'purchase'
    AND (reference_id = ANY(v_涉及单们)
         OR (array_length(v_批次们, 1) IS NOT NULL AND reference_id = ANY(v_批次们)));
  DELETE FROM supplier_transactions WHERE reference_type = 'inbound_order' AND reference_id = ANY(v_inbound_ids);

  /* 9. 采购单退回「待入库」（收货结果 handle_action/received_qty 全部保留） */
  UPDATE purchase_orders SET status = 'pending_storage'
  WHERE id = ANY(v_涉及单们) AND status = 'completed';

  /* 10. 批次退回「待入库」（黄卡重新显示）；蓝卡流程 v_批次们 为空，此句无操作 */
  IF array_length(v_批次们, 1) IS NOT NULL THEN
    UPDATE receiving_batches SET status = 'pending_storage', inbounded_at = NULL
    WHERE id = ANY(v_批次们);
  END IF;

  RETURN jsonb_build_object('success', true, 'orders', array_length(v_涉及单们, 1));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION revoke_completed_inbound(UUID, UUID) IS
  '撤销已入库→退回待入库：库存/入库单/应付款回滚，收货结果保留；原入库流水保留+追加反向流水（2026-09-19 起审计链完整）';

/* 权限保持 */
REVOKE EXECUTE ON FUNCTION revoke_completed_inbound(UUID, UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_completed_inbound(UUID, UUID) TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_w_revoke_reverse_log.sql') ON CONFLICT DO NOTHING;
