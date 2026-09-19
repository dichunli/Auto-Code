/* ============================================================
 * 手工入库支持仓位（2026-09-19 用户拍板：全部出入库都记仓位，方便随时盘点）
 * 背景：手工入库（入库登记）表单没有仓位字段，货进哪个仓位不入账，
 *   是仓位账入库侧的最后一个缺口。
 * 改动：manual_part_inbound 追加 p_warehouse_id / p_location 两个可选参数，
 *   传了仓位就同步写 part_stock_locations（无记录补建行）。
 * 注意（迁移三防）：参数列表变了，必须先 DROP 旧签名再 CREATE，防重载残留。
 * 幂等：DROP IF EXISTS + CREATE，可重跑。
 * ============================================================ */

DROP FUNCTION IF EXISTS public.manual_part_inbound(uuid, integer, numeric, text, uuid, text);

CREATE FUNCTION public.manual_part_inbound(
  p_part_id UUID,
  p_qty INTEGER,
  p_unit_cost DECIMAL DEFAULT NULL,
  p_batch_no TEXT DEFAULT NULL,
  p_waybill_id UUID DEFAULT NULL,
  p_log_notes TEXT DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_location TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_after_qty INTEGER;
  v_loc TEXT;
BEGIN
  /* 必须已登录（SECURITY DEFINER 绕过 RLS，身份在此兜底） */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  IF p_part_id IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '入库数量必须大于0');
  END IF;

  /* 原子加库存：数据库内部排队执行，并发不会互相覆盖 */
  UPDATE parts
  SET quantity = quantity + p_qty
  WHERE id = p_part_id
  RETURNING quantity INTO v_after_qty;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件不存在');
  END IF;

  /* 仓位账（2026-09-19）：传了仓库就写 part_stock_locations（无记录补建行） */
  IF p_warehouse_id IS NOT NULL THEN
    v_loc := COALESCE(NULLIF(TRIM(COALESCE(p_location, '')), ''), '');
    UPDATE public.part_stock_locations SET quantity = quantity + p_qty
    WHERE part_id = p_part_id AND warehouse_id = p_warehouse_id AND COALESCE(location, '') = v_loc;
    IF NOT FOUND THEN
      INSERT INTO public.part_stock_locations (part_id, warehouse_id, location, quantity)
      VALUES (p_part_id, p_warehouse_id, NULLIF(v_loc, ''), p_qty);
    END IF;
  END IF;

  /* 批次（与原手工入库口径一致：有批次号才建） */
  IF NULLIF(TRIM(COALESCE(p_batch_no, '')), '') IS NOT NULL THEN
    INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost)
    VALUES (p_part_id, TRIM(p_batch_no), p_qty, p_qty, COALESCE(p_unit_cost, 0));
  END IF;

  /* 流水（前后数量在同一事务内算出，并发下也准确） */
  INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, waybill_id, notes)
  VALUES (p_part_id, 'inbound', p_qty, v_after_qty - p_qty, v_after_qty, p_waybill_id, p_log_notes);

  RETURN jsonb_build_object('success', true, 'before_qty', v_after_qty - p_qty, 'after_qty', v_after_qty);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.manual_part_inbound(uuid, integer, numeric, text, uuid, text, uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.manual_part_inbound(uuid, integer, numeric, text, uuid, text, uuid, text) TO authenticated;

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260919_k_manual_inbound_location.sql', '手工入库追加可选仓位参数，传了就写仓位账')
ON CONFLICT (file_name) DO NOTHING;
