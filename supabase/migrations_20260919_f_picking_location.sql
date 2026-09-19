/* ============================================================
 * 领料出库扣仓位数量（2026-09-19 用户拍板：全部出入库都记仓位，方便随时盘点）
 * 背景：领料只扣批次和总库存，不扣 part_stock_locations，仓位账越差越大。
 * 改动：
 *   1. part_picking_records 加 warehouse_id（外键 warehouses）+ location
 *   2. create_picking_order：明细 JSON 支持 warehouse_id / location 写入领料记录
 *   3. fn_picking_deduct_record（领料扣库存唯一挂点，confirmed 单建单即扣、
 *      draft 单确认出库时补扣，两处自动覆盖）：记录带仓位就同步扣仓位库存，
 *      无记录/不足报错整单回滚
 * 说明：直领件（is_direct 且 batch_id IS NULL）本就不扣库存，不受本次影响；
 *      直领对应入库按"实收-直领净额"入仓位，仓位账天然正确。
 * 幂等：ADD COLUMN IF NOT EXISTS + DO 块判重 + CREATE OR REPLACE（参数未变），可重跑。
 * ============================================================ */

ALTER TABLE public.part_picking_records ADD COLUMN IF NOT EXISTS warehouse_id UUID;
ALTER TABLE public.part_picking_records ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN public.part_picking_records.warehouse_id IS '取自仓库（领料时选）';
COMMENT ON COLUMN public.part_picking_records.location IS '取自仓位（领料时选）';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'part_picking_records_warehouse_id_fkey'
  ) THEN
    ALTER TABLE public.part_picking_records
      ADD CONSTRAINT part_picking_records_warehouse_id_fkey
      FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);
  END IF;
END $$;

/* ─── 二、create_picking_order：领料记录支持仓位（函数体同 0918_a 版，仅插入带仓位） ─── */
CREATE OR REPLACE FUNCTION public.create_picking_order(
  p_work_order_id UUID,
  p_items JSONB,
  p_receiver_name TEXT,
  p_notes TEXT,
  p_operator_id UUID,
  p_scan_codes JSONB DEFAULT NULL
)
RETURNS JSONB
SET search_path = public
AS $func$
DECLARE
  v_order_id UUID;
  v_picking_no TEXT;
  v_item JSONB;
  v_record_id UUID;
  v_total INTEGER := 0;
  v_ctl RECORD;
  v_code TEXT;
  v_need_confirm BOOLEAN := false;
  v_status TEXT;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '领料明细不能为空');
  END IF;

  /* 未传工单时从第一条明细的配件分支反查工单 */
  IF p_work_order_id IS NULL THEN
    SELECT woi.work_order_id INTO p_work_order_id
    FROM work_order_item_parts p
    JOIN work_order_items woi ON woi.id = p.work_order_item_id
    WHERE p.id = (p_items->0->>'work_order_item_part_id')::UUID;
  END IF;

  /* 第 0 步：管控解析。以批次所属配件为权威（不信客户端传的 part_id），
     三级 OR：配件 / 配件名称 / 配件分类 任一级勾了即生效 */
  FOR v_ctl IN
    SELECT DISTINCT p.id, p.name AS part_name, p.part_number, p.barcode,
      (COALESCE(p.require_scan_check, false) OR COALESCE(pn.require_scan_check, false)
        OR COALESCE(pc.require_scan_check, false)) AS need_scan,
      (COALESCE(p.require_confirm, false) OR COALESCE(pn.require_confirm, false)
        OR COALESCE(pc.require_confirm, false)) AS need_confirm
    FROM part_batches pb
    JOIN parts p ON p.id = pb.part_id
    LEFT JOIN part_names pn ON pn.id = p.part_name_id
    LEFT JOIN part_categories pc ON pc.id = COALESCE(pn.category_id, p.category_id)
    WHERE pb.id IN (
      SELECT (e->>'batch_id')::UUID FROM jsonb_array_elements(p_items) e
    )
  LOOP
    /* 扫码出库管控：必须提供扫到的码，且与条码/编码/配件id 三值之一相符 */
    IF v_ctl.need_scan THEN
      v_code := NULLIF(TRIM(COALESCE(p_scan_codes ->> v_ctl.id::TEXT, '')), '');
      IF v_code IS NULL THEN
        RAISE EXCEPTION '配件「%」要求扫码出库，请先扫码核对后再提交', v_ctl.part_name;
      END IF;
      /* 2026-09-18 修复：barcode/part_number 为 NULL 时 OR 表达式变 NULL 导致错码放行，
         统一 COALESCE 为空串（v_code 已保证非空，空串永不命中） */
      IF NOT (v_code = COALESCE(v_ctl.barcode, '') OR v_code = COALESCE(v_ctl.part_number, '') OR v_code = v_ctl.id::TEXT) THEN
        RAISE EXCEPTION '配件「%」扫码核对失败：扫到的码与该配件条码/编码不符', v_ctl.part_name;
      END IF;
    END IF;
    IF v_ctl.need_confirm THEN
      v_need_confirm := true;
    END IF;
  END LOOP;

  /* 含需确认配件 → 整单 draft（占位不动库存，库管确认出库时才扣） */
  v_status := CASE WHEN v_need_confirm THEN 'draft' ELSE 'confirmed' END;

  /* 1. 建领料单主表(单号由触发器生成) */
  INSERT INTO picking_orders (work_order_id, receiver_name, notes, operator_id, status)
  VALUES (p_work_order_id, NULLIF(TRIM(COALESCE(p_receiver_name, '')), ''), NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_operator_id, v_status)
  RETURNING id, picking_no INTO v_order_id, v_picking_no;

  /* 2. 逐条插领料记录(触发器扣库存,draft 单触发器旁路;不足则整体回滚)
     2026-09-19：明细可带 warehouse_id/location（取自仓位），扣库存时同步扣仓位数量 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO part_picking_records (work_order_item_part_id, batch_id, quantity, picked_by, picking_order_id, warehouse_id, location)
    VALUES (
      (v_item->>'work_order_item_part_id')::UUID,
      (v_item->>'batch_id')::UUID,
      (v_item->>'quantity')::INTEGER,
      p_operator_id,
      v_order_id,
      NULLIF(v_item->>'warehouse_id', '')::UUID,
      NULLIF(TRIM(COALESCE(v_item->>'location', '')), '')
    )
    RETURNING id INTO v_record_id;

    INSERT INTO picking_order_items (
      picking_order_id, picking_record_id, work_order_item_part_id, part_id, batch_id,
      part_number, name, brand, specification, unit, batch_no, unit_cost, quantity
    ) VALUES (
      v_order_id, v_record_id,
      (v_item->>'work_order_item_part_id')::UUID,
      NULLIF(v_item->>'part_id', '')::UUID,
      (v_item->>'batch_id')::UUID,
      v_item->>'part_number', v_item->>'name', v_item->>'brand',
      v_item->'specification', v_item->'unit', v_item->'batch_no',
      NULLIF(v_item->>'unit_cost', '')::DECIMAL,
      (v_item->>'quantity')::INTEGER
    );

    v_total := v_total + (v_item->>'quantity')::INTEGER;
  END LOOP;

  UPDATE picking_orders SET total_quantity = v_total WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'picking_order_id', v_order_id, 'picking_no', v_picking_no,
    'status', v_status, 'need_confirm', v_need_confirm);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func$ LANGUAGE plpgsql;

ALTER FUNCTION public.create_picking_order(uuid, jsonb, text, text, uuid, jsonb) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.create_picking_order(uuid, jsonb, text, text, uuid, jsonb) FROM PUBLIC, anon;

/* ─── 三、fn_picking_deduct_record：扣库存时同步扣仓位数量 ───
   函数体同 0910_a 版，仅加仓位扣减段 */
