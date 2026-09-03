/* 跨采购单收货：暂存 + 手动提交 + 按收货批次入库（2026-09-04 用户拍板）
 *
 * 需求口径：
 *   · 同一供应商的多个采购单可跨单收货（对照供应商实际销售单逐件收）
 *   · 确认收货后先【暂存】（数据库持久化，关掉再开还在），不立即入账
 *   · 收完一批手动点「提交收货」→ 建收货批次，一次事务统一入账
 *   · 待入库页按【收货批次】呈现为一张清单，对着它一次入库
 *   · 不再新建到货确认单（老流程待收货页直接做）
 *
 * 数据模型：
 *   purchase_order_items 加暂存列（staged_*）+ receiving_batch_id（批次关联）
 *   receiving_batches 新表：一次手动提交 = 一个批次（携带供应商销售单号）
 *   inbound_orders 加 receiving_batch_id（入库单关联批次）
 *
 * 函数：
 *   stage_receiving_item     写暂存（收货弹窗确认时调）
 *   unstage_receiving_item   撤销暂存（收错了重收）
 *   receive_staged_batch     按供应商批量提交：建批次 + 逐行调 receive_purchase_item
 *                            既有事务函数入账 + 行写批次 id；任一失败整体回滚
 *   complete_batch_inbound   按批次入库：跨采购单一次入库，应付款按批次
 *                            （=供应商销售单口径）合并记一笔；支持改价/抹零/运费分摊
 *                            （同 0821 销售单核算口径）
*/

/* ============================================================
   一、表结构
   ============================================================ */
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS staged_qty INTEGER,
  ADD COLUMN IF NOT EXISTS staged_action TEXT,
  ADD COLUMN IF NOT EXISTS staged_evidence JSONB,
  ADD COLUMN IF NOT EXISTS staged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS staged_by UUID,
  ADD COLUMN IF NOT EXISTS receiving_batch_id UUID;

CREATE TABLE IF NOT EXISTS public.receiving_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_no TEXT UNIQUE,
  supplier_id UUID REFERENCES public.suppliers(id),
  supplier_name TEXT,
  supplier_order_no TEXT,
  status TEXT NOT NULL DEFAULT 'pending_storage',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  inbounded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_receiving_batches_status ON public.receiving_batches(status);
CREATE INDEX IF NOT EXISTS idx_poi_receiving_batch ON public.purchase_order_items(receiving_batch_id) WHERE receiving_batch_id IS NOT NULL;

ALTER TABLE public.receiving_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY receiving_batches_select ON public.receiving_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY receiving_batches_insert ON public.receiving_batches FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
CREATE POLICY receiving_batches_update ON public.receiving_batches FOR UPDATE TO authenticated USING (public.has_role('admin','boss','warehouse'));

ALTER TABLE public.inbound_orders ADD COLUMN IF NOT EXISTS receiving_batch_id UUID;

/* ============================================================
   二、写暂存
   ============================================================ */
CREATE OR REPLACE FUNCTION public.stage_receiving_item(
  p_item_id UUID,
  p_qty INTEGER,
  p_action TEXT,
  p_evidence JSONB,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;
  IF p_qty IS NULL OR p_qty < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '暂存数量必须 ≥ 0');
  END IF;

  UPDATE public.purchase_order_items
  SET staged_qty = p_qty,
      staged_action = p_action,
      staged_evidence = p_evidence,
      staged_at = NOW(),
      staged_by = p_operator_id
  WHERE id = p_item_id AND handle_action IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '该配件已提交或不存在，不能暂存');
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   三、撤销暂存
   ============================================================ */
CREATE OR REPLACE FUNCTION public.unstage_receiving_item(
  p_item_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  UPDATE public.purchase_order_items
  SET staged_qty = NULL, staged_action = NULL, staged_evidence = NULL, staged_at = NULL, staged_by = NULL
  WHERE id = p_item_id AND staged_at IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '该配件没有暂存记录');
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   四、按供应商批量提交：建批次 + 逐行入账 + 行写批次 id
   ============================================================ */
