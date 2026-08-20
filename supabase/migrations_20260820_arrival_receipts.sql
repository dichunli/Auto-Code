/* 到货确认单（待收货改造二期，2026-08-20）
 *
 * 依据《待收货改造规划-2026-08.md》二期：待收货从"按采购单收货"升级为"运单→到货确认单"工作台。
 *
 * 新建两张表：
 *   arrival_receipts       到货确认单（一次到货一个批次，可关联运单，可录供应商销售单号+截图）
 *   arrival_receipt_items  到货明细（逐件实收数量/差异处理/收货时定仓位/货物照片）
 * 老表加列：
 *   purchase_order_items.arrival_item_id  该行由哪条到货明细收的（留痕+防双流程）
 *   inbound_orders.arrival_id             入库单来源到货单（新流程）
 *
 * 四个新函数：
 *   create_arrival_receipt    选供应商建到货单，自动拉入其在途采购行
 *   handle_arrival_item       逐行收货处理（事务内调用 receive_purchase_item，异常分支逻辑不重写）
 *   confirm_arrival_receipt   确认到货：加库存+工单配件标已到货（急件直领）+生成待退货记录
 *   complete_arrival_inbound  确认入库：纯账务收尾（入库单/应付款/运费分摊/状态推进），不再动库存
 * 两个老函数加固（完整定义回写，含 0819 门禁段）：
 *   complete_purchase_inbound  采购单行已有 arrival_item_id 的拒绝按老路径入库（防双流程重复入库）
 *   revoke_purchase_receipt    到货单已确认/入库的明细禁止撤销；验货中则同步复位到货明细
 *
 * 与规划文档的两处有意偏差（实施时发现，理由如下）：
 *   1. 库存在"确认到货"时就加上，而不是等"确认入库"。
 *      原因：领料出库由触发器 fn_deduct_batch_on_picking 扣批次库存，库存不足整单回滚——
 *      若确认到货时不加库存，急件直领在确认入库前根本领不了（批次都不存在），规划目标落空。
 *      改为：确认到货=实物上架（库存+批次+流水）；确认入库=纯账务收尾（应付款/运费分摊/单据）。
 *      每个时点账实都平衡，直领无需改领料触发器。
 *   2. 待退货记录在"确认到货"时生成（现场拒收立即可退），而不是等入库。
 *
 * 存量兼容：已有老路径处理记录（handle_action 非空且 arrival_item_id 为空）的采购单
 * 不会被拉入到货单（走老路径收完为止）；一旦走过到货单，老入库函数拒绝执行。
*/

/* ============================================================
   一、新表：到货确认单
   ============================================================ */
CREATE TABLE IF NOT EXISTS public.arrival_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no TEXT NOT NULL UNIQUE,             /* DH-日期-序号 */
  waybill_id UUID REFERENCES public.logistics_waybills(id),  /* 本地供货可空 */
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id),
  supplier_order_no TEXT,                      /* 供应商销售单号（可后补） */
  photos JSONB,                                /* 销售单照片/微信截图（可后补） */
  status TEXT NOT NULL DEFAULT 'receiving',    /* receiving 验货中 / confirmed 已确认 / inbounded 已入库 */
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_arrival_receipts_supplier ON public.arrival_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_arrival_receipts_status ON public.arrival_receipts(status);
CREATE INDEX IF NOT EXISTS idx_arrival_receipts_waybill ON public.arrival_receipts(waybill_id);

/* ============================================================
   二、新表：到货明细
   ============================================================ */
CREATE TABLE IF NOT EXISTS public.arrival_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arrival_id UUID NOT NULL REFERENCES public.arrival_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id UUID REFERENCES public.purchase_order_items(id),  /* 采购单上没有的货（错发/多发）为空 */
  part_id UUID REFERENCES public.parts(id),
  part_name_snapshot TEXT NOT NULL,            /* 配件名快照（防采购行后续变动） */
  expected_qty INTEGER NOT NULL,               /* 应收数量 */
  received_qty INTEGER,                        /* 实收数量（未处理为空） */
  handling TEXT,                               /* 复用 receive_purchase_item 十种动作码；确认时未处理的置 skipped */
  warehouse_id UUID REFERENCES public.warehouses(id),  /* 收货时定的仓库 */
  location TEXT,                               /* 收货时定的仓位（手填或扫码） */
  photos JSONB,                                /* 货物照片（破损取证等） */
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arrival_items_arrival ON public.arrival_receipt_items(arrival_id);
CREATE INDEX IF NOT EXISTS idx_arrival_items_poi ON public.arrival_receipt_items(purchase_order_item_id);

/* ============================================================
   三、老表加列
   ============================================================ */
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS arrival_item_id UUID;
CREATE INDEX IF NOT EXISTS idx_poi_arrival_item ON public.purchase_order_items(arrival_item_id);