CREATE OR REPLACE FUNCTION public.fn_picking_deduct_record(p_record_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_part_id UUID;
  v_remaining INTEGER;
  v_after INTEGER;
  v_work_order_id UUID;
  v_loc_qty INTEGER;
BEGIN
  SELECT * INTO v_rec FROM part_picking_records WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '领料记录不存在';
  END IF;

  /* 直领登记：不动批次/总库存/流水，确认入库时即入即出冲账 */
  IF v_rec.batch_id IS NULL THEN
    IF v_rec.is_direct THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '库存批次不存在';
  END IF;

  /* 锁定批次行，校验剩余量 */
  SELECT part_id, remaining INTO v_part_id, v_remaining
  FROM part_batches WHERE id = v_rec.batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '库存批次不存在';
  END IF;
  IF v_remaining < v_rec.quantity THEN
    RAISE EXCEPTION '批次剩余库存不足:剩余 % 件,本次要领 % 件', v_remaining, v_rec.quantity;
  END IF;

  /* 扣批次剩余 */
  UPDATE part_batches SET remaining = remaining - v_rec.quantity WHERE id = v_rec.batch_id;

  /* 扣配件总库存，不足则报错整单回滚 */
  UPDATE parts SET quantity = quantity - v_rec.quantity
  WHERE id = v_part_id AND quantity >= v_rec.quantity
  RETURNING quantity INTO v_after;
  IF NOT FOUND THEN
    RAISE EXCEPTION '配件总库存不足,无法出库';
  END IF;

  /* 仓位库存同步扣减（2026-09-19 用户拍板）：记录带仓位就扣，
     无记录/不足报错整单回滚；没带仓位（老路径）跳过 */
  IF v_rec.warehouse_id IS NOT NULL THEN
    SELECT quantity INTO v_loc_qty FROM public.part_stock_locations
    WHERE part_id = v_part_id
      AND warehouse_id = v_rec.warehouse_id
      AND COALESCE(location, '') = COALESCE(v_rec.location, '')
    FOR UPDATE;
    IF v_loc_qty IS NULL THEN
      RAISE EXCEPTION '所选仓位没有该配件库存记录，请核对仓位';
    END IF;
    IF v_loc_qty < v_rec.quantity THEN
      RAISE EXCEPTION '所选仓位仅剩 % 件，不足领 % 件，请核对仓位', v_loc_qty, v_rec.quantity;
    END IF;
    UPDATE public.part_stock_locations SET quantity = quantity - v_rec.quantity
    WHERE part_id = v_part_id
      AND warehouse_id = v_rec.warehouse_id
      AND COALESCE(location, '') = COALESCE(v_rec.location, '');
  END IF;

  /* 查关联工单用于流水追溯 */
  SELECT woi.work_order_id INTO v_work_order_id
  FROM work_order_item_parts p
  JOIN work_order_items woi ON woi.id = p.work_order_item_id
  WHERE p.id = v_rec.work_order_item_part_id;

  /* 写库存流水 */
  INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, notes)
  VALUES (v_part_id, 'outbound', -v_rec.quantity, v_after + v_rec.quantity, v_after, v_work_order_id, 'picking_record', v_rec.id, '工单领料出库');
END;
$$ LANGUAGE plpgsql;

/* 内部函数：只能被触发器和 confirm_picking_order 调用，不对客户端开放 */
REVOKE ALL ON FUNCTION public.fn_picking_deduct_record(UUID) FROM PUBLIC, anon, authenticated;

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260919_f_picking_location.sql', '领料记录加取自仓位，领料扣库存同步扣仓位数量')
ON CONFLICT (file_name) DO NOTHING;
