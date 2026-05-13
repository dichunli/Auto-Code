-- 扩展 add_construction_log RPC 的工单状态联动范围
-- 原逻辑只在工单 status='pending_repair' 时联动跳到 repairing
-- 新逻辑：pending_diagnosis 也能跳，避免工单状态卡在"待诊断"
--
-- 同时扩大完工后跳到 pending_quality_check 的条件，让 pending_diagnosis 也能联动

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
        v_new_item_status := 'in_progress';
      ELSE
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

  -- 【扩展】开始/恢复施工时，工单是 pending_diagnosis 或 pending_repair 都自动跳到 repairing
  IF p_action IN ('start', 'resume') AND v_order_status IN ('pending_diagnosis', 'pending_repair') THEN
    UPDATE work_orders SET status = 'repairing', started_at = COALESCE(started_at, v_now)
    WHERE id = v_work_order_id;
  END IF;

  -- 【扩展】所有项目完工时，工单是 pending_diagnosis/pending_repair/repairing 都自动跳到 pending_quality_check
  IF p_action = 'complete' AND NOT EXISTS (
    SELECT 1 FROM work_order_items WHERE work_order_id = v_work_order_id AND status != 'completed'
  ) THEN
    UPDATE work_orders SET status = 'pending_quality_check', completed_at = COALESCE(completed_at, v_now)
    WHERE id = v_work_order_id AND status IN ('pending_diagnosis', 'pending_repair', 'repairing');
  END IF;

  RETURN jsonb_build_object('success', true, 'item_status', v_new_item_status);
END;
$$;
