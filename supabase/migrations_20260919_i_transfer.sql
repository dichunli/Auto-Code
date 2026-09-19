/* ============================================================
 * 仓位调拨（2026-09-19 用户拍板：全部出入库都记仓位，方便随时盘点）
 * 背景：配件在仓位之间搬移此前没有系统记录，仓位账对不上实物。
 *   新建调拨：选配件+源仓位+目标仓位+数量，一个事务完成
 *   源仓位扣减 + 目标仓位加回（无记录补建行），总库存不变。
 * 幂等：IF NOT EXISTS + CREATE OR REPLACE，可重跑。
 * ============================================================ */

/* ─── 一、调拨记录表 ─── */
CREATE TABLE IF NOT EXISTS public.stock_location_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES public.parts(id),
  from_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  from_location TEXT,
  to_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  to_location TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_part ON public.stock_location_transfers(part_id);
CREATE INDEX IF NOT EXISTS idx_transfer_created ON public.stock_location_transfers(created_at DESC);

ALTER TABLE public.stock_location_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_location_transfers_select ON public.stock_location_transfers;
CREATE POLICY stock_location_transfers_select ON public.stock_location_transfers
  FOR SELECT TO authenticated USING (true);

/* ─── 二、transfer_stock_location：仓位调拨一个事务（总库存不变，只动仓位账） ─── */
CREATE OR REPLACE FUNCTION public.transfer_stock_location(
  p_part_id UUID,
  p_from_warehouse_id UUID,
  p_from_location TEXT,
  p_to_warehouse_id UUID,
  p_to_location TEXT,
  p_quantity INTEGER,
  p_notes TEXT,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_loc TEXT;
  v_to_loc TEXT;
  v_from_qty INTEGER;
  v_part_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作调拨');
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '调拨数量必须大于 0');
  END IF;

  v_from_loc := COALESCE(NULLIF(TRIM(COALESCE(p_from_location, '')), ''), '');
  v_to_loc := COALESCE(NULLIF(TRIM(COALESCE(p_to_location, '')), ''), '');

  /* 源和目标不能是同一仓位 */
  IF p_from_warehouse_id = p_to_warehouse_id AND v_from_loc = v_to_loc THEN
    RETURN jsonb_build_object('success', false, 'error', '源仓位和目标仓位相同，无需调拨');
  END IF;

  SELECT name INTO v_part_name FROM parts WHERE id = p_part_id;
  IF v_part_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '配件档案不存在');
  END IF;

  /* 1. 锁源仓位校验并扣减 */
  SELECT quantity INTO v_from_qty FROM public.part_stock_locations
  WHERE part_id = p_part_id AND warehouse_id = p_from_warehouse_id AND COALESCE(location, '') = v_from_loc
  FOR UPDATE;
  IF v_from_qty IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '源仓位没有该配件库存记录');
  END IF;
  IF v_from_qty < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'error',
      '源仓位仅剩 ' || v_from_qty || ' 件，不足调拨 ' || p_quantity || ' 件');
  END IF;
  UPDATE public.part_stock_locations SET quantity = quantity - p_quantity
  WHERE part_id = p_part_id AND warehouse_id = p_from_warehouse_id AND COALESCE(location, '') = v_from_loc;

  /* 2. 目标仓位加回（无记录补建行） */
  UPDATE public.part_stock_locations SET quantity = quantity + p_quantity
  WHERE part_id = p_part_id AND warehouse_id = p_to_warehouse_id AND COALESCE(location, '') = v_to_loc;
  IF NOT FOUND THEN
    INSERT INTO public.part_stock_locations (part_id, warehouse_id, location, quantity)
    VALUES (p_part_id, p_to_warehouse_id, NULLIF(v_to_loc, ''), p_quantity);
  END IF;

  /* 3. 调拨记录 */
  INSERT INTO public.stock_location_transfers (
    part_id, from_warehouse_id, from_location, to_warehouse_id, to_location, quantity, notes, created_by
  ) VALUES (
    p_part_id, p_from_warehouse_id, NULLIF(v_from_loc, ''),
    p_to_warehouse_id, NULLIF(v_to_loc, ''),
    p_quantity, NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_operator_id
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.transfer_stock_location(uuid, uuid, text, uuid, text, integer, text, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_stock_location(uuid, uuid, text, uuid, text, integer, text, uuid) TO authenticated;

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260919_i_transfer.sql', '仓位调拨：调拨记录表+一个事务源扣目标加(总库存不变)')
ON CONFLICT (file_name) DO NOTHING;
