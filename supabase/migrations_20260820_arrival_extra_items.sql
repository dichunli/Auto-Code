/* 到货单"采购单外货品"录入（2026-08-20 三期遗留项）
 *
 * 场景：供应商错发/多发了采购单上没有的货（比如订机油滤发了空气滤、多塞了两瓶清洗剂），
 * 建到货单时拉不到（没有采购行），需要现场手工补录一条到货明细。
 *
 * 设计：
 *   - add_arrival_extra_item：补录一条"已处理"的采购单外明细（purchase_order_item_id 为空）
 *     处理方式四选一：错发退回 wrong_discard / 多发退回 excess_return /
 *                    折价留下 excess_paid / 免费留下 excess_free
 *     退回类不入库（现场确认到货时本就不给 wrong/excess_return 加库存）；
 *     留下类必须关联配件档案（part_id），确认到货时按实收数入库存
 *   - delete_arrival_extra_item：验货中可删除补录错的行（仅限采购单外行，
 *     有采购行的撤销走 revoke_purchase_receipt）
 *   - 采购单外货品不生成 supplier_return_records（该表 work_order_item_part_id 非空），
 *     现场拒收直接退回供应商，到货明细行本身就是留痕
*/

/* ============================================================
   一、补录采购单外货品
   ============================================================ */
