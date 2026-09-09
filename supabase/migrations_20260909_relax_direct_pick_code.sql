/* 急件直领放宽编码限制（2026-09-09 补充）
 *
 * 背景：直领开单 RPC 原来要求采购行"已关联编码"（part_id 非空）才可直领，
 * 用户实测发现待入库的件大多还没补编码，全部被拦住。
 *
 * 重新评估后放宽：直领登记挂的是采购行（purchase_order_item_id），库存账在
 * 确认入库时才动；而确认入库本身强制"编码必填"（无编码的行入不了库），
 * 冲账段又在入库事务内执行——编码这道闸在入库环节已经存在，直领环节不需要。
 *
 * 改动：create_direct_picking_order 候选采购行去掉 part_id 非空限制，
 * 报错文案同步去掉"已关联编码"。CREATE OR REPLACE 保留原权限收口，无需重收。
*/

CREATE OR REPLACE FUNCTION public.create_direct_picking_order(
  p_items JSONB,
  p_receiver_name TEXT,
  p_notes TEXT,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_picking_no TEXT;
  v_work_order_id UUID;
  v_item JSONB;
  v_branch RECORD;
  v_poi RECORD;
  v_need INTEGER;
  v_picked INTEGER;
  v_returned INTEGER;
  v_remain INTEGER;
  v_alloc INTEGER;
  v_direct_used INTEGER;
  v_capacity INTEGER;
  v_found_line BOOLEAN;
  v_total INTEGER := 0;
  v_record_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 直领是库管操作，权限对齐入库/采购函数 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可直领');
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '直领明细不能为空');
  END IF;

  /* 从第一条明细的分支反查工单（领料单要挂工单） */
  SELECT woi.work_order_id INTO v_work_order_id
  FROM work_order_item_parts p
  JOIN work_order_items woi ON woi.id = p.work_order_item_id
  WHERE p.id = (p_items->0->>'work_order_item_part_id')::UUID;

  INSERT INTO public.picking_orders (work_order_id, receiver_name, notes, operator_id)
  VALUES (v_work_order_id, NULLIF(TRIM(COALESCE(p_receiver_name, '')), ''), NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_operator_id)
  RETURNING id, picking_no INTO v_order_id, v_picking_no;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_need := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_need <= 0 THEN
      RAISE EXCEPTION '直领数量必须是大于 0 的整数';
    END IF;

    /* 锁分支并校验：必须选中、客户同意、数量已定 */
    SELECT * INTO v_branch FROM public.work_order_item_parts
    WHERE id = (v_item->>'work_order_item_part_id')::UUID FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '工单配件分支不存在';
    END IF;
    IF NOT v_branch.is_selected THEN
      RAISE EXCEPTION '配件「%」不是选中分支，不能直领', COALESCE(v_branch.name, '');
    END IF;
    IF v_branch.customer_opinion IS DISTINCT FROM 'agree' THEN
      RAISE EXCEPTION '配件「%」客户尚未同意，不能直领', COALESCE(v_branch.name, '');
    END IF;
    IF v_branch.quantity IS NULL THEN
      RAISE EXCEPTION '配件「%」数量未填写，请先在工单上补数量', COALESCE(v_branch.name, '');
    END IF;

    /* 剩余需领 = 目录数量 - 净领（领-退）；直领登记在册即占用 */
    SELECT COALESCE(SUM(quantity), 0) INTO v_picked
    FROM public.part_picking_records WHERE work_order_item_part_id = v_branch.id;
    SELECT COALESCE(SUM(quantity), 0) INTO v_returned
    FROM public.part_return_records WHERE work_order_item_part_id = v_branch.id;
    v_remain := v_branch.quantity - (v_picked - v_returned);
    IF v_need > v_remain THEN
      RAISE EXCEPTION '配件「%」剩余需领 % 件，本次直领 % 件超量',
        COALESCE(v_branch.name, ''), v_remain, v_need;
    END IF;

    /* 按待入库采购行从老到新分摊；容量 = 实收数 - 该行已被直领占用数。
       不要求已关联编码：入库环节强制编码必填，冲账在入库事务内执行，闸已存在 */
    v_found_line := false;
    FOR v_poi IN
      SELECT poi.id, poi.quantity, poi.received_qty
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders o ON o.id = poi.order_id
      LEFT JOIN public.receiving_batches rb ON rb.id = poi.receiving_batch_id
      WHERE poi.work_order_item_part_id = v_branch.id
        AND poi.handle_action IN ('normal','excess_paid','excess_free','excess_return','short_repurchase','short_discard')
        AND (rb.status = 'pending_storage'
             OR (poi.receiving_batch_id IS NULL AND o.status = 'pending_storage'))
      ORDER BY poi.created_at
      FOR UPDATE OF poi
    LOOP
      EXIT WHEN v_need <= 0;
      v_found_line := true;
      SELECT COALESCE(SUM(quantity), 0) INTO v_direct_used
      FROM public.part_picking_records
      WHERE purchase_order_item_id = v_poi.id AND is_direct AND batch_id IS NULL;
      v_capacity := COALESCE(v_poi.received_qty, v_poi.quantity) - v_direct_used;
      IF v_capacity <= 0 THEN CONTINUE; END IF;

      v_alloc := LEAST(v_need, v_capacity);

      /* 直领登记：batch_id NULL、不动库存（触发器旁路），入库确认时冲账 */
      INSERT INTO public.part_picking_records (
        work_order_item_part_id, batch_id, quantity, picked_by, picking_order_id,
        is_direct, purchase_order_item_id
      ) VALUES (
        v_branch.id, NULL, v_alloc, p_operator_id, v_order_id,
        true, v_poi.id
      )
      RETURNING id INTO v_record_id;

      INSERT INTO public.picking_order_items (
        picking_order_id, picking_record_id, work_order_item_part_id, part_id, batch_id,
        part_number, name, brand, specification, unit, batch_no, unit_cost, quantity
      ) VALUES (
        v_order_id, v_record_id, v_branch.id, v_branch.part_id, NULL,
        v_branch.part_number, COALESCE(v_branch.alias_name, v_branch.name), v_branch.brand,
        v_branch.specification, v_branch.unit, NULL, v_branch.unit_cost, v_alloc
      );

      v_need := v_need - v_alloc;
      v_total := v_total + v_alloc;
    END LOOP;

    IF v_need > 0 THEN
      IF NOT v_found_line THEN
        RAISE EXCEPTION '配件「%」没有可直领的待入库在途行（需已收货且批次/采购单在待入库）',
          COALESCE(v_branch.name, '');
      ELSE
        RAISE EXCEPTION '配件「%」待入库在途数量不足，还差 % 件无法直领',
          COALESCE(v_branch.name, ''), v_need;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.picking_orders SET total_quantity = v_total WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'picking_order_id', v_order_id, 'picking_no', v_picking_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* 台账登记（台账表不存在时跳过） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_log') THEN
    INSERT INTO migration_log (file_name) VALUES ('migrations_20260909_relax_direct_pick_code.sql') ON CONFLICT DO NOTHING;
  END IF;
END $$;

/* 验证：SELECT pg_get_functiondef(oid) NOT LIKE '%poi.part_id IS NOT NULL%'
   FROM pg_proc WHERE proname='create_direct_picking_order'; 应返回 true */