CREATE OR REPLACE FUNCTION public.receive_staged_batch(
  p_supplier_id UUID,
  p_supplier_order_no TEXT,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_res JSONB;
  v_count INTEGER := 0;
  v_batch_id UUID;
  v_batch_no TEXT;
  v_date_str TEXT;
  v_seq INTEGER;
  v_supplier_name TEXT;
  v_order_ids UUID[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 批次号：SH-YYYYMMDD-序号（当日序号，咨询锁防重号） */
  v_date_str := to_char(NOW(), 'YYYYMMDD');
  PERFORM pg_advisory_xact_lock(hashtext('receiving_batch_no_' || v_date_str));
  SELECT COUNT(*) + 1 INTO v_seq FROM public.receiving_batches WHERE batch_no LIKE 'SH-' || v_date_str || '-%';
  v_batch_no := 'SH-' || v_date_str || '-' || lpad(v_seq::TEXT, 3, '0');

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = p_supplier_id;

  INSERT INTO public.receiving_batches (batch_no, supplier_id, supplier_name, supplier_order_no, status, created_by)
  VALUES (v_batch_no, p_supplier_id, COALESCE(v_supplier_name, ''),
          NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), ''), 'pending_storage', p_operator_id)
  RETURNING id INTO v_batch_id;

  /* 逐行调既有收货事务函数；它返回 success:false 不抛异常，这里手动 RAISE 让整批回滚 */
  FOR v_row IN
    SELECT poi.id, poi.order_id, poi.staged_action, poi.staged_qty, poi.staged_evidence
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders o ON o.id = poi.order_id
    WHERE o.supplier_id = p_supplier_id
      AND poi.staged_at IS NOT NULL
      AND poi.handle_action IS NULL
    ORDER BY poi.staged_at
    FOR UPDATE OF poi
  LOOP
    v_res := public.receive_purchase_item(
      v_row.order_id, v_row.id, v_row.staged_action, v_row.staged_qty,
      v_row.staged_evidence, true, p_operator_id
    );
    IF NOT COALESCE((v_res->>'success')::BOOLEAN, false) THEN
      RAISE EXCEPTION '配件 % 提交失败: %', v_row.id, COALESCE(v_res->>'error', '未知错误');
    END IF;

    /* 清暂存 + 写批次关联 */
    UPDATE public.purchase_order_items
    SET staged_qty = NULL, staged_action = NULL, staged_evidence = NULL, staged_at = NULL, staged_by = NULL,
        receiving_batch_id = v_batch_id
    WHERE id = v_row.id;

    v_count := v_count + 1;
    IF NOT v_row.order_id = ANY(v_order_ids) THEN
      v_order_ids := array_append(v_order_ids, v_row.order_id);
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION '该供应商没有待提交的暂存收货';
  END IF;

  /* 销售单号同步写到涉及的所有采购单（对账用） */
  IF NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), '') IS NOT NULL THEN
    UPDATE public.purchase_orders
    SET supplier_order_no = TRIM(p_supplier_order_no)
    WHERE id = ANY(v_order_ids);
  END IF;

  RETURN jsonb_build_object('success', true, 'count', v_count, 'batch_id', v_batch_id, 'batch_no', v_batch_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   五、按批次入库（跨采购单一次入库，应付款按批次合并记一笔）
   核算口径同 0821 销售单规则：行可改价、抹零拦截、运费金额占比+手动行分摊、
   成本价=入库价+单位运费分摊 写 parts.cost_price / 工单配件行 cost_price
   ============================================================ */
CREATE OR REPLACE FUNCTION public.complete_batch_inbound(
  p_batch_id UUID,
  p_items JSONB,
  p_freight_amount DECIMAL,
  p_operator_id UUID,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_supplier_order_amount DECIMAL DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
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
  v_payable DECIMAL(12,2);
  v_order_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_batch FROM public.receiving_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '收货批次不存在');
  END IF;
  IF v_batch.status <> 'pending_storage' THEN
    RETURN jsonb_build_object('success', false, 'error', '该批次已入库或状态不允许');
  END IF;

  /* 1. 第一遍：校验明细属于本批次、累计货款/数量、分离手动运费行 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM public.purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
      AND receiving_batch_id = p_batch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '采购明细 % 不属于本收货批次', v_item->>'purchase_order_item_id';
    END IF;

    v_unit_cost := COALESCE((v_item->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0);
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION '入库单价不能为负（%）', COALESCE(v_poi.name, '');
    END IF;

    v_line_amount := v_qty * v_unit_cost;
    v_goods_amount := v_goods_amount + v_line_amount;
    v_total_qty := v_total_qty + v_qty;

    IF (v_item->>'freight_alloc') IS NOT NULL THEN
      v_manual_freight := v_manual_freight + COALESCE((v_item->>'freight_alloc')::DECIMAL, 0);
    ELSE
      v_auto_amount := v_auto_amount + v_line_amount;
    END IF;
  END LOOP;

  IF v_total_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '入库数量必须大于 0');
  END IF;

  /* 1.5 销售单拦截校验：填了总金额才启用（金额取批次上已录的，参数可覆盖） */
  IF COALESCE(p_supplier_order_amount, NULL) IS NOT NULL THEN
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

  /* 2. 入库单主表（关联批次，携带销售单信息） */
  INSERT INTO public.inbound_orders (
    purchase_order_id, arrival_id, receiving_batch_id, supplier_id, supplier_name,
    total_quantity, total_amount, freight_amount,
    waybill_id, status, notes, operator_id,
    supplier_order_no, supplier_order_amount, discount_amount
  ) VALUES (
    NULL, NULL, p_batch_id, v_batch.supplier_id, COALESCE(v_batch.supplier_name, ''),
    0, 0, COALESCE(p_freight_amount, 0),
    NULL, 'completed', '收货批次 ' || v_batch.batch_no, p_operator_id,
    v_batch.supplier_order_no,
    COALESCE(p_supplier_order_amount, NULL),
    COALESCE(p_discount_amount, 0)
  )
  RETURNING id, inbound_no INTO v_inbound_id, v_inbound_no;

  /* 3. 逐行入库：明细 + 加库存 + 仓位 + 批次 + 流水 + 价格 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM public.purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID;
    v_unit_cost := COALESCE((v_item->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0);

    IF (v_item->>'freight_alloc') IS NOT NULL THEN
      v_alloc := ROUND(COALESCE((v_item->>'freight_alloc')::DECIMAL, 0), 2);
    ELSIF v_auto_amount > 0 THEN
      v_alloc := ROUND(v_remain_freight * (v_qty * v_unit_cost) / v_auto_amount, 2);
    ELSE
      v_alloc := 0;
    END IF;

    v_total_amount := v_total_amount + v_qty * v_unit_cost + v_alloc;

    INSERT INTO public.inbound_order_items (
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

    IF v_poi.part_id IS NOT NULL THEN
      UPDATE public.parts
      SET quantity = quantity + v_qty,
          purchase_price = v_unit_cost,
          cost_price = v_unit_cost + ROUND(v_alloc / v_qty, 2)
      WHERE id = v_poi.part_id
      RETURNING quantity INTO v_after_qty;
      v_before_qty := v_after_qty - v_qty;

      IF v_poi.work_order_item_part_id IS NOT NULL THEN
        UPDATE public.work_order_item_parts
        SET cost_price = v_unit_cost + ROUND(v_alloc / v_qty, 2)
        WHERE id = v_poi.work_order_item_part_id;
      END IF;

      IF NULLIF(v_item->>'warehouse_id', '') IS NOT NULL THEN
        v_loc := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''), '');
        UPDATE public.part_stock_locations
        SET quantity = quantity + v_qty
        WHERE part_id = v_poi.part_id
          AND warehouse_id = (v_item->>'warehouse_id')::UUID
          AND COALESCE(location, '') = v_loc;
        IF NOT FOUND THEN
          INSERT INTO public.part_stock_locations (part_id, warehouse_id, location, quantity)
          VALUES (v_poi.part_id, (v_item->>'warehouse_id')::UUID, v_loc, v_qty);
        END IF;
      END IF;

      INSERT INTO public.part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id, inbound_type, reference_id, notes)
      VALUES (
        v_poi.part_id,
        NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
        v_qty, v_qty, v_unit_cost, v_batch.supplier_id,
        'purchase', p_batch_id,
        NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
      );

      INSERT INTO public.inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, waybill_id, operator_id, notes)
      VALUES (
        v_poi.part_id, 'inbound', v_qty, v_before_qty, v_after_qty,
        'inbound_order', v_inbound_id, NULL, p_operator_id,
        '批次入库: ' || COALESCE(v_poi.name, '') || '（' || v_batch.batch_no || '）'
      );
    END IF;
  END LOOP;

  /* 4. 回填入库单合计 */
  UPDATE public.inbound_orders
  SET total_quantity = v_total_qty, total_amount = v_total_amount
  WHERE id = v_inbound_id;

  /* 5. 应付款 = 货款 − 抹零（=销售单总金额），按批次合并记一笔 */
  v_payable := v_goods_amount - COALESCE(p_discount_amount, 0);
  IF v_batch.supplier_id IS NOT NULL AND v_payable > 0 THEN
    INSERT INTO public.supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_batch.supplier_id, 'debit', ROUND(v_payable, 2),
            '采购入库(批次 ' || v_batch.batch_no ||
              CASE WHEN v_batch.supplier_order_no IS NOT NULL AND TRIM(v_batch.supplier_order_no) <> ''
                   THEN ' 销售单 ' || TRIM(v_batch.supplier_order_no) ELSE '' END || ')',
            v_inbound_id, 'inbound_order');
  END IF;

  /* 6. 涉及采购单：全部行已处理的转已完成 */
  FOR v_order_id IN
    SELECT DISTINCT order_id FROM public.purchase_order_items WHERE receiving_batch_id = p_batch_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.purchase_order_items
      WHERE order_id = v_order_id AND handle_action IS NULL
    ) THEN
      UPDATE public.purchase_orders SET status = 'completed' WHERE id = v_order_id;
    END IF;
  END LOOP;

  /* 7. 批次转已入库 */
  UPDATE public.receiving_batches SET status = 'inbounded', inbounded_at = NOW() WHERE id = p_batch_id;

  RETURN jsonb_build_object('success', true, 'inbound_order_id', v_inbound_id, 'inbound_no', v_inbound_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.stage_receiving_item(uuid, integer, text, jsonb, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unstage_receiving_item(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.receive_staged_batch(uuid, text, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_batch_inbound(uuid, jsonb, numeric, uuid, numeric, numeric) FROM anon, PUBLIC;

/* 台账登记（台账表不存在时跳过） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_log') THEN
    INSERT INTO migration_log (file_name) VALUES ('migrations_20260904_receiving_staged.sql') ON CONFLICT DO NOTHING;
  END IF;
END $$;

/* ============================================================
   验证（执行完后跑）：
   1. 暂存列：SELECT column_name FROM information_schema.columns
      WHERE table_name='purchase_order_items' AND column_name LIKE 'staged%'; 应 5 行
   2. 批次表：SELECT count(*) FROM receiving_batches; 不报错即建好
   3. 四函数：SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('stage_receiving_item','unstage_receiving_item','receive_staged_batch','complete_batch_inbound');
      应 4 行。
   ============================================================
*/
