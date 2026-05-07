-- 支持取消施工/取消完工
CREATE OR REPLACE FUNCTION add_construction_log(
  p_work_order_item_id UUID,
  p_mechanic_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item_status TEXT;
  v_work_order_id UUID;
  v_order_status TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_new_item_status TEXT;
BEGIN
  IF p_action NOT IN ('start', 'pause', 'resume', 'complete', 'cancel') THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的操作类型');
  END IF;
  SELECT status, work_order_id INTO v_item_status, v_work_order_id
  FROM work_order_items WHERE id = p_work_order_item_id FOR UPDATE;
  IF v_item_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '维修项目不存在');
  END IF;
  CASE p_action
    WHEN 'start' THEN
      IF v_item_status IN ('in_progress', 'completed') THEN
        RETURN jsonb_build_object('success', false, 'error', '项目已开始或已完工，不能重复开始');
      END IF;
      v_new_item_status := 'in_progress';
    WHEN 'resume' THEN
      IF v_item_status = 'in_progress' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目正在施工中，无需恢复');
      END IF;
      IF v_item_status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目已完工，不能恢复');
      END IF;
      v_new_item_status := 'in_progress';
    WHEN 'pause' THEN
      IF v_item_status != 'in_progress' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目未在施工中，不能中断');
      END IF;
      v_new_item_status := 'paused';
    WHEN 'complete' THEN
      IF v_item_status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目已完工，不能重复完工');
      END IF;
      v_new_item_status := 'completed';
    WHEN 'cancel' THEN
      IF v_item_status = 'completed' THEN
        -- 取消完工：保留日志，插入一条 start 恢复计时
        v_new_item_status := 'in_progress';
      ELSE
        -- 取消施工：删除所有施工日志，恢复为 pending
        DELETE FROM work_order_item_construction_logs WHERE work_order_item_id = p_work_order_item_id;
        v_new_item_status := 'pending';
      END IF;
  END CASE;

  -- 取消完工时插入 start 日志恢复计时；其他 cancel 不插入
  IF p_action != 'cancel' OR v_item_status = 'completed' THEN
    INSERT INTO work_order_item_construction_logs (
      work_order_item_id, mechanic_id, action, started_at, ended_at, duration_seconds, notes, created_at
    ) VALUES (
      p_work_order_item_id, p_mechanic_id,
      CASE WHEN p_action = 'cancel' AND v_item_status = 'completed' THEN 'start' ELSE p_action END,
      CASE WHEN p_action IN ('start', 'resume') OR (p_action = 'cancel' AND v_item_status = 'completed') THEN v_now ELSE NULL END,
      CASE WHEN p_action IN ('pause', 'complete') THEN v_now ELSE NULL END,
      NULL, NULL, v_now
    );
  END IF;

  UPDATE work_order_items SET status = v_new_item_status WHERE id = p_work_order_item_id;

  SELECT status INTO v_order_status FROM work_orders WHERE id = v_work_order_id;

  IF p_action IN ('start', 'resume') AND v_order_status = 'pending_repair' THEN
    UPDATE work_orders SET status = 'repairing', started_at = COALESCE(started_at, v_now)
    WHERE id = v_work_order_id;
  END IF;

  IF p_action = 'complete' AND NOT EXISTS (
    SELECT 1 FROM work_order_items WHERE work_order_id = v_work_order_id AND status != 'completed'
  ) THEN
    UPDATE work_orders SET status = 'pending_quality_check', completed_at = COALESCE(completed_at, v_now)
    WHERE id = v_work_order_id AND status IN ('repairing', 'pending_repair');
  END IF;

  RETURN jsonb_build_object('success', true, 'item_status', v_new_item_status);
END;
$$;
