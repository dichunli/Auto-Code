/* ============================================================
   修复：confirm_arrival_receipt 补回档案价兜底（2026-08-21）
   ------------------------------------------------------------
   问题：数据库里当前生效的是 8月20日 17:26 的中间版，
   丢了 18:35 最新版的配件档案价兜底——
   现场补录的采购单外货品（错发/多发留下）入库价会记成 0，库存成本失真。
   本文件内容 = migrations_20260820_arrival_extra_items.sql 里的最新版函数原文，
   CREATE OR REPLACE 直接覆盖旧版，安全幂等，不影响任何已有数据。
   用法：Supabase 后台 → SQL Editor → 粘贴全部 → Run
   跑完把最下面【修复后验证】的结果发我（应返回 true）。
   ============================================================ */

CREATE OR REPLACE FUNCTION public.confirm_arrival_receipt(p_arrival_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt RECORD;
  v_item RECORD;
  v_poi RECORD;
  v_supplier_name TEXT;
  v_stock_qty INTEGER;
  v_unit_cost DECIMAL(12,2);
  v_before_qty INTEGER;
  v_after_qty INTEGER;
  v_loc TEXT;
  v_handled INTEGER;
  v_tracking TEXT;
  v_cod DECIMAL(12,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_receipt FROM arrival_receipts WHERE id = p_arrival_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '到货单不存在');
  END IF;
  IF v_receipt.status <> 'receiving' THEN
    RETURN jsonb_build_object('success', false, 'error', '到货单已确认，请勿重复操作');
  END IF;

  SELECT COUNT(*) INTO v_handled FROM arrival_receipt_items
  WHERE arrival_id = p_arrival_id AND handling IS NOT NULL;
  IF v_handled = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '尚未处理任何明细，不能确认');
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_receipt.supplier_id;

  /* 1. 未处理的置 skipped（释放采购行，下次到货可再拉） */
  UPDATE arrival_receipt_items SET handling = 'skipped'
  WHERE arrival_id = p_arrival_id AND handling IS NULL;

  /* 2. 逐行实物上架 */
  FOR v_item IN
    SELECT * FROM arrival_receipt_items
    WHERE arrival_id = p_arrival_id AND handling <> 'skipped'
  LOOP
    v_stock_qty := CASE v_item.handling
      WHEN 'normal'           THEN COALESCE(v_item.received_qty, 0)
      WHEN 'short_repurchase' THEN COALESCE(v_item.received_qty, 0)
      WHEN 'short_discard'    THEN COALESCE(v_item.received_qty, 0)
      WHEN 'excess_return'    THEN LEAST(COALESCE(v_item.received_qty, 0), v_item.expected_qty)
      WHEN 'excess_paid'      THEN COALESCE(v_item.received_qty, 0)
      WHEN 'excess_free'      THEN COALESCE(v_item.received_qty, 0)
      ELSE 0 END;
    IF v_stock_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM purchase_order_items WHERE id = v_item.purchase_order_item_id;
    /* 单价口径：免费留下零价；采购行没有时(采购单外货品)用配件档案最近采购价兜底 */
    v_unit_cost := CASE WHEN v_item.handling = 'excess_free' THEN 0
                        ELSE COALESCE(v_poi.unit_cost,
                                      (SELECT purchase_price FROM parts WHERE id = v_item.part_id),
                                      0) END;

    IF v_item.part_id IS NULL THEN CONTINUE; END IF;

    IF v_unit_cost > 0 THEN
      UPDATE parts SET quantity = quantity + v_stock_qty, purchase_price = v_unit_cost
      WHERE id = v_item.part_id
      RETURNING quantity INTO v_after_qty;
    ELSE
      UPDATE parts SET quantity = quantity + v_stock_qty
      WHERE id = v_item.part_id
      RETURNING quantity INTO v_after_qty;
    END IF;
    v_before_qty := v_after_qty - v_stock_qty;

    IF v_item.warehouse_id IS NOT NULL THEN
      v_loc := COALESCE(v_item.location, '');
      UPDATE part_stock_locations SET quantity = quantity + v_stock_qty
      WHERE part_id = v_item.part_id AND warehouse_id = v_item.warehouse_id
        AND COALESCE(location, '') = v_loc;
      IF NOT FOUND THEN
        INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity)
        VALUES (v_item.part_id, v_item.warehouse_id, v_loc, v_stock_qty);
      END IF;
    END IF;

    INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id, inbound_type, reference_id, notes)
    VALUES (v_item.part_id, NULL, v_stock_qty, v_stock_qty, v_unit_cost, v_receipt.supplier_id,
            'purchase', p_arrival_id, '到货确认: ' || v_receipt.receipt_no);

    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, waybill_id, operator_id, notes)
    VALUES (v_item.part_id, 'inbound', v_stock_qty, v_before_qty, v_after_qty,
            'arrival_receipt', p_arrival_id, v_receipt.waybill_id, auth.uid(),
            '到货确认入库: ' || COALESCE(v_item.part_name_snapshot, ''));
  END LOOP;

  /* 3. 工单配件标已到货（急件直领）：仅限实物入库的行 */
  UPDATE work_order_item_parts SET is_arrived = true
  WHERE id IN (
    SELECT poi.work_order_item_part_id
    FROM arrival_receipt_items ai
    JOIN purchase_order_items poi ON poi.id = ai.purchase_order_item_id
    WHERE ai.arrival_id = p_arrival_id
      AND ai.handling IN ('normal','excess_paid','excess_free','short_repurchase','short_discard')
      AND COALESCE(ai.received_qty, 0) > 0
      AND poi.work_order_item_part_id IS NOT NULL
  );

  /* 4. 破损/错发/多发生成待退货记录（口径同老入库函数；采购单外行 join 不到自动排除） */
  INSERT INTO supplier_return_records (work_order_item_part_id, return_reason, quantity, supplier_name, photos, status)
  SELECT
    poi.work_order_item_part_id,
    CASE ai.handling
      WHEN 'broken_exchange' THEN 'damaged'
      WHEN 'broken_discard'  THEN 'damaged'
      WHEN 'wrong_exchange'  THEN 'wrong_ship'
      WHEN 'wrong_discard'   THEN 'wrong_ship'
      WHEN 'excess_return'   THEN 'excess'
    END,
    CASE WHEN ai.handling = 'excess_return'
         THEN GREATEST(0, COALESCE(ai.received_qty, 0) - ai.expected_qty)
         ELSE ai.expected_qty END,
    COALESCE(v_supplier_name, ''),
    (SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(ai.photos, '[]'::JSONB)))),
    'pending'
  FROM arrival_receipt_items ai
  JOIN purchase_order_items poi ON poi.id = ai.purchase_order_item_id
  WHERE ai.arrival_id = p_arrival_id
    AND ai.handling IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard','excess_return')
    AND poi.work_order_item_part_id IS NOT NULL
    AND CASE WHEN ai.handling = 'excess_return'
             THEN GREATEST(0, COALESCE(ai.received_qty, 0) - ai.expected_qty)
             ELSE ai.expected_qty END > 0;

  /* 5. 到货单转 confirmed；运单标记已签收 */
  UPDATE arrival_receipts SET status = 'confirmed', confirmed_at = NOW() WHERE id = p_arrival_id;
  IF v_receipt.waybill_id IS NOT NULL THEN
    UPDATE logistics_waybills SET status = 'received', received_at = NOW()
    WHERE id = v_receipt.waybill_id;
  END IF;

  /* 6. 代收货款勾稽(三期):运单有代收金额 → 取货时已付给货运站(其转付供应商),
     自动记一笔 payment 冲减应付款;一张运单只记一次(分批到货/混用流程都不重复) */
  IF v_receipt.waybill_id IS NOT NULL THEN
    SELECT tracking_no, COALESCE(cod_amount, 0) INTO v_tracking, v_cod
    FROM logistics_waybills WHERE id = v_receipt.waybill_id;
    IF COALESCE(v_cod, 0) > 0 AND NOT EXISTS (
      SELECT 1 FROM supplier_transactions
      WHERE reference_id = v_receipt.waybill_id AND reference_type = 'logistics_waybill'
    ) THEN
      INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type, created_by)
      VALUES (v_receipt.supplier_id, 'payment', v_cod,
              '物流代收货款(运单 ' || COALESCE(v_tracking, '') || ')',
              v_receipt.waybill_id, 'logistics_waybill', auth.uid());
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'receipt_no', v_receipt.receipt_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* 【修复后验证】期望返回 true： */
SELECT pg_get_functiondef('confirm_arrival_receipt(uuid)'::regprocedure) LIKE '%purchase_price FROM parts%' AS 修复成功_有档案价兜底;
