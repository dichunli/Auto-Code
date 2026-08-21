/* 按供应商销售单执行入库 —— 成本核算改造（2026-08-21）
 *
 * 拍板规则（2026-08-21 与用户确认）：
 *   1. 入库拦截校验：Σ(每行入库单价×数量) − 优惠抹零 = 供应商销售单总金额，
 *      不平则拒绝入库；抹零=减项（供应商少收的钱）
 *   2. 运费分摊：默认按行金额占比分摊；可手动指定某几行运费（大件低值商品），
 *      其余行按金额占比分摊剩余运费；赠品(excess_free)不参与自动分摊
 *   3. 价格体系（2026-08-21 用户澄清）：
 *      采购价 parts.purchase_price = 供应商销售单上的裸单价（入库单价）
 *      成本价 parts.cost_price     = 采购价 + 单位运费分摊（新增列）
 *      工单配件行 work_order_item_parts.cost_price（含均摊运费的成本价，5 月已建列但从未启用）
 *      入库时同步写入 → 单据毛利计算的基准价（用户拍板：成本价才是毛利参考价）
 *
 * 兼容原则：新增参数全部可空，老客户端（不传新参数）行为与现状一致：
 *   单价取采购明细价、运费按金额占比分摊（原按数量平分的口径就此废弃——用户拍板）、
 *   无销售单金额则不启用拦截校验。
 *
 * 表结构：
 *   purchase_orders   + supplier_order_no / supplier_order_amount / supplier_slip_photos
 *   arrival_receipts  + supplier_order_amount / supplier_slip_photos（supplier_order_no 二期已有）
 *   inbound_orders    + supplier_order_no / supplier_order_amount / discount_amount
 *   parts             + cost_price（成本价 = 采购价 + 分摊运费）
*/

/* ============================================================
   一、表结构
   ============================================================ */
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_order_no TEXT,
  ADD COLUMN IF NOT EXISTS supplier_order_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS supplier_slip_photos JSONB;

ALTER TABLE public.arrival_receipts
  ADD COLUMN IF NOT EXISTS supplier_order_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS supplier_slip_photos JSONB;

ALTER TABLE public.inbound_orders
  ADD COLUMN IF NOT EXISTS supplier_order_no TEXT,
  ADD COLUMN IF NOT EXISTS supplier_order_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2);

/* 配件档案加成本价：采购价(purchase_price) + 分摊运费 */
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10,2);

/* ============================================================
   二、complete_purchase_inbound 回写（老流程入库）
   p_items 每行新增可选字段：
     unit_cost      自定义入库价（对销售单改价），缺省取采购明细价
     freight_alloc  手动指定该行运费（大件低值），缺省参与按金额占比自动分摊
   ============================================================ */
CREATE OR REPLACE FUNCTION public.complete_purchase_inbound(
  p_purchase_order_id UUID,
  p_items JSONB,
  p_freight_amount DECIMAL,
  p_operator_id UUID,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_supplier_order_no TEXT DEFAULT NULL,
  p_supplier_order_amount DECIMAL DEFAULT NULL
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
  v_unit_cost DECIMAL(12,2);
  v_total_qty INTEGER := 0;
  v_total_amount DECIMAL(12,2) := 0;
  v_goods_amount DECIMAL(12,2) := 0;
  v_alloc DECIMAL(10,2);
  v_manual_freight DECIMAL(12,2) := 0;   /* 手动行运费合计 */
  v_auto_amount DECIMAL(12,2) := 0;      /* 参与自动分摊的行金额合计 */
  v_remain_freight DECIMAL(12,2) := 0;   /* 剩余待分摊运费 */
  v_line_amount DECIMAL(12,2);
  v_before_qty INTEGER;
  v_after_qty INTEGER;
  v_loc TEXT;
  v_ret RECORD;
  v_ret_qty INTEGER;
  v_supplier_name TEXT;
  v_payable DECIMAL(12,2);
BEGIN
  /* 0. 必须已登录(SECURITY DEFINER 绕过 RLS,身份在此兜底) */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:采购/供应商写操作仅 管理员/老板/仓管 可执行 */
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

  /* 2. 第一遍扫描：校验明细、累计货款/数量、分离手动运费行 */
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

  /* 3. 创建入库单主表(单号由触发器生成)；带供应商销售单信息 */
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

  /* 3.5 销售单号/金额回写采购单（收货时没填、入库时补录的场景） */
  IF NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), '') IS NOT NULL THEN
    UPDATE purchase_orders
    SET supplier_order_no = TRIM(p_supplier_order_no),
        supplier_order_amount = COALESCE(p_supplier_order_amount, supplier_order_amount)
    WHERE id = p_purchase_order_id;
  END IF;

  /* 4. 逐条入库:明细 + 加库存 + 仓位 + 批次 + 流水 */
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
      quantity, unit_cost, allocated_cost,
      batch_no, warehouse_id, location, notes
    ) VALUES (
      v_inbound_id, v_poi.id, v_poi.part_id,
      v_poi.part_number, v_poi.name, v_poi.brand, v_poi.specification, v_poi.unit,
      v_qty, v_unit_cost, v_alloc,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      NULLIF(v_item->>'warehouse_id', '')::UUID,
      NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''),
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    );

    IF v_poi.part_id IS NULL THEN CONTINUE; END IF;

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

    /* 仓位库存:空仓位统一按空串口径匹配/存储 */
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

    /* 批次（unit_cost 记裸入库价，分摊成本在 allocated_cost/配件档案） */
    INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id, inbound_type, reference_id, notes)
    VALUES (
      v_poi.part_id,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      v_qty, v_qty, v_unit_cost, v_order.supplier_id,
      'purchase', p_purchase_order_id,
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    );

    /* 库存流水 */
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

  /* 6. 破损/错发/弃货类:退库减库存 */
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

