-- 修复施工管理功能：支持取消施工 + 创建统计表
-- 执行方式：复制全部内容，粘贴到 Supabase Dashboard 的 SQL Editor 中执行

-- ============================================
-- 1. 更新 add_construction_log 函数，支持 cancel 操作
-- ============================================
CREATE OR REPLACE FUNCTION add_construction_log(
  p_work_order_item_id UUID,
  p_mechanic_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item_status TEXT;
  v_work_order_id UUID;
  v_order_status TEXT;
  v_customer_opinion TEXT;
  v_mechanic_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_new_item_status TEXT;
BEGIN
  IF p_action NOT IN ('start', 'pause', 'resume', 'complete', 'cancel') THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的操作类型');
  END IF;

  SELECT status, work_order_id, customer_opinion, mechanic_id
    INTO v_item_status, v_work_order_id, v_customer_opinion, v_mechanic_id
  FROM work_order_items WHERE id = p_work_order_item_id FOR UPDATE;

  IF v_item_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '维修项目不存在');
  END IF;

  CASE p_action
    WHEN 'start' THEN
      IF v_item_status IN ('in_progress', 'completed') THEN
        RETURN jsonb_build_object('success', false, 'error', '项目已开始或已完工，不能重复开始');
      END IF;
      IF v_customer_opinion != 'agree' THEN
        RETURN jsonb_build_object('success', false, 'error', '需客户同意后才能施工');
      END IF;
      IF v_mechanic_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', '需先分配施工人');
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

-- ============================================
-- 2. 创建施工统计表
-- ============================================
DROP TABLE IF EXISTS work_order_item_construction_stats;

CREATE TABLE work_order_item_construction_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_item_id UUID NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL DEFAULT '',
  vehicle_brand TEXT,
  vehicle_series TEXT,
  vehicle_model_name TEXT,
  vehicle_displacement TEXT,
  vehicle_engine TEXT,
  vehicle_chassis TEXT,
  vehicle_transmission TEXT,
  mechanic_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  construction_seconds INTEGER DEFAULT 0,
  pause_seconds INTEGER DEFAULT 0,
  total_seconds INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_construction_stats_item ON work_order_item_construction_stats(work_order_item_id);
CREATE INDEX idx_construction_stats_order ON work_order_item_construction_stats(work_order_id);

ALTER TABLE work_order_item_construction_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_full_access" ON work_order_item_construction_stats
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