ALTER TABLE public.inbound_orders ADD COLUMN IF NOT EXISTS arrival_id UUID;
CREATE INDEX IF NOT EXISTS idx_inbound_orders_arrival ON public.inbound_orders(arrival_id);

/* ============================================================
   四、RLS（与采购主表同级：登录用户可读写，写操作另由 RPC 内角色门禁兜底）
   ============================================================ */
ALTER TABLE public.arrival_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arrival_receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS arrival_receipts_select ON public.arrival_receipts;
DROP POLICY IF EXISTS arrival_receipts_insert ON public.arrival_receipts;
DROP POLICY IF EXISTS arrival_receipts_update ON public.arrival_receipts;
DROP POLICY IF EXISTS arrival_receipts_delete ON public.arrival_receipts;
DROP POLICY IF EXISTS arrival_receipt_items_select ON public.arrival_receipt_items;
DROP POLICY IF EXISTS arrival_receipt_items_insert ON public.arrival_receipt_items;
DROP POLICY IF EXISTS arrival_receipt_items_update ON public.arrival_receipt_items;
DROP POLICY IF EXISTS arrival_receipt_items_delete ON public.arrival_receipt_items;

CREATE POLICY arrival_receipts_select ON public.arrival_receipts FOR SELECT TO authenticated USING (true);
CREATE POLICY arrival_receipts_insert ON public.arrival_receipts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY arrival_receipts_update ON public.arrival_receipts FOR UPDATE TO authenticated USING (true);
CREATE POLICY arrival_receipts_delete ON public.arrival_receipts FOR DELETE TO authenticated USING (true);

CREATE POLICY arrival_receipt_items_select ON public.arrival_receipt_items FOR SELECT TO authenticated USING (true);
CREATE POLICY arrival_receipt_items_insert ON public.arrival_receipt_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY arrival_receipt_items_update ON public.arrival_receipt_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY arrival_receipt_items_delete ON public.arrival_receipt_items FOR DELETE TO authenticated USING (true);

/* ============================================================
   五、创建到货确认单：选供应商，自动拉入其在途采购行
   拉行规则：
     - 采购单状态在 submitted/approved/partial_received
     - 明细未处理（handle_action 为空）
     - 明细没有"未处理的"到货行（防重复拉入；确认时未处理的行置 skipped 后可再拉）
     - 采购单没有老路径处理记录（handle_action 非空且 arrival_item_id 为空）——存量单走老路径收完
   ============================================================ */
