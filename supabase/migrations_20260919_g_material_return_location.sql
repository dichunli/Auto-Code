/* ============================================================
 * 退料回库加仓位数量（2026-09-19 用户拍板：全部出入库都记仓位，方便随时盘点）
 * 背景：退料只回加批次和总库存，不回加 part_stock_locations。
 * 改动：
 *   1. part_return_records 加 warehouse_id（外键 warehouses）+ location
 *   2. create_material_return_order：明细 JSON 支持 warehouse_id / location；
 *      没带时默认取领料记录的取自仓位（从哪拿的退回哪），申请流/老路径自动受益
 *   3. fn_restore_batch_on_return（退料回库触发器）：记录带仓位就同步加回
 *      仓位库存，仓位行不存在则补建
 * 幂等：ADD COLUMN IF NOT EXISTS + DO 块判重 + CREATE OR REPLACE（参数未变），可重跑。
 * ============================================================ */

ALTER TABLE public.part_return_records ADD COLUMN IF NOT EXISTS warehouse_id UUID;
ALTER TABLE public.part_return_records ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN public.part_return_records.warehouse_id IS '退回仓库（退料时选，默认=领料取自仓位）';
COMMENT ON COLUMN public.part_return_records.location IS '退回仓位（退料时选，默认=领料取自仓位）';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'part_return_records_warehouse_id_fkey'
  ) THEN
    ALTER TABLE public.part_return_records
      ADD CONSTRAINT part_return_records_warehouse_id_fkey
      FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);
  END IF;
END $$;

/* ─── 二、create_material_return_order：退料记录支持仓位（函数体同 0731 版，仅加仓位写入+默认） ─── */
CREATE OR REPLACE FUNCTION create_material_return_order(
  p_work_order_id UUID,
  p_picking_order_id UUID,
  p_items JSONB,
  p_return_type TEXT,
  p_reason TEXT,
  p_notes TEXT,
  p_operator_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_order_id UUID;
  v_return_no TEXT;
  v_item JSONB;
  v_record_id UUID;
  v_total INTEGER := 0;
  v_wid UUID;
  v_loc TEXT;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '退料明细不能为空');
  END IF;

  /* 未传工单时从第一条明细的配件分支反查工单 */
  IF p_work_order_id IS NULL THEN
    SELECT woi.work_order_id INTO p_work_order_id
    FROM work_order_item_parts p
    JOIN work_order_items woi ON woi.id = p.work_order_item_id
    WHERE p.id = (p_items->0->>'work_order_item_part_id')::UUID;
  END IF;

  INSERT INTO material_return_orders (work_order_id, picking_order_id, return_type, reason, notes, operator_id)
  VALUES (
    p_work_order_id, p_picking_order_id,
    NULLIF(TRIM(COALESCE(p_return_type, '')), ''),
    NULLIF(TRIM(COALESCE(p_reason, '')), ''),
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    p_operator_id
  )
  RETURNING id, return_no INTO v_order_id, v_return_no;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    /* 退回仓位（2026-09-19）：明细没带时默认取领料记录的取自仓位（从哪拿的退回哪） */
    v_wid := NULLIF(v_item->>'warehouse_id', '')::UUID;
    v_loc := NULLIF(TRIM(COALESCE(v_item->>'location', '')), '');
    IF v_wid IS NULL AND NULLIF(v_item->>'picking_record_id', '') IS NOT NULL THEN
      SELECT warehouse_id, location INTO v_wid, v_loc
      FROM part_picking_records WHERE id = (v_item->>'picking_record_id')::UUID;
    END IF;

    /* 触发器会校验可退数量并把库存加回（含仓位库存） */
    INSERT INTO part_return_records (work_order_item_part_id, picking_record_id, return_type, quantity, returned_by, notes, material_return_order_id, warehouse_id, location)
    VALUES (
      (v_item->>'work_order_item_part_id')::UUID,
      (v_item->>'picking_record_id')::UUID,
      COALESCE(NULLIF(TRIM(COALESCE(p_return_type, '')), ''), v_item->>'return_type'),
      (v_item->>'quantity')::INTEGER,
      p_operator_id,
      NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      v_order_id,
      v_wid,
      v_loc
    )
    RETURNING id INTO v_record_id;

    INSERT INTO material_return_order_items (
      return_order_id, return_record_id, picking_record_id, work_order_item_part_id, part_id, batch_id,
      part_number, name, brand, specification, unit, batch_no, unit_cost, quantity, return_type
    ) VALUES (
      v_order_id, v_record_id,
      (v_item->>'picking_record_id')::UUID,
      (v_item->>'work_order_item_part_id')::UUID,
      NULLIF(v_item->>'part_id', '')::UUID,
      NULLIF(v_item->>'batch_id', '')::UUID,
      v_item->>'part_number', v_item->>'name', v_item->>'brand',
      v_item->>'specification', v_item->>'unit', v_item->>'batch_no',
      NULLIF(v_item->>'unit_cost', '')::DECIMAL,
      (v_item->>'quantity')::INTEGER,
      COALESCE(NULLIF(TRIM(COALESCE(p_return_type, '')), ''), v_item->>'return_type')
    );

    v_total := v_total + (v_item->>'quantity')::INTEGER;
  END LOOP;

  UPDATE material_return_orders SET total_quantity = v_total WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'return_order_id', v_order_id, 'return_no', v_return_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ─── 三、fn_restore_batch_on_return：回库时同步加回仓位库存 ───
   函数体同 0915_b 版（含 FOR UPDATE 防并发超退），仅加仓位回加段 */
