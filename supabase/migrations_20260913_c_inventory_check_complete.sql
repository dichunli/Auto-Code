/* ============================================================
 * 盘点闭环：完成盘点事务函数（2026-09-13，用户拍板保留盘点功能）
 *
 * 背景（诊断 P0-e）：盘点功能此前是半成品——能开单但永远结束不了：
 * 没有任何代码把差异写回库存（盘了等于没盘）、没有任何代码把状态改成
 * completed（"已完成"是到不了的状态）。
 *
 * 本函数把「按差异校准库存 → 写流水 → 单据闭环」收进一个事务：
 * - 锁单防重复完成
 * - 逐条按实盘数校准（实盘数就是货架真实数量，直接设为校准值；
 *   先锁行取当前值再写，流水前后数量并发下也准确）
 * - 流水 type='check_adjust'，reference 指回盘点单，可追溯
 * ============================================================ */

/* 完成时间列（幂等，重复执行不报错） */
ALTER TABLE public.inventory_checks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION complete_inventory_check(p_check_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check RECORD;
  v_item RECORD;
  v_before INTEGER;
  v_adjust_count INTEGER := 0;
BEGIN
  /* 必须已登录（SECURITY DEFINER 绕过 RLS，身份在此兜底） */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  /* 锁单防并发重复完成 */
  SELECT * INTO v_check FROM inventory_checks WHERE id = p_check_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '盘点单不存在');
  END IF;
  IF v_check.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', '该盘点单已完成，不能重复操作');
  END IF;

  /* 逐条校准：只处理填了实盘数的行（未填的行视为不在本次盘点范围） */
  FOR v_item IN
    SELECT * FROM inventory_check_items
    WHERE check_id = p_check_id AND actual_qty IS NOT NULL
    ORDER BY part_id
  LOOP
    SELECT quantity INTO v_before FROM parts WHERE id = v_item.part_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    /* 与当前库存一致就不动（不写流水，避免刷屏） */
    IF v_before IS DISTINCT FROM v_item.actual_qty THEN
      UPDATE parts SET quantity = v_item.actual_qty WHERE id = v_item.part_id;

      INSERT INTO inventory_logs
        (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, operator_id, notes)
      VALUES (
        v_item.part_id, 'check_adjust', v_item.actual_qty - v_before, v_before, v_item.actual_qty,
        'inventory_check', p_check_id, auth.uid(),
        CONCAT('盘点校准（单号: ', COALESCE(v_check.check_no, '无'), '）',
               CASE WHEN v_item.notes IS NOT NULL THEN CONCAT(' ', v_item.notes) ELSE '' END)
      );
      v_adjust_count := v_adjust_count + 1;
    END IF;
  END LOOP;

  UPDATE inventory_checks SET status = 'completed', completed_at = NOW() WHERE id = p_check_id;

  RETURN jsonb_build_object('success', true, 'adjusted', v_adjust_count);
END;
$$ LANGUAGE plpgsql;