CREATE OR REPLACE FUNCTION public.create_arrival_receipt(
  p_waybill_id UUID,
  p_supplier_id UUID,
  p_supplier_order_no TEXT,
  p_photos JSONB
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_arrival_id UUID;
  v_receipt_no TEXT;
  v_date_str TEXT;
  v_seq INTEGER;
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;
  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择供应商');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '供应商不存在');
  END IF;

  /* 单号：当日序号，加咨询锁防并发重号 */
  v_date_str := to_char(NOW(), 'YYYYMMDD');
  PERFORM pg_advisory_xact_lock(hashtext('arrival_receipt_no_' || v_date_str));
  SELECT COUNT(*) + 1 INTO v_seq FROM arrival_receipts WHERE receipt_no LIKE 'DH-' || v_date_str || '-%';
  v_receipt_no := 'DH-' || v_date_str || '-' || lpad(v_seq::TEXT, 3, '0');

  INSERT INTO arrival_receipts (receipt_no, waybill_id, supplier_id, supplier_order_no, photos, status, created_by)
  VALUES (
    v_receipt_no, p_waybill_id, p_supplier_id,
    NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), ''),
    p_photos, 'receiving', auth.uid()
  )
  RETURNING id INTO v_arrival_id;

  /* 拉入该供应商所有可收的在途采购行 */
  INSERT INTO arrival_receipt_items (arrival_id, purchase_order_item_id, part_id, part_name_snapshot, expected_qty)
  SELECT v_arrival_id, poi.id, poi.part_id, poi.name, poi.quantity
  FROM purchase_order_items poi
  JOIN purchase_orders o ON o.id = poi.order_id
  WHERE o.supplier_id = p_supplier_id
    AND o.status IN ('submitted', 'approved', 'partial_received')
    AND poi.handle_action IS NULL
    /* 没被别的到货单以"未处理"状态占着 */
    AND NOT EXISTS (
      SELECT 1 FROM arrival_receipt_items ai
      WHERE ai.purchase_order_item_id = poi.id AND ai.handling IS NULL
    )
    /* 存量单（已有老路径处理记录）走老路径收完，不进到货单 */
    AND NOT EXISTS (
      SELECT 1 FROM purchase_order_items x
      WHERE x.order_id = poi.order_id AND x.handle_action IS NOT NULL AND x.arrival_item_id IS NULL
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION '该供应商没有可收货的在途采购行';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'arrival_id', v_arrival_id,
    'receipt_no', v_receipt_no,
    'item_count', v_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   六、逐行收货处理：记录到货明细 + 事务内调 receive_purchase_item（异常分支不重写）
   无采购行的货（purchase_order_item_id 为空，错发/多发）只记录，不调收货函数
   ============================================================ */
CREATE OR REPLACE FUNCTION public.handle_arrival_item(
  p_arrival_item_id UUID,
  p_handle_action TEXT,
  p_received_qty INTEGER,
  p_warehouse_id UUID,
  p_location TEXT,
  p_evidence_photos JSONB,
  p_set_evidence BOOLEAN
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_receipt RECORD;
  v_res JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
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

  /* 锁到货单（与 confirm 互斥，防确认瞬间还在改行） */
  SELECT ar.* INTO v_receipt
  FROM arrival_receipts ar
  JOIN arrival_receipt_items ai ON ai.arrival_id = ar.id
  WHERE ai.id = p_arrival_item_id
  FOR UPDATE OF ar;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '到货明细不存在');
  END IF;
  IF v_receipt.status <> 'receiving' THEN
    RETURN jsonb_build_object('success', false, 'error', '到货单已确认，不能再改');
  END IF;

  SELECT * INTO v_item FROM arrival_receipt_items WHERE id = p_arrival_item_id FOR UPDATE;

  /* 1. 更新到货明细 */
  UPDATE arrival_receipt_items
  SET received_qty = p_received_qty,
      handling = p_handle_action,
      warehouse_id = p_warehouse_id,
      location = NULLIF(TRIM(COALESCE(p_location, '')), ''),
      photos = CASE WHEN p_set_evidence
                    THEN COALESCE(p_evidence_photos, '[]'::JSONB)
                    ELSE photos END
  WHERE id = p_arrival_item_id;

  /* 2. 有采购行的 → 事务内调现有收货函数（10 种异常分支逻辑复用） */
  IF v_item.purchase_order_item_id IS NOT NULL THEN
    v_res := public.receive_purchase_item(
      (SELECT order_id FROM purchase_order_items WHERE id = v_item.purchase_order_item_id),
      v_item.purchase_order_item_id,
      p_handle_action,
      p_received_qty,
      p_evidence_photos,
      p_set_evidence,
      auth.uid()
    );
    IF NOT COALESCE((v_res->>'success')::BOOLEAN, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_res->>'error', '收货处理失败');
    END IF;
    /* 回链：该采购行由本到货明细收的（老入库函数据此拦截双流程） */
    UPDATE purchase_order_items SET arrival_item_id = p_arrival_item_id
    WHERE id = v_item.purchase_order_item_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   七、确认到货单（实物上架，一个事务）：
     1. 未处理的明细置 skipped（采购行释放，下次到货可再拉）
     2. 按行加库存 + 批次 + 仓位 + 流水（急件直领的前提：批次必须存在）
     3. 工单配件标已到货 → 技师立即可领
     4. 破损/错发/多发生成待退货记录（现场拒收立即可退）
     5. 到货单转 confirmed，运单标记已签收
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
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
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
    /* 入库数量口径：正常/少发=实收；多发退货=订购数（多出部分退）；多发留下=实收；破损/错发=不入库 */
    v_stock_qty := CASE v_item.handling
      WHEN 'normal'           THEN COALESCE(v_item.received_qty, 0)
      WHEN 'short_repurchase' THEN COALESCE(v_item.received_qty, 0)
      WHEN 'short_discard'    THEN COALESCE(v_item.received_qty, 0)
      WHEN 'excess_return'    THEN LEAST(COALESCE(v_item.received_qty, 0), v_item.expected_qty)
      WHEN 'excess_paid'      THEN COALESCE(v_item.received_qty, 0)
      WHEN 'excess_free'      THEN COALESCE(v_item.received_qty, 0)
      ELSE 0 END;
    IF v_stock_qty <= 0 THEN CONTINUE; END IF;

    /* 单价口径：免费留下零价入库，其余取采购行单价 */
    SELECT * INTO v_poi FROM purchase_order_items WHERE id = v_item.purchase_order_item_id;
    v_unit_cost := CASE WHEN v_item.handling = 'excess_free' THEN 0
                        ELSE COALESCE(v_poi.unit_cost, 0) END;

    IF v_item.part_id IS NULL THEN CONTINUE; END IF;

    /* 加总库存（原子自增），有单价时刷新最近采购价 */
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

    /* 仓位库存（收货时定了仓位才记；空仓位按空串口径） */
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

    /* 批次（领料触发器依赖批次存在，这是急件直领的关键） */
    INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id, inbound_type, reference_id, notes)
    VALUES (v_item.part_id, NULL, v_stock_qty, v_stock_qty, v_unit_cost, v_receipt.supplier_id,
            'purchase', p_arrival_id, '到货确认: ' || v_receipt.receipt_no);

    /* 库存流水 */
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

  RETURN jsonb_build_object('success', true, 'receipt_no', v_receipt.receipt_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   八、确认入库（纯账务收尾，不动库存——库存已在确认到货时上好）：
     入库单 + 明细 + 运费分摊 + 应付款 + 采购单/到货单状态推进
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
  v_per_unit_freight DECIMAL := 0;
  v_alloc DECIMAL(10,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
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

  /* 5. 应付款 */
  IF v_receipt.supplier_id IS NOT NULL AND v_total_amount > 0 THEN
    INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_receipt.supplier_id, 'debit', ROUND(v_total_amount, 2), '采购入库', v_inbound_id, 'inbound_order');
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
   九、老函数加固①：complete_purchase_inbound 防双流程
   函数体与 20260819 固化版逐字一致，唯一新增：采购单行已有 arrival_item_id
   （即走过到货确认单流程）时拒绝按老路径入库，防同一批货重复入库。
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

  /* 7. 应付款 */
  IF v_order.supplier_id IS NOT NULL AND v_total_amount > 0 THEN
    INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_order.supplier_id, 'debit', ROUND(v_total_amount, 2), '采购入库', v_inbound_id, 'inbound_order');
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
   十、老函数加固②：revoke_purchase_receipt 到货单联动
   函数体与线上版逐字一致，新增：
     - 明细走过到货单且到货单已确认/入库 → 禁止撤销（库存已上架，撤销会账实不符）
     - 到货单还在验货中 → 撤销时同步复位到货明细（可重新处理）
   ============================================================ */
