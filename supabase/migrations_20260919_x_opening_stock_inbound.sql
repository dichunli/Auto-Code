/* ============================================================
 * 期初建账入库 RPC（2026-09-19，严谨性整改阶段二 · 任务12）
 *
 * 问题（诊断实锤）：
 *   新建配件 / 批量导入 / 入库登记新增模式 建的初始库存【没有批次行】——
 *   而领料强制指定 batch_id，这部分库存永远领不出；
 *   批次账天然小于总账，三方对账永远平不了；
 *   且这些入口都不写库存流水，初始库存从哪来的无据可查。
 *
 * 方案：统一走 opening_stock_inbound，一个事务完成：
 *   1. 总库存原子累加（锁配件行）
 *   2. 【必建】期初批次（batch_no 未传时自动生成"期初-YYYYMMDD"）——
 *      这是与 manual_part_inbound 的核心区别：期初库存必须可领
 *   3. 传了仓位同步写仓位账（无记录补建行）
 *   4. 写流水（inbound / reference_type='opening_stock' / 带操作人/仓位/批次/成本）
 *
 * 调用方（同一提交改造）：入库登记新增模式、库存管理新增配件、Excel 批量导入、
 *   以及阶段二任务13的配件新建/编辑表单。
 * 角色门禁：admin/boss/warehouse（与手工入库同口径）。
 * 幂等：新函数 CREATE OR REPLACE，可重跑。
 * ============================================================ */

CREATE OR REPLACE FUNCTION public.opening_stock_inbound(
  p_part_id UUID,
  p_qty INTEGER,
  p_unit_cost DECIMAL DEFAULT NULL,
  p_batch_no TEXT DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_after_qty INTEGER;
  v_loc TEXT;
  v_batch_id UUID;
  v_batch_no TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作入库');
  END IF;
  IF p_part_id IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '期初数量必须大于 0');
  END IF;

  /* 1. 锁配件并原子加总库存 */
  UPDATE parts SET quantity = quantity + p_qty
  WHERE id = p_part_id
  RETURNING quantity INTO v_after_qty;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件不存在');
  END IF;

  /* 2. 仓位账：传了仓库就写（无记录补建行） */
  IF p_warehouse_id IS NOT NULL THEN
    v_loc := COALESCE(NULLIF(TRIM(COALESCE(p_location, '')), ''), '');
    UPDATE public.part_stock_locations SET quantity = quantity + p_qty
    WHERE part_id = p_part_id AND warehouse_id = p_warehouse_id AND COALESCE(location, '') = v_loc;
    IF NOT FOUND THEN
      INSERT INTO public.part_stock_locations (part_id, warehouse_id, location, quantity)
      VALUES (p_part_id, p_warehouse_id, NULLIF(v_loc, ''), p_qty);
    END IF;
  END IF;

  /* 3. 必建期初批次（batch_no 未传自动生成）——期初库存必须可领 */
  v_batch_no := COALESCE(NULLIF(TRIM(COALESCE(p_batch_no, '')), ''), '期初-' || TO_CHAR(NOW(), 'YYYYMMDD'));
  INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost, inbound_type)
  VALUES (p_part_id, v_batch_no, p_qty, p_qty, COALESCE(p_unit_cost, 0), 'opening')
  RETURNING id INTO v_batch_id;

  /* 4. 流水（带操作人/仓位/批次/成本） */
  INSERT INTO inventory_logs (
    part_id, type, change_qty, before_qty, after_qty,
    reference_type, reference_id, operator_id,
    warehouse_id, location, batch_id, unit_cost, notes
  ) VALUES (
    p_part_id, 'inbound', p_qty, v_after_qty - p_qty, v_after_qty,
    'opening_stock', v_batch_id, auth.uid(),
    p_warehouse_id, NULLIF(TRIM(COALESCE(p_location, '')), ''),
    v_batch_id, p_unit_cost,
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), '期初建账入库')
  );

  RETURN jsonb_build_object('success', true, 'batch_id', v_batch_id, 'batch_no', v_batch_no,
                            'before_qty', v_after_qty - p_qty, 'after_qty', v_after_qty);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.opening_stock_inbound(uuid, integer, numeric, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opening_stock_inbound(uuid, integer, numeric, text, uuid, text, text) TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_x_opening_stock_inbound.sql') ON CONFLICT DO NOTHING;
