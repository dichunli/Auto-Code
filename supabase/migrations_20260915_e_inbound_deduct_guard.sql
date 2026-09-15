/* 入库破损弃货扣库存防超扣掩盖（2026-09-15，DeepSeek 诊断 G 项甄别）
   背景：GREATEST(0, quantity - x) 会把'库存不够扣'掩盖成'刚好归零'，
        账实不符没有信号。全库 35 处 GREATEST(0 逐处甄别后仅此一处是
        真扣库存（其余为计时防负/算术防负/已校验后的双保险，均保留）。
   改法：条件 UPDATE（库存够才扣）；不够扣时不扣减、不归零，写
        system_alerts 告警留信号，入库流程不被硬卡死。
   说明：函数签名未变（8 参），CREATE OR REPLACE 即可，无需 DROP。
        函数体除第 6 段外与 migrations_20260909_direct_picking.sql 一致。
*/

CREATE OR REPLACE FUNCTION public.complete_purchase_inbound(
  p_purchase_order_id UUID,
  p_items JSONB,
  p_freight_amount DECIMAL,
  p_operator_id UUID,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_supplier_order_no TEXT DEFAULT NULL,
  p_supplier_order_amount DECIMAL DEFAULT NULL,
  p_draft_inbound_id UUID DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_draft RECORD;
  v_item JSONB;
  v_poi RECORD;
  v_inbound_id UUID;
  v_inbound_no TEXT;
  v_qty INTEGER;
  v_unit_cost DECIMAL(12,2);
  v_total_qty INTEGER := 0;
  v_total_amount DECIMAL(12,2) := 0;
  v_goods_amount DECIMAL(12,2) := 0;
  v_alloc DECIMAL(10,2);
  v_manual_freight DECIMAL(12,2) := 0;
  v_auto_amount DECIMAL(12,2) := 0;
  v_remain_freight DECIMAL(12,2) := 0;
  v_line_amount DECIMAL(12,2);
  v_before_qty INTEGER;
  v_after_qty INTEGER;
  v_loc TEXT;
  v_ret RECORD;
  v_ret_qty INTEGER;
  v_supplier_name TEXT;
  v_payable DECIMAL(12,2);
  /* 急件直领冲账用 */
  v_direct_qty INTEGER;
  v_new_batch_id UUID;
  v_direct_rec RECORD;
  v_running_qty INTEGER;
  v_direct_wo UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 1. 锁定采购单并校验状态(防并发重复入库) */
  SELECT * INTO v_order
  FROM purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status <> 'pending_storage' THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单当前状态不允许入库(可能已入库或被退回)');
  END IF;

  /* 1.4 入库确认单（2026-09-08 两阶段）：同批次版口径 */
  IF p_draft_inbound_id IS NOT NULL THEN
    SELECT * INTO v_draft FROM public.inbound_orders WHERE id = p_draft_inbound_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '入库确认单不存在');
    END IF;
    IF v_draft.status <> 'draft' THEN
      RETURN jsonb_build_object('success', false, 'error', '入库确认单已确认，请勿重复操作');
    END IF;
    IF v_draft.purchase_order_id IS DISTINCT FROM p_purchase_order_id THEN
      RETURN jsonb_build_object('success', false, 'error', '入库确认单与本采购单不匹配');
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.inbound_orders
      WHERE purchase_order_id = p_purchase_order_id AND status = 'draft'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error',
        '该采购单已生成入库确认单，请从入库单详情页确认入库（或先作废确认单）');
    END IF;
  END IF;

  /* 1.5 防双流程(2026-08-20 二期):走过到货确认单的采购单必须从到货单入库 */
  IF EXISTS (
    SELECT 1 FROM purchase_order_items
    WHERE order_id = p_purchase_order_id AND arrival_item_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '该采购单已走到货确认单流程，请从到货单办理入库');
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_order.supplier_id;

  /* 2. 第一遍扫描：校验明细、编码必填、累计货款/数量、分离手动运费行 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    /* 以服务端采购明细为准取快照字段,不信客户端 */
    SELECT * INTO v_poi FROM purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
      AND order_id = p_purchase_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '采购明细 % 不属于本采购单', v_item->>'purchase_order_item_id';
    END IF;

    /* 编码必填（2026-09-07 拍板）：无配件档案的行不能入库 */
    IF v_poi.part_id IS NULL THEN
      RAISE EXCEPTION '配件「%」未关联零件编码，请先在待入库列表补全编码后再入库', COALESCE(v_poi.name, '');
    END IF;

    /* 自定义入库价优先（对销售单改价），缺省采购明细价 */
    v_unit_cost := COALESCE((v_item->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0);
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION '入库单价不能为负（%）', COALESCE(v_poi.name, '');
    END IF;

    v_line_amount := v_qty * v_unit_cost;
    v_goods_amount := v_goods_amount + v_line_amount;
    v_total_qty := v_total_qty + v_qty;

    IF (v_item->>'freight_alloc') IS NOT NULL THEN
      /* 手动指定运费的行：锁定，不参与自动分摊 */
      v_manual_freight := v_manual_freight + COALESCE((v_item->>'freight_alloc')::DECIMAL, 0);
    ELSE
      v_auto_amount := v_auto_amount + v_line_amount;
    END IF;
  END LOOP;

  IF v_total_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '入库数量必须大于 0');
  END IF;

  /* 2.5 销售单拦截校验（2026-08-21 拍板）：填了销售单总金额才启用；
         Σ(入库价×数量) − 优惠抹零(减项) 必须等于销售单总金额，否则拦住 */
  IF p_supplier_order_amount IS NOT NULL THEN
    IF ABS((v_goods_amount - COALESCE(p_discount_amount, 0)) - p_supplier_order_amount) > 0.01 THEN
      RETURN jsonb_build_object('success', false, 'error',
        '入库货款合计 ¥' || ROUND(v_goods_amount, 2) ||
        ' − 抹零 ¥' || ROUND(COALESCE(p_discount_amount, 0), 2) ||
        ' ≠ 销售单总金额 ¥' || ROUND(p_supplier_order_amount, 2) ||
        '，请逐行核对入库单价，或在「优惠抹零」填入差额');
    END IF;
  END IF;

  v_remain_freight := COALESCE(p_freight_amount, 0) - v_manual_freight;
  IF v_remain_freight < 0 THEN v_remain_freight := 0; END IF;

  /* 3. 入库单主表：draft 模式 UPDATE 原单（单号不变），否则新建 */
  IF p_draft_inbound_id IS NOT NULL THEN
    UPDATE inbound_orders
    SET supplier_id = v_order.supplier_id,
        supplier_name = COALESCE(v_supplier_name, ''),
        freight_amount = COALESCE(p_freight_amount, 0),
        waybill_id = v_order.waybill_id,
        operator_id = p_operator_id,
        supplier_order_no = NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), ''),
        supplier_order_amount = p_supplier_order_amount,
        discount_amount = COALESCE(p_discount_amount, 0)
    WHERE id = p_draft_inbound_id;
    v_inbound_id := v_draft.id;
    v_inbound_no := v_draft.inbound_no;
    DELETE FROM inbound_order_items WHERE inbound_order_id = v_inbound_id;
  ELSE
    INSERT INTO inbound_orders (
      purchase_order_id, supplier_id, supplier_name,
      total_quantity, total_amount, freight_amount,
      waybill_id, status, notes, operator_id,
      supplier_order_no, supplier_order_amount, discount_amount
    ) VALUES (
      p_purchase_order_id, v_order.supplier_id, COALESCE(v_supplier_name, ''),
      0, 0, COALESCE(p_freight_amount, 0),
      v_order.waybill_id, 'completed', '', p_operator_id,
      NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), ''),
      p_supplier_order_amount, COALESCE(p_discount_amount, 0)
    )
    RETURNING id, inbound_no INTO v_inbound_id, v_inbound_no;
  END IF;

  /* 3.5 销售单号/金额回写采购单（收货时没填、入库时补录的场景） */
  IF NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), '') IS NOT NULL THEN
    UPDATE purchase_orders
    SET supplier_order_no = TRIM(p_supplier_order_no),
        supplier_order_amount = COALESCE(p_supplier_order_amount, supplier_order_amount)
    WHERE id = p_purchase_order_id;
  END IF;

  /* 4. 逐条入库:明细 + 加库存 + 仓位 + 批次 + 流水 + 直领冲账 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
      AND order_id = p_purchase_order_id;

    v_unit_cost := COALESCE((v_item->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0);

    /* 运费分摊：手动行用指定值；其余按行金额占比分摊剩余运费 */
    IF (v_item->>'freight_alloc') IS NOT NULL THEN
      v_alloc := ROUND(COALESCE((v_item->>'freight_alloc')::DECIMAL, 0), 2);
    ELSIF v_auto_amount > 0 THEN
      v_alloc := ROUND(v_remain_freight * (v_qty * v_unit_cost) / v_auto_amount, 2);
    ELSE
      v_alloc := 0;
    END IF;

    v_total_amount := v_total_amount + v_qty * v_unit_cost + v_alloc;

    INSERT INTO inbound_order_items (
      inbound_order_id, purchase_order_item_id, part_id,
      part_number, name, brand, specification, unit,
      quantity, unit_cost, allocated_cost, freight_manual,
      batch_no, warehouse_id, location, notes
    ) VALUES (
      v_inbound_id, v_poi.id, v_poi.part_id,
      v_poi.part_number, v_poi.name, v_poi.brand, v_poi.specification, v_poi.unit,
      v_qty, v_unit_cost, v_alloc, (v_item->>'freight_alloc') IS NOT NULL,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      NULLIF(v_item->>'warehouse_id', '')::UUID,
      NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''),
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    );

    IF v_poi.part_id IS NULL THEN CONTINUE; END IF;

    /* 直领冲账（2026-09-09 急件直领）：该采购行待冲账直领合计 */
    SELECT COALESCE(SUM(quantity), 0) INTO v_direct_qty
    FROM public.part_picking_records
    WHERE purchase_order_item_id = v_poi.id AND is_direct AND batch_id IS NULL;
    IF v_direct_qty > v_qty THEN
      RAISE EXCEPTION '配件「%」直领 % 件超过本次入库 % 件，请先在领料单详情取消多余的直领',
        COALESCE(v_poi.name, ''), v_direct_qty, v_qty;
    END IF;

    /* 加库存 + 更新价格（2026-08-21 口径）：
       purchase_price = 裸采购价（销售单入库单价）
       cost_price     = 采购价 + 单位运费分摊（本单成本价） */
    UPDATE parts
    SET quantity = quantity + v_qty,
        purchase_price = v_unit_cost,
        cost_price = v_unit_cost + ROUND(v_alloc / v_qty, 2)
    WHERE id = v_poi.part_id
    RETURNING quantity INTO v_after_qty;
    v_before_qty := v_after_qty - v_qty;

    /* 工单配件行成本价同步（毛利计算基准，该列 5 月已建但从未启用） */
    IF v_poi.work_order_item_part_id IS NOT NULL THEN
      UPDATE work_order_item_parts
      SET cost_price = v_unit_cost + ROUND(v_alloc / v_qty, 2)
      WHERE id = v_poi.work_order_item_part_id;
    END IF;

    /* 仓位库存:空仓位统一按空串口径匹配/存储；直领件实物没上过架，只加净额 */
    IF NULLIF(v_item->>'warehouse_id', '') IS NOT NULL AND (v_qty - v_direct_qty) > 0 THEN
      v_loc := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''), '');
      UPDATE part_stock_locations
      SET quantity = quantity + (v_qty - v_direct_qty)
      WHERE part_id = v_poi.part_id
        AND warehouse_id = (v_item->>'warehouse_id')::UUID
        AND COALESCE(location, '') = v_loc;
      IF NOT FOUND THEN
        INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity)
        VALUES (v_poi.part_id, (v_item->>'warehouse_id')::UUID, v_loc, v_qty - v_direct_qty);
      END IF;
    END IF;

    /* 批次：初始量记真实实收，剩余直接扣掉直领量（unit_cost 记裸入库价，分摊成本在 allocated_cost/配件档案） */
    INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id, inbound_type, reference_id, notes)
    VALUES (
      v_poi.part_id,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      v_qty, v_qty - v_direct_qty, v_unit_cost, v_order.supplier_id,
      'purchase', p_purchase_order_id,
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    )
    RETURNING id INTO v_new_batch_id;

    /* 库存流水 */
    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, waybill_id, operator_id, notes)
    VALUES (
      v_poi.part_id, 'inbound', v_qty, v_before_qty, v_after_qty,
      'inbound_order', v_inbound_id, v_order.waybill_id, p_operator_id,
      '采购入库: ' || COALESCE(v_poi.name, '') ||
        CASE WHEN NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), '') IS NOT NULL
             THEN ' 批次:' || TRIM(v_item->>'batch_no') ELSE '' END
    );

    /* 直领冲账：回填批次 + 领料单明细补批次 + 逐条补写 outbound 流水（即入即出） */
    IF v_direct_qty > 0 THEN
      v_running_qty := v_after_qty;
      FOR v_direct_rec IN
        SELECT * FROM public.part_picking_records
        WHERE purchase_order_item_id = v_poi.id AND is_direct AND batch_id IS NULL
        ORDER BY picked_at
        FOR UPDATE
      LOOP
        UPDATE public.part_picking_records
        SET batch_id = v_new_batch_id
        WHERE id = v_direct_rec.id;

        UPDATE public.picking_order_items
        SET batch_id = v_new_batch_id,
            batch_no = COALESCE(batch_no, NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''))
        WHERE picking_record_id = v_direct_rec.id;

        SELECT woi.work_order_id INTO v_direct_wo
        FROM public.work_order_item_parts p
        JOIN public.work_order_items woi ON woi.id = p.work_order_item_id
        WHERE p.id = v_direct_rec.work_order_item_part_id;

        INSERT INTO public.inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, waybill_id, operator_id, notes)
        VALUES (
          v_poi.part_id, 'outbound', -v_direct_rec.quantity, v_running_qty, v_running_qty - v_direct_rec.quantity,
          v_direct_wo, 'picking_record', v_direct_rec.id, v_order.waybill_id, p_operator_id,
          '急件直领出库（即入即出）'
        );
        v_running_qty := v_running_qty - v_direct_rec.quantity;
      END LOOP;
    END IF;
  END LOOP;

  /* 5. 回填入库单合计（draft 模式同事务翻牌 completed） */
  UPDATE inbound_orders
  SET total_quantity = v_total_qty, total_amount = v_total_amount, status = 'completed'
  WHERE id = v_inbound_id;

  /* 6. 破损/错发/弃货类:退库减库存 */
  FOR v_ret IN
    SELECT * FROM purchase_order_items
    WHERE order_id = p_purchase_order_id
      AND handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard')
  LOOP
    v_ret_qty := v_ret.quantity;
    IF v_ret.part_id IS NOT NULL AND v_ret_qty > 0 THEN
      UPDATE parts SET quantity = quantity - v_ret_qty
      WHERE id = v_ret.part_id AND quantity >= v_ret_qty;
      /* 库存不够扣：保持原值不归零，写告警留账实不符信号
         （GREATEST(0,..) 会把超扣掩盖成'刚好归零'，丢信号） */
      IF NOT FOUND THEN
        INSERT INTO system_alerts (kind, message)
        VALUES ('库存', '入库破损/弃货扣减失败：配件 ' || v_ret.part_id || ' 需扣 ' || v_ret_qty || ' 件但库存不足，入库单 ' || COALESCE(v_inbound_no,'(无单号)') || '，请人工核对库存');
      END IF;
    END IF;
  END LOOP;

  /* 7. 应付款 = 货款 − 抹零（有销售单时即销售单总金额，已校验相等）；
        运费单独和物流公司结算，不进供应商账 */
  v_payable := v_goods_amount - COALESCE(p_discount_amount, 0);
  IF v_order.supplier_id IS NOT NULL AND v_payable > 0 THEN
    INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_order.supplier_id, 'debit', ROUND(v_payable, 2),
            '采购入库' || CASE WHEN p_supplier_order_no IS NOT NULL AND TRIM(p_supplier_order_no) <> ''
                              THEN '(销售单 ' || TRIM(p_supplier_order_no) || ')' ELSE '' END,
            v_inbound_id, 'inbound_order');
  END IF;

  /* 8. 采购单状态 → 已完成 */
  UPDATE purchase_orders SET status = 'completed' WHERE id = p_purchase_order_id;

  /* 8.5 关联工单配件行标记已到货 */
  UPDATE work_order_item_parts
  SET is_arrived = true
  WHERE id IN (
    SELECT work_order_item_part_id FROM purchase_order_items
    WHERE order_id = p_purchase_order_id AND work_order_item_part_id IS NOT NULL
  );

  /* 9. 自动生成待退货记录(破损/错发/多发退货) */
  INSERT INTO supplier_return_records (work_order_item_part_id, return_reason, quantity, supplier_name, photos, status)
  SELECT
    poi.work_order_item_part_id,
    CASE poi.handle_action
      WHEN 'broken_exchange' THEN 'damaged'
      WHEN 'broken_discard'  THEN 'damaged'
      WHEN 'wrong_exchange'  THEN 'wrong_ship'
      WHEN 'wrong_discard'   THEN 'wrong_ship'
      WHEN 'excess_return'   THEN 'excess'
    END,
    CASE WHEN poi.handle_action = 'excess_return'
         THEN GREATEST(0, COALESCE(poi.received_qty, 0) - poi.quantity)
         ELSE poi.quantity END,
    COALESCE(v_supplier_name, ''),
    (SELECT ARRAY(SELECT jsonb_array_elements_text(poi.evidence_photos))),
    'pending'
  FROM purchase_order_items poi
  WHERE poi.order_id = p_purchase_order_id
    AND poi.handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard','excess_return')
    AND poi.work_order_item_part_id IS NOT NULL
    AND CASE WHEN poi.handle_action = 'excess_return'
             THEN GREATEST(0, COALESCE(poi.received_qty, 0) - poi.quantity)
             ELSE poi.quantity END > 0;

  RETURN jsonb_build_object('success', true, 'inbound_order_id', v_inbound_id, 'inbound_no', v_inbound_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;


/* 登记台账 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260915_e_inbound_deduct_guard.sql')
ON CONFLICT DO NOTHING;