CREATE OR REPLACE FUNCTION public.revoke_purchase_receipt(
  p_order_id UUID,
  p_item_id UUID
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
  v_ar_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
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

  /* 1.5 到货单联动(2026-08-20 二期) */
  IF v_item.arrival_item_id IS NOT NULL THEN
    SELECT ar.status INTO v_ar_status
    FROM arrival_receipt_items ai
    JOIN arrival_receipts ar ON ar.id = ai.arrival_id
    WHERE ai.id = v_item.arrival_item_id;
    IF v_ar_status IS NOT NULL AND v_ar_status <> 'receiving' THEN
      RETURN jsonb_build_object('success', false, 'error', '该明细的到货单已确认，库存已上架，不能撤销收货');
    END IF;
    /* 验货中 → 同步复位到货明细（可重新处理） */
    UPDATE arrival_receipt_items
    SET received_qty = NULL, handling = NULL, warehouse_id = NULL, location = NULL, photos = NULL
    WHERE id = v_item.arrival_item_id;
  END IF;

  UPDATE purchase_order_items
  SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL,
      arrival_item_id = NULL
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
   权限收尾：新函数默认 PUBLIC 可执行，回收 anon/PUBLIC
   （authenticated 保留 Supabase 默认授权；函数内另有登录+角色门禁双保险）
   ============================================================ */
REVOKE EXECUTE ON FUNCTION public.create_arrival_receipt(uuid, uuid, text, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_arrival_item(uuid, text, integer, uuid, text, jsonb, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_arrival_receipt(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_arrival_inbound(uuid, numeric, uuid) FROM anon, PUBLIC;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 两张新表存在且有 RLS:
      SELECT tablename, policyname FROM pg_policies
      WHERE tablename IN ('arrival_receipts','arrival_receipt_items');
      应返回 8 行。
   2. 老表加列成功:
      SELECT column_name FROM information_schema.columns
      WHERE table_name='purchase_order_items' AND column_name='arrival_item_id';
      SELECT column_name FROM information_schema.columns
      WHERE table_name='inbound_orders' AND column_name='arrival_id';
      各返回 1 行。
   3. 四个新函数都有门禁:
      SELECT proname FROM pg_proc
      WHERE proname IN ('create_arrival_receipt','handle_arrival_item',
                        'confirm_arrival_receipt','complete_arrival_inbound')
        AND pg_get_functiondef(oid) LIKE '%权限门禁%';
      应返回 4 行。
   4. 老函数加固生效:
      SELECT proname FROM pg_proc
      WHERE proname IN ('complete_purchase_inbound','revoke_purchase_receipt')
        AND pg_get_functiondef(oid) LIKE '%arrival_item_id%';
      应返回 2 行。
*/