CREATE OR REPLACE FUNCTION public.add_arrival_extra_item(
  p_arrival_id UUID,
  p_part_name TEXT,
  p_part_id UUID,
  p_received_qty INTEGER,
  p_handling TEXT,
  p_warehouse_id UUID,
  p_location TEXT,
  p_photos JSONB
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt RECORD;
  v_item_id UUID;
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
    RETURN jsonb_build_object('success', false, 'error', '到货单已确认，不能再补录');
  END IF;

  IF p_handling NOT IN ('wrong_discard', 'excess_return', 'excess_paid', 'excess_free') THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的处理方式');
  END IF;
  IF p_received_qty IS NULL OR p_received_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '数量必须大于 0');
  END IF;
  IF p_part_name IS NULL OR TRIM(p_part_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', '请填写货品名称');
  END IF;
  /* 留下=要入库，必须有配件档案 */
  IF p_handling IN ('excess_paid', 'excess_free') AND p_part_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '留下的货品必须关联配件档案才能入库');
  END IF;
  IF p_part_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM parts WHERE id = p_part_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '配件档案不存在');
  END IF;

  INSERT INTO arrival_receipt_items (
    arrival_id, purchase_order_item_id, part_id, part_name_snapshot,
    expected_qty, received_qty, handling, warehouse_id, location, photos
  ) VALUES (
    p_arrival_id, NULL, p_part_id, TRIM(p_part_name),
    0, p_received_qty, p_handling, p_warehouse_id,
    NULLIF(TRIM(COALESCE(p_location, '')), ''),
    p_photos
  )
  RETURNING id INTO v_item_id;

  RETURN jsonb_build_object('success', true, 'item_id', v_item_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   二、删除补录错的采购单外行（仅验货中、仅限无采购行的明细）
   ============================================================ */
CREATE OR REPLACE FUNCTION public.delete_arrival_extra_item(p_arrival_item_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_item FROM arrival_receipt_items WHERE id = p_arrival_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '到货明细不存在');
  END IF;
  IF v_item.purchase_order_item_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '有采购行的明细请用撤销，不能删除');
  END IF;

  SELECT status INTO v_status FROM arrival_receipts WHERE id = v_item.arrival_id;
  IF v_status <> 'receiving' THEN
    RETURN jsonb_build_object('success', false, 'error', '到货单已确认，不能删除');
  END IF;

  DELETE FROM arrival_receipt_items WHERE id = p_arrival_item_id;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.add_arrival_extra_item(uuid, text, uuid, integer, text, uuid, text, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_arrival_extra_item(uuid) FROM anon, PUBLIC;

/* ============================================================
   三、confirm_arrival_receipt / complete_arrival_inbound 回写：
   单价取数加配件档案兜底——采购行不存在时（采购单外货品）用 parts.purchase_price，
   否则"折价留下"的采购外货品会以 0 成本入库、0 应付款
   函数体与 migrations_20260820_arrival_settlement.sql 版一致，仅单价那行加兜底
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

CREATE OR REPLACE FUNCTION public.complete_arrival_inbound(
  p_arrival_id UUID,
  p_freight_amount DECIMAL,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt RECORD;
  v_item RECORD;
  v_poi RECORD;
  v_inbound_id UUID;
  v_inbound_no TEXT;
  v_supplier_name TEXT;
  v_stock_qty INTEGER;
  v_unit_cost DECIMAL(12,2);
  v_total_qty INTEGER := 0;
  v_total_amount DECIMAL(12,2) := 0;
  v_goods_amount DECIMAL(12,2) := 0;
  v_per_unit_freight DECIMAL := 0;
  v_alloc DECIMAL(10,2);
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
  IF v_receipt.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error', '到货单当前状态不允许入库（需先确认到货）');
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_receipt.supplier_id;

  /* 1. 先算总数量（运费分摊基数；口径与确认到货一致） */
  SELECT COALESCE(SUM(
    CASE ai.handling
      WHEN 'normal'           THEN COALESCE(ai.received_qty, 0)
      WHEN 'short_repurchase' THEN COALESCE(ai.received_qty, 0)
      WHEN 'short_discard'    THEN COALESCE(ai.received_qty, 0)
      WHEN 'excess_return'    THEN LEAST(COALESCE(ai.received_qty, 0), ai.expected_qty)
      WHEN 'excess_paid'      THEN COALESCE(ai.received_qty, 0)
      WHEN 'excess_free'      THEN COALESCE(ai.received_qty, 0)
      ELSE 0 END
  ), 0) INTO v_total_qty
  FROM arrival_receipt_items ai
  WHERE ai.arrival_id = p_arrival_id AND ai.handling <> 'skipped';
  IF v_total_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '本到货单没有可入库的数量');
  END IF;
  v_per_unit_freight := COALESCE(p_freight_amount, 0) / v_total_qty;

  /* 2. 入库单主表（单号由触发器生成；purchase_order_id 为空，来源记 arrival_id） */
  INSERT INTO inbound_orders (
    purchase_order_id, arrival_id, supplier_id, supplier_name,
    total_quantity, total_amount, freight_amount,
    waybill_id, status, notes, operator_id
  ) VALUES (
    NULL, p_arrival_id, v_receipt.supplier_id, COALESCE(v_supplier_name, ''),
    0, 0, COALESCE(p_freight_amount, 0),
    v_receipt.waybill_id, 'completed', '到货单 ' || v_receipt.receipt_no, p_operator_id
  )
  RETURNING id, inbound_no INTO v_inbound_id, v_inbound_no;

  /* 3. 逐行写入库明细（只记账，不动库存） */
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

    v_alloc := ROUND(v_per_unit_freight * v_stock_qty, 2);
    v_total_amount := v_total_amount + v_stock_qty * v_unit_cost + v_alloc;
    /* 货款单独累计：供应商应付款只认货款，运费是和物流公司结算的(三期修正) */
    v_goods_amount := v_goods_amount + v_stock_qty * v_unit_cost;

    INSERT INTO inbound_order_items (
      inbound_order_id, purchase_order_item_id, part_id,
      part_number, name, brand, specification, unit,
      quantity, unit_cost, allocated_cost,
      batch_no, warehouse_id, location, notes
    ) VALUES (
      v_inbound_id, v_item.purchase_order_item_id, v_item.part_id,
      v_poi.part_number, COALESCE(v_poi.name, v_item.part_name_snapshot), v_poi.brand, v_poi.specification, v_poi.unit,
      v_stock_qty, v_unit_cost, v_alloc,
      NULL, v_item.warehouse_id, v_item.location, NULL
    );
  END LOOP;

  /* 4. 回填入库单合计 */
  UPDATE inbound_orders SET total_quantity = v_total_qty, total_amount = v_total_amount
  WHERE id = v_inbound_id;

  /* 5. 应付款：只算货款（运费单独和物流公司结算，不进供应商账） */
  IF v_receipt.supplier_id IS NOT NULL AND v_goods_amount > 0 THEN
    INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_receipt.supplier_id, 'debit', ROUND(v_goods_amount, 2),
            '采购入库(到货单 ' || v_receipt.receipt_no || ')', v_inbound_id, 'inbound_order');
  END IF;

  /* 6. 涉及采购单：全部行已处理完（pending_storage）的转已完成 */
  UPDATE purchase_orders SET status = 'completed'
  WHERE id IN (
    SELECT DISTINCT poi.order_id
    FROM arrival_receipt_items ai
    JOIN purchase_order_items poi ON poi.id = ai.purchase_order_item_id
    WHERE ai.arrival_id = p_arrival_id AND poi.order_id IS NOT NULL
  )
  AND status = 'pending_storage';

  /* 7. 到货单转已入库 */
  UPDATE arrival_receipts SET status = 'inbounded' WHERE id = p_arrival_id;

  RETURN jsonb_build_object('success', true, 'inbound_order_id', v_inbound_id, 'inbound_no', v_inbound_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 两个新函数带门禁:
      SELECT proname FROM pg_proc
      WHERE proname IN ('add_arrival_extra_item','delete_arrival_extra_item')
        AND pg_get_functiondef(oid) LIKE '%权限门禁%';
      应返回 2 行。
   2. 两个入库函数带配件档案兜底:
      SELECT proname FROM pg_proc
      WHERE proname IN ('confirm_arrival_receipt','complete_arrival_inbound')
        AND pg_get_functiondef(oid) LIKE '%purchase_price FROM parts%';
      应返回 2 行。
*/

