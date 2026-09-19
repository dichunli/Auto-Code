/* ============================================================
 * 配件报废出库（2026-09-19 用户拍板：全部出入库都记仓位，方便随时盘点）
 * 背景：系统此前没有配件报废流程，盘亏只能走盘点差异调整。
 *   新建正规报废：选配件+批次+仓位+数量+原因，一个事务扣
 *   批次剩余/总库存/仓位库存，留报废记录和库存流水。
 * 幂等：IF NOT EXISTS + CREATE OR REPLACE，可重跑。
 * ============================================================ */

/* ─── 一、报废记录表 ─── */
CREATE TABLE IF NOT EXISTS public.part_scrap_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES public.parts(id),
  batch_id UUID REFERENCES public.part_batches(id),
  warehouse_id UUID REFERENCES public.warehouses(id),
  location TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrap_part ON public.part_scrap_records(part_id);
CREATE INDEX IF NOT EXISTS idx_scrap_created ON public.part_scrap_records(created_at DESC);

ALTER TABLE public.part_scrap_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS part_scrap_records_select ON public.part_scrap_records;
CREATE POLICY part_scrap_records_select ON public.part_scrap_records
  FOR SELECT TO authenticated USING (true);

/* ─── 二、scrap_part_stock：报废出库一个事务（扣批次/总库存/仓位 + 记录 + 流水） ─── */
CREATE OR REPLACE FUNCTION public.scrap_part_stock(
  p_part_id UUID,
  p_batch_id UUID,
  p_warehouse_id UUID,
  p_location TEXT,
  p_quantity INTEGER,
  p_reason TEXT,
  p_notes TEXT,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_part RECORD;
  v_remaining INTEGER;
  v_after INTEGER;
  v_loc TEXT;
  v_loc_qty INTEGER;
  v_record_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作报废');
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '报废数量必须大于 0');
  END IF;

  /* 1. 锁配件 */
  SELECT id, name, part_number, quantity INTO v_part FROM parts WHERE id = p_part_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件档案不存在');
  END IF;
  IF v_part.quantity < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'error',
      '「' || COALESCE(v_part.name, '') || '」当前库存 ' || v_part.quantity || ' 件，不足报废 ' || p_quantity || ' 件');
  END IF;

  /* 2. 锁批次扣剩余（报废必须指定批次） */
  SELECT remaining INTO v_remaining FROM part_batches WHERE id = p_batch_id AND part_id = p_part_id FOR UPDATE;
  IF v_remaining IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '批次不存在或不属于该配件');
  END IF;
  IF v_remaining < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'error', '批次剩余仅 ' || v_remaining || ' 件，不足报废');
  END IF;

  /* 3. 锁仓位扣数量（报废必须指定仓位） */
  v_loc := COALESCE(NULLIF(TRIM(COALESCE(p_location, '')), ''), '');
  SELECT quantity INTO v_loc_qty FROM public.part_stock_locations
  WHERE part_id = p_part_id AND warehouse_id = p_warehouse_id AND COALESCE(location, '') = v_loc
  FOR UPDATE;
  IF v_loc_qty IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '所选仓位没有该配件库存记录，请核对仓位');
  END IF;
  IF v_loc_qty < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'error', '所选仓位仅剩 ' || v_loc_qty || ' 件，不足报废');
  END IF;

  UPDATE part_batches SET remaining = remaining - p_quantity WHERE id = p_batch_id;
  UPDATE parts SET quantity = quantity - p_quantity WHERE id = p_part_id
  RETURNING quantity INTO v_after;
  UPDATE public.part_stock_locations SET quantity = quantity - p_quantity
  WHERE part_id = p_part_id AND warehouse_id = p_warehouse_id AND COALESCE(location, '') = v_loc;

  /* 4. 报废记录 + 库存流水 */
  INSERT INTO public.part_scrap_records (part_id, batch_id, warehouse_id, location, quantity, reason, notes, created_by)
  VALUES (p_part_id, p_batch_id, p_warehouse_id, NULLIF(TRIM(COALESCE(p_location, '')), ''),
          p_quantity, NULLIF(TRIM(COALESCE(p_reason, '')), ''), NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_operator_id)
  RETURNING id INTO v_record_id;

  INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, operator_id, notes)
  VALUES (p_part_id, 'outbound', -p_quantity, v_after + p_quantity, v_after,
          'scrap_record', v_record_id, p_operator_id, '报废出库: ' || COALESCE(v_part.name, ''));

  RETURN jsonb_build_object('success', true, 'record_id', v_record_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.scrap_part_stock(uuid, uuid, uuid, text, integer, text, text, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.scrap_part_stock(uuid, uuid, uuid, text, integer, text, text, uuid) TO authenticated;

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260919_h_scrap.sql', '配件报废出库：报废记录表+一个事务扣批次/总库存/仓位')
ON CONFLICT (file_name) DO NOTHING;
