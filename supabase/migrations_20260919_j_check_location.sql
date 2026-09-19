/* ============================================================
 * 按仓位盘点（2026-09-19 用户拍板：全部出入库都记仓位，方便随时盘点）
 * 背景：盘点只到配件总数，不动 part_stock_locations，仓位账永远对不上。
 * 改动：
 *   1. inventory_check_items 加 warehouse_id（外键 warehouses）+ location，
 *      盘点明细 = 每个"配件×仓位"一行（无仓位记录的配件算"未分配仓位"一行）
 *   2. complete_inventory_check 重写：
 *      a. 填了实盘的仓位行 → 仓位库存直接校准为实盘数（无记录且实盘>0 补建行）
 *      b. 该配件全部明细都填了实盘 → 总库存校准为各行实盘之和，写流水
 *      c. 流水类型用 'adjust'（原 'check_adjust' 违反 inventory_logs 的
 *         CHECK 约束，完成盘点必报错——本迁移顺带修复这个潜伏 bug）
 * 兼容：旧盘点单明细（warehouse_id 为 NULL，每配件一行）按 (b) 逻辑同样校准。
 * 幂等：ADD COLUMN IF NOT EXISTS + DO 块判重 + CREATE OR REPLACE（参数未变），可重跑。
 * ============================================================ */

ALTER TABLE public.inventory_check_items ADD COLUMN IF NOT EXISTS warehouse_id UUID;
ALTER TABLE public.inventory_check_items ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN public.inventory_check_items.warehouse_id IS '盘点仓位所属仓库（NULL=未分配仓位的库存）';
COMMENT ON COLUMN public.inventory_check_items.location IS '盘点仓位';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_check_items_warehouse_id_fkey'
  ) THEN
    ALTER TABLE public.inventory_check_items
      ADD CONSTRAINT inventory_check_items_warehouse_id_fkey
      FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);
  END IF;
END $$;

/* ─── complete_inventory_check：按仓位校准 + 按配件校准总库存 ─── */
CREATE OR REPLACE FUNCTION public.complete_inventory_check(p_check_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_check RECORD;
  v_item RECORD;
  v_part RECORD;
  v_before INTEGER;
  v_adjust_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  SELECT * INTO v_check FROM inventory_checks WHERE id = p_check_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '盘点单不存在');
  END IF;
  IF v_check.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', '该盘点单已完成，不能重复操作');
  END IF;

  /* 一、逐条仓位行校准仓位库存（只处理填了实盘、且带仓位的行） */
  FOR v_item IN
    SELECT * FROM inventory_check_items
    WHERE check_id = p_check_id AND actual_qty IS NOT NULL AND warehouse_id IS NOT NULL
  LOOP
    UPDATE part_stock_locations SET quantity = v_item.actual_qty
    WHERE part_id = v_item.part_id
      AND warehouse_id = v_item.warehouse_id
      AND COALESCE(location, '') = COALESCE(v_item.location, '');
    IF NOT FOUND AND v_item.actual_qty > 0 THEN
      INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity)
      VALUES (v_item.part_id, v_item.warehouse_id, v_item.location, v_item.actual_qty);
    END IF;
  END LOOP;

  /* 二、按配件校准总库存：该配件的全部明细行都填了实盘才校准
        （防止只盘了一个仓位就把另一个仓位的库存抹掉）；
        总库存 = 该配件所有明细行实盘之和（仓位行 + 未分配仓位行） */
  FOR v_part IN
    SELECT part_id, SUM(actual_qty) AS 实盘合计
    FROM inventory_check_items
    WHERE check_id = p_check_id
    GROUP BY part_id
    HAVING COUNT(*) FILTER (WHERE actual_qty IS NULL) = 0
  LOOP
    SELECT quantity INTO v_before FROM parts WHERE id = v_part.part_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_before IS DISTINCT FROM v_part.实盘合计 THEN
      UPDATE parts SET quantity = v_part.实盘合计 WHERE id = v_part.part_id;

      INSERT INTO inventory_logs
        (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, operator_id, notes)
      VALUES (
        v_part.part_id, 'adjust', v_part.实盘合计 - v_before, v_before, v_part.实盘合计,
        'inventory_check', p_check_id, auth.uid(),
        CONCAT('盘点校准（单号: ', COALESCE(v_check.check_no, '无'), '）')
      );
      v_adjust_count := v_adjust_count + 1;
    END IF;
  END LOOP;

  UPDATE inventory_checks SET status = 'completed', completed_at = NOW() WHERE id = p_check_id;

  RETURN jsonb_build_object('success', true, 'adjusted', v_adjust_count);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_inventory_check(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_inventory_check(uuid) TO authenticated;

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260919_j_check_location.sql', '按仓位盘点：明细加仓位维度，完成时仓位+总库存双层校准(顺带修流水类型约束bug)')
ON CONFLICT (file_name) DO NOTHING;
