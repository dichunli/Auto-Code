/* ============================================================
 * 退货运费三分流（2026-09-18 用户拍板，细化 _e 版的分摊规则）
 * 规则：
 *   1. 带车牌（给指定车辆采购）且能对应到未作废工单 → 计入该工单其它成本，
 *      即使工单已结算也计入
 *   2. 不带车牌的退货 → 计入其它费用（其它收支-其它支出），注明"退货付运费"
 *   3. 带车牌但工单已作废、或按车牌找不到对应工单 → 也计入其它费用，
 *      注明"车牌 X 退货运费"
 * 匹配顺序（每条退货记录）：工单配件行直链工单（未作废）→ 无直链时按车牌
 *   找该车最新未作废工单 → 都没有进其它费用。直链工单已作废不回退车牌匹配。
 * 改动：
 *   1. allocate_return_freight_to_work_orders 重写为三分流（函数名/参数不变）
 *   2. revoke_purchase_return_order 增加清理：撤销采退单时连带进其它费用的
 *      运费记录一起删（按备注里的采退单号识别）
 * 幂等：CREATE OR REPLACE（参数列表未变），可重跑。
 * ============================================================ */

CREATE OR REPLACE FUNCTION public.allocate_return_freight_to_work_orders(
  p_return_order_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ro RECORD;
  v_fee NUMERIC(12,2);
  v_row RECORD;
  v_wo UUID;
  v_total_weight NUMERIC;
  v_sum NUMERIC(12,2) := 0;
  v_count INT := 0;
  v_expense_category UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  SELECT * INTO v_ro FROM purchase_return_orders WHERE id = p_return_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采退单不存在');
  END IF;
  IF v_ro.shipping_fee_payer <> 'self' OR COALESCE(v_ro.return_shipping_fee, 0) <= 0 THEN
    RETURN jsonb_build_object('success', true, 'allocated', 0);
  END IF;
  /* 防重复分摊（撤销采退单会先删分摊记录，见 revoke_purchase_return_order） */
  IF EXISTS (SELECT 1 FROM work_order_other_costs
             WHERE source = 'return_freight' AND reference_id = p_return_order_id) THEN
    RETURN jsonb_build_object('success', true, 'allocated', 0);
  END IF;

  v_fee := v_ro.return_shipping_fee;

  /* 其它支出分类（记账兜底分类，没有则留空） */
  SELECT id INTO v_expense_category FROM other_transaction_categories
  WHERE name = '其它支出' LIMIT 1;

  /* 临时归集表：先按记录定归属（kind=wo 进工单 / kind=expense 进其它费用） */
  CREATE TEMP TABLE IF NOT EXISTS tmp_return_freight_alloc(
    kind TEXT, wo_id UUID, plate TEXT, weight NUMERIC
  ) ON COMMIT DROP;
  DELETE FROM tmp_return_freight_alloc;

  FOR v_row IN
    SELECT srr.id AS record_id,
           COALESCE(srr.quantity, 0) * COALESCE(srr.unit_cost, 0) AS weight,
           poi.license_plate AS plate,
           woi.work_order_id AS linked_wo
    FROM supplier_return_records srr
    LEFT JOIN purchase_order_items poi ON poi.id = srr.purchase_order_item_id
    LEFT JOIN work_order_item_parts woip ON woip.id = srr.work_order_item_part_id
    LEFT JOIN work_order_items woi ON woi.id = woip.work_order_item_id
    WHERE srr.return_order_id = p_return_order_id
  LOOP
    v_wo := NULL;
    IF v_row.linked_wo IS NOT NULL THEN
      /* 直链工单未作废才计入（已结算也计入）；已作废按用户规则进其它费用 */
      PERFORM 1 FROM work_orders
      WHERE id = v_row.linked_wo AND order_type IS DISTINCT FROM 'cancelled';
      IF FOUND THEN v_wo := v_row.linked_wo; END IF;
    ELSIF NULLIF(BTRIM(COALESCE(v_row.plate, '')), '') IS NOT NULL THEN
      /* 无直链但带车牌：按车牌找该车最新未作废工单（含已结算） */
      SELECT wo.id INTO v_wo
      FROM vehicles v
      JOIN work_orders wo ON wo.vehicle_id = v.id
      WHERE v.plate_number = UPPER(BTRIM(v_row.plate))
        AND wo.order_type IS DISTINCT FROM 'cancelled'
      ORDER BY wo.created_at DESC
      LIMIT 1;
    END IF;

    INSERT INTO tmp_return_freight_alloc(kind, wo_id, plate, weight)
    VALUES (
      CASE WHEN v_wo IS NOT NULL THEN 'wo' ELSE 'expense' END,
      v_wo,
      UPPER(BTRIM(COALESCE(v_row.plate, ''))),
      v_row.weight
    );
  END LOOP;

  SELECT COALESCE(SUM(weight), 0) INTO v_total_weight FROM tmp_return_freight_alloc;
  IF v_total_weight <= 0 THEN
    /* 全部退货记录都没有金额（0 元配件），没法按比例分，不进工单也不记费用，
       运费仍留在物流应付里，由人工处理 */
    RETURN jsonb_build_object('success', true, 'allocated', 0);
  END IF;

  /* 按归属汇总：工单按工单聚合，其它费用按车牌聚合（同车牌一笔费用） */
  CREATE TEMP TABLE IF NOT EXISTS tmp_return_freight_groups(
    kind TEXT, wo_id UUID, plate TEXT, weight NUMERIC, share NUMERIC
  ) ON COMMIT DROP;
  DELETE FROM tmp_return_freight_groups;

  INSERT INTO tmp_return_freight_groups(kind, wo_id, plate, weight)
  SELECT kind, wo_id, plate, SUM(weight)
  FROM tmp_return_freight_alloc
  GROUP BY kind, wo_id, plate;

  /* 按比例分摊到分，尾差并入权重最大的一组 */
  UPDATE tmp_return_freight_groups
  SET share = ROUND(v_fee * weight / v_total_weight, 2);
  SELECT COALESCE(SUM(share), 0) INTO v_sum FROM tmp_return_freight_groups;
  UPDATE tmp_return_freight_groups
  SET share = share + (v_fee - v_sum)
  WHERE ctid IN (SELECT ctid FROM tmp_return_freight_groups ORDER BY weight DESC LIMIT 1);

  FOR v_row IN SELECT * FROM tmp_return_freight_groups WHERE share > 0 LOOP
    IF v_row.kind = 'wo' THEN
      /* 情况1：计入工单其它成本（已结算工单也计入） */
      INSERT INTO public.work_order_other_costs (
        work_order_id, name, amount, source, reference_id, notes, created_by
      ) VALUES (
        v_row.wo_id, '退货运费', v_row.share, 'return_freight', p_return_order_id,
        '采退单 ' || COALESCE(v_ro.return_no, '') ||
          CASE WHEN v_row.plate <> '' THEN ' · 车牌 ' || v_row.plate ELSE '' END,
        p_operator_id
      );
    ELSE
      /* 情况2/3：计入其它费用（其它收支-支出），按用户要求注明 */
      INSERT INTO public.other_transactions (
        type, amount, name, counterparty, operator_id,
        category_id, transaction_date, notes
      ) VALUES (
        'expense', v_row.share, NULL, v_ro.supplier_name, p_operator_id,
        v_expense_category, CURRENT_DATE,
        CASE WHEN v_row.plate <> ''
             THEN '车牌 ' || v_row.plate || ' 退货运费[采退单 ' || COALESCE(v_ro.return_no, '') || ']'
             ELSE '退货付运费[采退单 ' || COALESCE(v_ro.return_no, '') || ']' END
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'allocated', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.allocate_return_freight_to_work_orders(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_return_freight_to_work_orders(uuid, uuid) TO authenticated;

/* ─── 撤销采退单：连带清理进其它费用的运费记录 ───
   函数体与 migrations_20260918_e_work_order_other_costs.sql 一致，
   仅新增按备注里的采退单号删除其它收支运费记录 */

CREATE OR REPLACE FUNCTION public.revoke_purchase_return_order(
  p_record_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_return_id UUID;
  v_return_no TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 1. 查退货记录并校验状态 */
  SELECT id, status, return_order_id INTO v_rec
  FROM supplier_return_records WHERE id = p_record_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '退货记录不存在');
  END IF;
  IF v_rec.status <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', '仅「已退货」状态的记录可撤销');
  END IF;

  v_return_id := v_rec.return_order_id;

  IF v_return_id IS NOT NULL THEN
    /* 2. 锁采退单(防并发重复撤销)并取单号 */
    SELECT return_no INTO v_return_no FROM purchase_return_orders
    WHERE id = v_return_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '关联的采退单不存在(数据异常)');
    END IF;

    /* 2.5 删运费分摊的工单其它成本明细 + 物流应付流水 + 其它费用运费记录（2026-09-18 配套） */
    DELETE FROM public.work_order_other_costs
    WHERE source = 'return_freight' AND reference_id = v_return_id;
    DELETE FROM public.logistics_transactions
    WHERE reference_type = 'purchase_return_order' AND reference_id = v_return_id;
    IF v_return_no IS NOT NULL THEN
      DELETE FROM public.other_transactions
      WHERE type = 'expense'
        AND position('[采退单 ' || v_return_no || ']' IN COALESCE(notes, '')) > 0;
    END IF;

    /* 3. 删采退单明细 */
    DELETE FROM purchase_return_order_items WHERE return_order_id = v_return_id;

    /* 4. 删应收冲减财务记录 */
    DELETE FROM supplier_transactions
    WHERE reference_type = 'purchase_return_order' AND reference_id = v_return_id;

    /* 5. 同采退单的全部退货记录回 pending 并解除关联
       (先于删采退单执行,无论 FK 的 ON DELETE 行为如何都安全) */
    UPDATE supplier_return_records
    SET status = 'pending', return_order_id = NULL
    WHERE return_order_id = v_return_id;

    /* 6. 删采退单 */
    DELETE FROM purchase_return_orders WHERE id = v_return_id;
  ELSE
    /* 未生成采退单的记录(单条"标记完成"路径):直接回 pending */
    UPDATE supplier_return_records SET status = 'pending' WHERE id = p_record_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.revoke_purchase_return_order(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_purchase_return_order(uuid, uuid) TO authenticated;

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260918_f_return_freight_expense.sql', '退货运费三分流：直链未作废工单→工单成本；无车牌→其它费用；车牌对不上/工单作废→其它费用记车牌')
ON CONFLICT (file_name) DO NOTHING;
