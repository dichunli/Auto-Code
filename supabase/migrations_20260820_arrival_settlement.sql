/* 到货单参与供应商对账 + 代收/运费勾稽（待收货改造三期，2026-08-20）
 *
 * 拍板决策（2026-08-20 与用户确认）：
 *   1. 代收款 = 纯货款：取货时付给货运站，货运站全额转给供应商
 *      → 确认到货（运单签收）时自动记一笔 supplier_transactions.payment（已付款），
 *        对账余额 = 应付(debit) − 已付(payment) 自动勾稽，不用手工录
 *   2. 运费是物流公司的款项，和供应商没关系，单独和物流公司结算
 *      → 入库事务的供应商应付款(debit)不再包含运费分摊（此前含运费是错的，本期修正）；
 *        运费仍摊入配件成本（allocated_cost，成本核算需要），只是不进供应商账
 *      → logistics_waybills 加 freight_settled 标记，物流页可结清运费
 *   3. 一张运单的代收款只记一次（同运单分批到货/老新流程混用都不重复）
 *
 * 存量说明：supplier_transactions 生产库此前仅 1 条 payment 测试记录、无 debit 记录，
 * 本修正只影响今后新写入的账，无需清洗历史。
 *
 * 函数回写清单（均为含门禁完整定义，签名与线上一致）：
 *   confirm_arrival_receipt   加：运单有代收金额 → 自动记 payment（防重）
 *   complete_arrival_inbound  改：供应商 debit 只算货款，剔除运费分摊；摘要带到货单号
 *   complete_purchase_inbound 改：供应商 debit 只算货款，剔除运费分摊（含二期防双流程段）
*/

/* ============================================================
   一、运单加运费结算标记（单独和物流公司结算）
   ============================================================ */
ALTER TABLE public.logistics_waybills ADD COLUMN IF NOT EXISTS freight_settled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.logistics_waybills ADD COLUMN IF NOT EXISTS freight_settled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_waybills_freight_unsettled ON public.logistics_waybills(freight_settled) WHERE NOT freight_settled;

/* ============================================================
   二、confirm_arrival_receipt：确认到货时自动勾稽代收货款
   函数体与 20260820 二期版一致，新增末尾"代收货款"段
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
    v_unit_cost := CASE WHEN v_item.handling = 'excess_free' THEN 0
                        ELSE COALESCE(v_poi.unit_cost, 0) END;

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

  /* 4. 破损/错发/多发生成待退货记录（口径同老入库函数） */
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

/* ============================================================
   三、complete_arrival_inbound：供应商应付款只算货款（剔除运费分摊）
   函数体与二期版一致，差异：新增 v_goods_amount 累计货款，debit 改用它
   ============================================================ */
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
    v_unit_cost := CASE WHEN v_item.handling = 'excess_free' THEN 0
                        ELSE COALESCE(v_poi.unit_cost, 0) END;

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
   四、complete_purchase_inbound：老流程同样剔除运费进应付款
   函数体与 20260820 二期加固版一致（含防双流程段），
   差异：新增 v_goods_amount 累计货款，第 7 步 debit 改用它
   ============================================================ */