REVOKE EXECUTE ON FUNCTION public.complete_purchase_inbound(uuid, jsonb, numeric, uuid, numeric, text, numeric) FROM anon, PUBLIC;

/* ============================================================
   三、complete_arrival_inbound 回写（新流程到货单入库）
   p_price_overrides JSONB: [{arrival_item_id, unit_cost?, freight_alloc?}]
   ============================================================ */
CREATE OR REPLACE FUNCTION public.complete_arrival_inbound(
  p_arrival_id UUID,
  p_freight_amount DECIMAL,
  p_operator_id UUID,
  p_price_overrides JSONB DEFAULT '[]'::JSONB,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_supplier_order_amount DECIMAL DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt RECORD;
  v_item RECORD;
  v_poi RECORD;
  v_override JSONB;
  v_inbound_id UUID;
  v_inbound_no TEXT;
  v_supplier_name TEXT;
  v_stock_qty INTEGER;
  v_unit_cost DECIMAL(12,2);
  v_total_qty INTEGER := 0;
  v_total_amount DECIMAL(12,2) := 0;
  v_goods_amount DECIMAL(12,2) := 0;
  v_alloc DECIMAL(10,2);
  v_manual_freight DECIMAL(12,2) := 0;
  v_auto_amount DECIMAL(12,2) := 0;
  v_remain_freight DECIMAL(12,2) := 0;
  v_line_amount DECIMAL(12,2);
  v_payable DECIMAL(12,2);
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

  /* 1. 第一遍：累计货款/数量，分离手动运费行 */
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

    /* 价格覆盖：按到货明细 id 匹配 p_price_overrides */
    SELECT * INTO v_override FROM jsonb_array_elements(COALESCE(p_price_overrides, '[]'::JSONB)) o
    WHERE (o->>'arrival_item_id')::UUID = v_item.id LIMIT 1;

    v_unit_cost := CASE WHEN v_item.handling = 'excess_free' THEN 0
                        ELSE COALESCE((v_override->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0) END;
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION '入库单价不能为负（%）', COALESCE(v_poi.name, v_item.part_name_snapshot, '');
    END IF;

    v_line_amount := v_stock_qty * v_unit_cost;
    v_goods_amount := v_goods_amount + v_line_amount;
    v_total_qty := v_total_qty + v_stock_qty;

    IF v_override IS NOT NULL AND (v_override->>'freight_alloc') IS NOT NULL THEN
      v_manual_freight := v_manual_freight + COALESCE((v_override->>'freight_alloc')::DECIMAL, 0);
    ELSE
      v_auto_amount := v_auto_amount + v_line_amount;
    END IF;
  END LOOP;

  IF v_total_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '本到货单没有可入库的数量');
  END IF;

  /* 1.5 销售单拦截校验（金额以到货单已录的 supplier_order_amount 为准，参数可覆盖） */
  IF COALESCE(p_supplier_order_amount, v_receipt.supplier_order_amount) IS NOT NULL THEN
    IF ABS((v_goods_amount - COALESCE(p_discount_amount, 0))
           - COALESCE(p_supplier_order_amount, v_receipt.supplier_order_amount)) > 0.01 THEN
      RETURN jsonb_build_object('success', false, 'error',
        '入库货款合计 ¥' || ROUND(v_goods_amount, 2) ||
        ' − 抹零 ¥' || ROUND(COALESCE(p_discount_amount, 0), 2) ||
        ' ≠ 销售单总金额 ¥' || ROUND(COALESCE(p_supplier_order_amount, v_receipt.supplier_order_amount), 2) ||
        '，请逐行核对入库单价，或在「优惠抹零」填入差额');
    END IF;
  END IF;

  v_remain_freight := COALESCE(p_freight_amount, 0) - v_manual_freight;
  IF v_remain_freight < 0 THEN v_remain_freight := 0; END IF;

  /* 2. 入库单主表（带供应商销售单信息） */
  INSERT INTO inbound_orders (
    purchase_order_id, arrival_id, supplier_id, supplier_name,
    total_quantity, total_amount, freight_amount,
    waybill_id, status, notes, operator_id,
    supplier_order_no, supplier_order_amount, discount_amount
  ) VALUES (
    NULL, p_arrival_id, v_receipt.supplier_id, COALESCE(v_supplier_name, ''),
    0, 0, COALESCE(p_freight_amount, 0),
    v_receipt.waybill_id, 'completed', '到货单 ' || v_receipt.receipt_no, p_operator_id,
    v_receipt.supplier_order_no,
    COALESCE(p_supplier_order_amount, v_receipt.supplier_order_amount),
    COALESCE(p_discount_amount, 0)
  )
  RETURNING id, inbound_no INTO v_inbound_id, v_inbound_no;

  /* 3. 逐行写入库明细（只记账，库存在确认到货时已上架） */
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
    SELECT * INTO v_override FROM jsonb_array_elements(COALESCE(p_price_overrides, '[]'::JSONB)) o
    WHERE (o->>'arrival_item_id')::UUID = v_item.id LIMIT 1;

    v_unit_cost := CASE WHEN v_item.handling = 'excess_free' THEN 0
                        ELSE COALESCE((v_override->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0) END;

    IF v_override IS NOT NULL AND (v_override->>'freight_alloc') IS NOT NULL THEN
      v_alloc := ROUND(COALESCE((v_override->>'freight_alloc')::DECIMAL, 0), 2);
    ELSIF v_auto_amount > 0 THEN
      v_alloc := ROUND(v_remain_freight * (v_stock_qty * v_unit_cost) / v_auto_amount, 2);
    ELSE
      v_alloc := 0;
    END IF;

    v_total_amount := v_total_amount + v_stock_qty * v_unit_cost + v_alloc;

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

    /* 更正价格（确认到货时已按采购明细价写过 purchase_price）：
       purchase_price = 实际入库裸价；cost_price = 裸价 + 单位运费分摊 */
    IF v_item.part_id IS NOT NULL AND v_stock_qty > 0 THEN
      UPDATE parts SET purchase_price = v_unit_cost,
                      cost_price = v_unit_cost + ROUND(v_alloc / v_stock_qty, 2)
      WHERE id = v_item.part_id;
    END IF;

    /* 工单配件行成本价同步（毛利计算基准） */
    IF v_poi.work_order_item_part_id IS NOT NULL AND v_stock_qty > 0 THEN
      UPDATE work_order_item_parts
      SET cost_price = v_unit_cost + ROUND(v_alloc / v_stock_qty, 2)
      WHERE id = v_poi.work_order_item_part_id;
    END IF;
  END LOOP;

  /* 4. 回填入库单合计 */
  UPDATE inbound_orders SET total_quantity = v_total_qty, total_amount = v_total_amount
  WHERE id = v_inbound_id;

  /* 5. 应付款 = 货款 − 抹零（=销售单总金额）；运费不进供应商账 */
  v_payable := v_goods_amount - COALESCE(p_discount_amount, 0);
  IF v_receipt.supplier_id IS NOT NULL AND v_payable > 0 THEN
    INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_receipt.supplier_id, 'debit', ROUND(v_payable, 2),
            '采购入库(到货单 ' || v_receipt.receipt_no ||
              CASE WHEN v_receipt.supplier_order_no IS NOT NULL AND TRIM(v_receipt.supplier_order_no) <> ''
                   THEN ' 销售单 ' || TRIM(v_receipt.supplier_order_no) ELSE '' END || ')',
            v_inbound_id, 'inbound_order');
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

REVOKE EXECUTE ON FUNCTION public.complete_arrival_inbound(uuid, numeric, uuid, jsonb, numeric, numeric) FROM anon, PUBLIC;

/* ============================================================
   验证方法（执行完本脚本后跑）：
   1. 三表新列：
      SELECT table_name, column_name FROM information_schema.columns
      WHERE column_name IN ('supplier_order_no','supplier_order_amount','supplier_slip_photos','discount_amount')
        AND table_name IN ('purchase_orders','arrival_receipts','inbound_orders');
      应返回 7 行。
   2. 两个入库函数含拦截校验段：
      SELECT proname FROM pg_proc
      WHERE proname IN ('complete_purchase_inbound','complete_arrival_inbound')
        AND pg_get_functiondef(oid) LIKE '%销售单拦截校验%';
      应返回 2 行。
   ============================================================
*/