CREATE OR REPLACE FUNCTION fn_restore_batch_on_return()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_part_id UUID;
  v_picked INTEGER;
  v_is_direct BOOLEAN;
  v_returned INTEGER;
  v_after INTEGER;
  v_work_order_id UUID;
  v_order_status TEXT;
BEGIN
  /* 校验退料数量不超过该领料记录的净领量（FOR UPDATE OF r 锁行防并发超退） */
  IF NEW.picking_record_id IS NOT NULL THEN
    SELECT r.batch_id, r.quantity, COALESCE(r.is_direct, false), o.status
      INTO v_batch_id, v_picked, v_is_direct, v_order_status
    FROM part_picking_records r
    LEFT JOIN picking_orders o ON o.id = r.picking_order_id
    WHERE r.id = NEW.picking_record_id
    FOR UPDATE OF r;
    IF NOT FOUND THEN
      RAISE EXCEPTION '领料记录不存在';
    END IF;
    /* 待确认单占位记录禁止退料（库存从未扣过，退了会凭空加库存） */
    IF v_order_status = 'draft' THEN
      RAISE EXCEPTION '该领料单还在待确认（未出库），不能退料；请先确认出库或作废该领料单';
    END IF;
    /* 未冲账直领件禁止退料（账上无这批货，退了会凭空加库存） */
    IF v_is_direct AND v_batch_id IS NULL THEN
      RAISE EXCEPTION '该配件是急件直领、尚未入库冲账，不能退料；可让库管在领料单详情里取消直领';
    END IF;
    SELECT COALESCE(SUM(quantity), 0) INTO v_returned
    FROM part_return_records
    WHERE picking_record_id = NEW.picking_record_id AND id <> NEW.id;
    IF v_returned + NEW.quantity > v_picked THEN
      RAISE EXCEPTION '退料数量超出可退数量:已领 % 件,已退 % 件,本次要退 % 件', v_picked, v_returned, NEW.quantity;
    END IF;
  END IF;

  /* 加回批次剩余和总库存 */
  IF v_batch_id IS NOT NULL THEN
    UPDATE part_batches SET remaining = remaining + NEW.quantity WHERE id = v_batch_id
    RETURNING part_id INTO v_part_id;
  END IF;
  IF v_part_id IS NULL THEN
    SELECT part_id INTO v_part_id FROM work_order_item_parts WHERE id = NEW.work_order_item_part_id;
  END IF;

  IF v_part_id IS NOT NULL THEN
    UPDATE parts SET quantity = quantity + NEW.quantity WHERE id = v_part_id
    RETURNING quantity INTO v_after;

    /* 仓位库存同步加回（2026-09-19 用户拍板）：记录带仓位就加回，
       仓位行不存在则补建（如期间被清空） */
    IF NEW.warehouse_id IS NOT NULL THEN
      UPDATE public.part_stock_locations SET quantity = quantity + NEW.quantity
      WHERE part_id = v_part_id
        AND warehouse_id = NEW.warehouse_id
        AND COALESCE(location, '') = COALESCE(NEW.location, '');
      IF NOT FOUND THEN
        INSERT INTO public.part_stock_locations (part_id, warehouse_id, location, quantity)
        VALUES (v_part_id, NEW.warehouse_id, NEW.location, NEW.quantity);
      END IF;
    END IF;

    SELECT woi.work_order_id INTO v_work_order_id
    FROM work_order_item_parts p
    JOIN work_order_items woi ON woi.id = p.work_order_item_id
    WHERE p.id = NEW.work_order_item_part_id;

    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, notes)
    VALUES (v_part_id, 'return_in', NEW.quantity, v_after - NEW.quantity, v_after, v_work_order_id, 'return_record', NEW.id, '工单退料回库');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260919_g_material_return_location.sql', '退料记录加退回仓位(默认=领料取自仓位)，退料回库同步加回仓位数量')
ON CONFLICT (file_name) DO NOTHING;