CREATE OR REPLACE FUNCTION public.complete_purchase_inbound(
  p_purchase_order_id UUID,
  p_items JSONB,
  p_freight_amount DECIMAL,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item JSONB;
  v_poi RECORD;
  v_inbound_id UUID;
  v_inbound_no TEXT;
  v_qty INTEGER;
  v_total_qty INTEGER := 0;
  v_total_amount DECIMAL(12,2) := 0;
  v_goods_amount DECIMAL(12,2) := 0;
  v_per_unit_freight DECIMAL := 0;
  v_alloc DECIMAL(10,2);
  v_before_qty INTEGER;
  v_after_qty INTEGER;
  v_loc TEXT;
  v_ret RECORD;
  v_ret_qty INTEGER;
  v_supplier_name TEXT;
BEGIN
  /* 0. 必须已登录(SECURITY DEFINER 绕过 RLS,身份在此兜底) */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
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

  /* 1.5 防双流程(2026-08-20 二期):走过到货确认单的采购单必须从没到货单入库 */
  IF EXISTS (
    SELECT 1 FROM purchase_order_items
    WHERE order_id = p_purchase_order_id AND arrival_item_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '该采购单已走到货确认单流程，请从到货单办理入库');
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_order.supplier_id;

  /* 2. 先算总数量(不含多发退货行),用于运费分摊 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty > 0 THEN v_total_qty := v_total_qty + v_qty; END IF;
  END LOOP;
  IF v_total_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '入库数量必须大于 0');
  END IF;
  v_per_unit_freight := COALESCE(p_freight_amount, 0) / v_total_qty;

  /* 3. 创建入库单主表(单号由触发器生成) */
  INSERT INTO inbound_orders (
    purchase_order_id, supplier_id, supplier_name,
    total_quantity, total_amount, freight_amount,
    waybill_id, status, notes, operator_id
  ) VALUES (
    p_purchase_order_id, v_order.supplier_id, COALESCE(v_supplier_name, ''),
    0, 0, COALESCE(p_freight_amount, 0),
    v_order.waybill_id, 'completed', '', p_operator_id
  )
  RETURNING id, inbound_no INTO v_inbound_id, v_inbound_no;

  /* 4. 逐条入库:明细 + 加库存 + 仓位 + 批次 + 流水 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    /* 以服务端采购明细为准取快照字段与单价,不信客户端 */
    SELECT * INTO v_poi FROM purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
      AND order_id = p_purchase_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '采购明细 % 不属于本采购单', v_item->>'purchase_order_item_id';
    END IF;

    v_alloc := ROUND(v_per_unit_freight * v_qty, 2);
    v_total_amount := v_total_amount + v_qty * COALESCE(v_poi.unit_cost, 0) + v_alloc;
    /* 货款单独累计：供应商应付款只认货款，运费是和物流公司结算的(三期修正) */
    v_goods_amount := v_goods_amount + v_qty * COALESCE(v_poi.unit_cost, 0);

    INSERT INTO inbound_order_items (
      inbound_order_id, purchase_order_item_id, part_id,
      part_number, name, brand, specification, unit,
      quantity, unit_cost, allocated_cost,
      batch_no, warehouse_id, location, notes
    ) VALUES (
      v_inbound_id, v_poi.id, v_poi.part_id,
      v_poi.part_number, v_poi.name, v_poi.brand, v_poi.specification, v_poi.unit,
      v_qty, v_poi.unit_cost, v_alloc,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      NULLIF(v_item->>'warehouse_id', '')::UUID,
      NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''),
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    );

    IF v_poi.part_id IS NULL THEN CONTINUE; END IF;

    /* 加库存:SQL 原子自增,并发安全;同时更新最近采购价 */
    UPDATE parts
    SET quantity = quantity + v_qty,
        purchase_price = COALESCE(v_poi.unit_cost, purchase_price)
    WHERE id = v_poi.part_id
    RETURNING quantity INTO v_after_qty;
    v_before_qty := v_after_qty - v_qty;

    /* 仓位库存:空仓位统一按空串口径匹配/存储,修复 NULL 与空串不一致导致的重复建行 */
    IF NULLIF(v_item->>'warehouse_id', '') IS NOT NULL THEN
      v_loc := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''), '');
      UPDATE part_stock_locations
      SET quantity = quantity + v_qty
      WHERE part_id = v_poi.part_id
        AND warehouse_id = (v_item->>'warehouse_id')::UUID
        AND COALESCE(location, '') = v_loc;
      IF NOT FOUND THEN
        INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity)
        VALUES (v_poi.part_id, (v_item->>'warehouse_id')::UUID, v_loc, v_qty);
      END IF;
    END IF;

    /* 批次 */
    INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id, inbound_type, reference_id, notes)
    VALUES (
      v_poi.part_id,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      v_qty, v_qty, v_poi.unit_cost, v_order.supplier_id,
      'purchase', p_purchase_order_id,
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    );

    /* 库存流水(补记操作人) */
    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, waybill_id, operator_id, notes)
    VALUES (
      v_poi.part_id, 'inbound', v_qty, v_before_qty, v_after_qty,
      'inbound_order', v_inbound_id, v_order.waybill_id, p_operator_id,
      '采购入库: ' || COALESCE(v_poi.name, '') ||
        CASE WHEN NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), '') IS NOT NULL
             THEN ' 批次:' || TRIM(v_item->>'batch_no') ELSE '' END
    );
  END LOOP;

  /* 5. 回填入库单合计 */
  UPDATE inbound_orders
  SET total_quantity = v_total_qty, total_amount = v_total_amount
  WHERE id = v_inbound_id;

  /* 6. 破损/错发/弃货类:退库减库存(excess_return 多出部分未入库,无需扣减) */
  FOR v_ret IN
    SELECT * FROM purchase_order_items
    WHERE order_id = p_purchase_order_id
      AND handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard')
  LOOP
    v_ret_qty := v_ret.quantity;
    IF v_ret.part_id IS NOT NULL AND v_ret_qty > 0 THEN
      UPDATE parts SET quantity = GREATEST(0, quantity - v_ret_qty)
      WHERE id = v_ret.part_id;
    END IF;
  END LOOP;

  /* 7. 应付款：只算货款（运费单独和物流公司结算，不进供应商账——三期修正） */
  IF v_order.supplier_id IS NOT NULL AND v_goods_amount > 0 THEN
    INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_order.supplier_id, 'debit', ROUND(v_goods_amount, 2), '采购入库', v_inbound_id, 'inbound_order');
  END IF;

  /* 8. 采购单状态 → 已完成 */
  UPDATE purchase_orders SET status = 'completed' WHERE id = p_purchase_order_id;

  /* 8.5 关联工单配件行标记已到货
     货已入库上架,配件流程状态机从「待收货」推进到「待入库/待领料」(partWorkflow 依赖 is_arrived) */
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
    /* evidence_photos 是 JSONB,photos 是 TEXT[],需逐元素转换 */
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

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 运单加列成功:
      SELECT column_name FROM information_schema.columns
      WHERE table_name='logistics_waybills' AND column_name LIKE 'freight_settled%';
      应返回 2 行。
   2. 代收货款勾稽段存在:
      SELECT proname FROM pg_proc
      WHERE proname='confirm_arrival_receipt'
        AND pg_get_functiondef(oid) LIKE '%代收货款勾稽%';
      应返回 1 行。
   3. 两个入库函数都已剔除运费进应付款:
      SELECT proname FROM pg_proc
      WHERE proname IN ('complete_arrival_inbound','complete_purchase_inbound')
        AND pg_get_functiondef(oid) LIKE '%v_goods_amount%';
      应返回 2 行。
*/
