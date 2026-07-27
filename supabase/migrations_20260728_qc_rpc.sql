-- ============================================================
-- 工单状态体系 - 第3步：质检流程与状态流转（RPC 改造）
-- 日期：2026-07-28
--
-- 内容：
-- 1. fn_order_ready_to_close：待结单判定（双通道，与前端 src/lib/orderStage.ts 同口径）
-- 2. submit_item_qc：项目级质检（合格/不合格 + 质检单 + 媒体 + 积分 + 状态联动）
-- 3. add_construction_log 改写：计时权限校验（约束1）、完工重置质检、只统计 labor、
--    按"是否须质检"分流推进（待质检 或 直接待结单）
-- 4. transition_work_order 改写：待结单校验、删除手动"提交质检"分支（质检下沉项目级）
-- ============================================================

-- ── 1. 待结单判定（SQL 版，与前端 orderStage.ts readyToClose 保持同步）──
CREATE OR REPLACE FUNCTION fn_order_ready_to_close(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_labor_total INT;
  v_labor_completed INT;
  v_qc_pending INT;    -- 须质检但未合格的项目数
  v_unassigned INT;    -- 未派工的 labor 项目数
  v_part_short INT;    -- 选中配件中出库不足的分支数
  v_has_content BOOLEAN;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE item_type = 'labor'),
    COUNT(*) FILTER (WHERE item_type = 'labor' AND status = 'completed'),
    COUNT(*) FILTER (WHERE item_type = 'labor' AND require_qc AND qc_status <> 'passed'),
    COUNT(*) FILTER (WHERE item_type = 'labor'
      AND NOT EXISTS (SELECT 1 FROM work_order_item_mechanics m WHERE m.work_order_item_id = work_order_items.id)
      AND mechanic_id IS NULL)
  INTO v_labor_total, v_labor_completed, v_qc_pending, v_unassigned
  FROM work_order_items
  WHERE work_order_id = p_order_id;

  -- 通道A（正常流程）：labor 项目非空、全部完工、须质检项目全部合格
  IF v_labor_total > 0 AND v_labor_completed = v_labor_total AND v_qc_pending = 0 THEN
    RETURN true;
  END IF;

  -- 通道B（快速通道，约束3）：labor 全部已派工、选中配件全部出库完成、工单非空
  SELECT COUNT(*) INTO v_part_short
  FROM work_order_item_parts p
  JOIN work_order_items i ON i.id = p.work_order_item_id
  WHERE i.work_order_id = p_order_id
    AND p.is_selected
    AND COALESCE(p.quantity, 0) > 0
    AND COALESCE((SELECT SUM(q.quantity) FROM part_picking_records q WHERE q.work_order_item_part_id = p.id), 0)
      - COALESCE((SELECT SUM(r.quantity) FROM part_return_records r WHERE r.work_order_item_part_id = p.id), 0)
      < p.quantity;

  SELECT EXISTS (SELECT 1 FROM work_order_items WHERE work_order_id = p_order_id)
      OR EXISTS (
        SELECT 1 FROM work_order_item_parts p
        JOIN work_order_items i ON i.id = p.work_order_item_id
        WHERE i.work_order_id = p_order_id AND p.is_selected
      )
  INTO v_has_content;

  IF v_unassigned = 0 AND v_part_short = 0 AND v_has_content THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- ── 2. 项目级质检 RPC ──
-- 规则：仅质检人本人可操作（用户拍板，管理角色也不代操作）；
-- 合格 → qc_status=passed，全部合格自动待结单（规则7）；
-- 不合格 → 回待施工（规则6）+ 必填原因 + 施工技师扣积分（返工统计/晋级用）
CREATE OR REPLACE FUNCTION submit_item_qc(
  p_work_order_item_id UUID,
  p_result TEXT,
  p_notes TEXT DEFAULT NULL,
  p_media JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item RECORD;
  v_operator UUID := auth.uid();
  v_log_id UUID;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_result NOT IN ('passed', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的质检结果');
  END IF;
  IF p_result = 'failed' AND (p_notes IS NULL OR btrim(p_notes) = '') THEN
    RETURN jsonb_build_object('success', false, 'error', '质检不合格必须填写原因');
  END IF;

  SELECT id, work_order_id, status, require_qc, inspector_id, mechanic_id
  INTO v_item
  FROM work_order_items WHERE id = p_work_order_item_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '维修项目不存在');
  END IF;

  -- 约束2：项目已派工（mechanics 表或旧 mechanic_id 字段）才能质检
  IF NOT EXISTS (SELECT 1 FROM work_order_item_mechanics WHERE work_order_item_id = p_work_order_item_id)
     AND v_item.mechanic_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '项目未派工，不能质检');
  END IF;

  IF v_item.status <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', '项目未完工，不能质检');
  END IF;

  IF NOT v_item.require_qc THEN
    RETURN jsonb_build_object('success', false, 'error', '该项目未开启必须质检，完工即为已完工');
  END IF;

  -- 仅质检人本人可操作
  IF v_item.inspector_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请先指派质检人');
  END IF;
  IF v_operator IS NULL OR v_item.inspector_id <> v_operator THEN
    RETURN jsonb_build_object('success', false, 'error', '仅质检人本人可以操作质检');
  END IF;

  -- 写质检单（每次质检一张单，可附图片/视频凭证）
  INSERT INTO work_order_item_qc_logs (work_order_item_id, inspector_id, result, notes, created_at)
  VALUES (p_work_order_item_id, v_operator, p_result, NULLIF(btrim(COALESCE(p_notes, '')), ''), v_now)
  RETURNING id INTO v_log_id;

  -- 写质检单媒体（p_media 格式：[{"media_type":"image","storage_path":"..."}]）
  INSERT INTO work_order_item_qc_media (qc_log_id, media_type, storage_path)
  SELECT v_log_id, m ->> 'media_type', m ->> 'storage_path'
  FROM jsonb_array_elements(p_media) AS m
  WHERE m ->> 'media_type' IN ('image', 'video')
    AND COALESCE(m ->> 'storage_path', '') <> '';

  IF p_result = 'passed' THEN
    UPDATE work_order_items SET qc_status = 'passed' WHERE id = p_work_order_item_id;

    -- 规则7：全部 labor 完工且须质检全部合格 → 工单自动待结单
    IF NOT EXISTS (
      SELECT 1 FROM work_order_items
      WHERE work_order_id = v_item.work_order_id AND item_type = 'labor'
        AND (status <> 'completed' OR (require_qc AND qc_status <> 'passed'))
    ) THEN
      UPDATE work_orders SET status = 'pending_close'
      WHERE id = v_item.work_order_id AND status IN ('repairing', 'pending_quality_check');
      IF FOUND THEN
        INSERT INTO work_order_history (work_order_id, from_status, to_status, notes)
        VALUES (v_item.work_order_id, 'repairing', 'pending_close', '全部项目质检合格，自动待结单');
      END IF;
    END IF;
  ELSE
    -- 不合格：项目回待施工（规则6），质检结果标记 failed（重新完工时重置为 none）
    UPDATE work_order_items SET qc_status = 'failed', status = 'pending'
    WHERE id = p_work_order_item_id;

    -- 工单回退维修中（返工）
    UPDATE work_orders SET status = 'repairing'
    WHERE id = v_item.work_order_id AND status IN ('pending_quality_check', 'pending_close');

    -- 施工技师每人扣 5 分（沿用原 quality_fail 分值；返工次数统计/晋级考核用）
    INSERT INTO mechanic_scores (mechanic_id, work_order_id, score_type, points, notes)
    SELECT m.mechanic_id, v_item.work_order_id, 'quality_fail', -5,
           '质检不合格返工：' || LEFT(COALESCE(p_notes, ''), 100)
    FROM work_order_item_mechanics m
    WHERE m.work_order_item_id = p_work_order_item_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'qc_log_id', v_log_id);
END;
$$;

-- ── 3. add_construction_log 改写 ──
-- 变更点：
-- a. 约束1：项目已派工才能计时；操作人须为施工人本人或 admin/boss/receptionist
-- b. complete 时重置 qc_status='none'（重新完工后可再次质检，形成闭环）
-- c. 完工自动推进只统计 labor 项目（原 bug：part 项永远 pending 导致永不触发）
-- d. 全部 labor 完工后按"是否须质检"分流：有须质检未检 → pending_quality_check（待质检）；
--    全部不须质检或已合格 → 直接 pending_close（待结单）
CREATE OR REPLACE FUNCTION add_construction_log(
  p_work_order_item_id UUID,
  p_mechanic_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item RECORD;
  v_work_order_id UUID;
  v_order_status TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_new_item_status TEXT;
  v_已派工 BOOLEAN;
  v_本人施工 BOOLEAN;
  v_管理角色 BOOLEAN;
BEGIN
  IF p_action NOT IN ('start', 'pause', 'resume', 'complete', 'cancel') THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的操作类型');
  END IF;

  SELECT status, work_order_id, mechanic_id INTO v_item
  FROM work_order_items WHERE id = p_work_order_item_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '维修项目不存在');
  END IF;
  v_work_order_id := v_item.work_order_id;

  -- 约束1-1：项目已派工才能操作计时（mechanics 表 或 旧 mechanic_id 字段）
  v_已派工 := EXISTS (SELECT 1 FROM work_order_item_mechanics WHERE work_order_item_id = p_work_order_item_id)
              OR v_item.mechanic_id IS NOT NULL;
  IF NOT v_已派工 THEN
    RETURN jsonb_build_object('success', false, 'error', '项目未派工，不能操作计时');
  END IF;

  -- 约束1-2：操作人须为施工人本人（在派工名单内）或管理角色（admin/boss/receptionist）
  v_本人施工 := EXISTS (
    SELECT 1 FROM work_order_item_mechanics
    WHERE work_order_item_id = p_work_order_item_id AND mechanic_id = p_mechanic_id
  ) OR v_item.mechanic_id = p_mechanic_id;
  v_管理角色 := EXISTS (
    SELECT 1 FROM profile_roles pr JOIN roles r ON r.id = pr.role_id
    WHERE pr.profile_id = p_mechanic_id AND r.name IN ('admin', 'boss', 'receptionist')
  );
  IF NOT v_本人施工 AND NOT v_管理角色 THEN
    RETURN jsonb_build_object('success', false, 'error', '仅施工人本人或管理人员可操作计时');
  END IF;

  CASE p_action
    WHEN 'start' THEN
      IF v_item.status IN ('in_progress', 'completed') THEN
        RETURN jsonb_build_object('success', false, 'error', '项目已开始或已完工，不能重复开始');
      END IF;
      v_new_item_status := 'in_progress';
    WHEN 'resume' THEN
      IF v_item.status = 'in_progress' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目正在施工中，无需恢复');
      END IF;
      IF v_item.status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目已完工，不能恢复');
      END IF;
      v_new_item_status := 'in_progress';
    WHEN 'pause' THEN
      IF v_item.status <> 'in_progress' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目未在施工中，不能中断');
      END IF;
      v_new_item_status := 'paused';
    WHEN 'complete' THEN
      IF v_item.status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目已完工，不能重复完工');
      END IF;
      v_new_item_status := 'completed';
    WHEN 'cancel' THEN
      IF v_item.status = 'completed' THEN
        v_new_item_status := 'in_progress';
      ELSE
        DELETE FROM work_order_item_construction_logs WHERE work_order_item_id = p_work_order_item_id;
        v_new_item_status := 'pending';
      END IF;
  END CASE;

  -- 取消完工时插入 start 日志恢复计时；其他 cancel 不插入
  IF p_action != 'cancel' OR v_item.status = 'completed' THEN
    INSERT INTO work_order_item_construction_logs (
      work_order_item_id, mechanic_id, action, started_at, ended_at, duration_seconds, notes, created_at
    ) VALUES (
      p_work_order_item_id, p_mechanic_id,
      CASE WHEN p_action = 'cancel' AND v_item.status = 'completed' THEN 'start' ELSE p_action END,
      CASE WHEN p_action IN ('start', 'resume') OR (p_action = 'cancel' AND v_item.status = 'completed') THEN v_now ELSE NULL END,
      CASE WHEN p_action IN ('pause', 'complete') THEN v_now ELSE NULL END,
      NULL, NULL, v_now
    );
  END IF;

  -- 完工时重置质检结果为 none：须质检项目进入"待质检"，
  -- 质检不合格返工后重新完工也可再次质检（闭环）
  IF p_action = 'complete' THEN
    UPDATE work_order_items SET status = v_new_item_status, qc_status = 'none'
    WHERE id = p_work_order_item_id;
  ELSE
    UPDATE work_order_items SET status = v_new_item_status WHERE id = p_work_order_item_id;
  END IF;

  SELECT status INTO v_order_status FROM work_orders WHERE id = v_work_order_id;

  -- 开始/恢复施工时，工单 pending_diagnosis/pending_repair 自动跳到 repairing
  IF p_action IN ('start', 'resume') AND v_order_status IN ('pending_diagnosis', 'pending_repair') THEN
    UPDATE work_orders SET status = 'repairing', started_at = COALESCE(started_at, v_now)
    WHERE id = v_work_order_id;
  END IF;

  -- 全部 labor 项目完工时自动推进（只统计 labor；part 项不参与）：
  --   有须质检未合格项目 → pending_quality_check（待质检）
  --   全部不须质检 或 已全部合格 → 直接 pending_close（待结单）
  IF p_action = 'complete' AND NOT EXISTS (
    SELECT 1 FROM work_order_items
    WHERE work_order_id = v_work_order_id AND item_type = 'labor' AND status <> 'completed'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM work_order_items
      WHERE work_order_id = v_work_order_id AND item_type = 'labor'
        AND require_qc AND qc_status <> 'passed'
    ) THEN
      UPDATE work_orders SET status = 'pending_quality_check', completed_at = COALESCE(completed_at, v_now)
      WHERE id = v_work_order_id AND status IN ('pending_diagnosis', 'pending_repair', 'repairing');
    ELSE
      UPDATE work_orders SET status = 'pending_close', completed_at = COALESCE(completed_at, v_now)
      WHERE id = v_work_order_id AND status IN ('pending_diagnosis', 'pending_repair', 'repairing');
      IF FOUND THEN
        INSERT INTO work_order_history (work_order_id, from_status, to_status, notes)
        VALUES (v_work_order_id, 'repairing', 'pending_close', '全部项目完工（无须质检），自动待结单');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'item_status', v_new_item_status);
END;
$$;

-- ── 4. transition_work_order 改写 ──
-- 变更点：
-- a. repairing 可直达 pending_close（新）；删除手动 repairing → pending_quality_check
--    （工单级"提交质检"按钮取消，质检下沉到项目级）
-- b. 进 pending_close 前校验 fn_order_ready_to_close（双通道）
CREATE OR REPLACE FUNCTION transition_work_order(
  p_order_id UUID,
  p_next_status TEXT,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_order RECORD;
  v_valid_flow TEXT[];
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_order FROM work_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '工单不存在');
  END IF;
  IF v_order.status IN ('settled', 'delivered') THEN
    RETURN jsonb_build_object('success', false, 'error', '工单已结束，不能变更状态');
  END IF;
  v_valid_flow := CASE v_order.status
    WHEN 'received' THEN ARRAY['pending_diagnosis']
    WHEN 'pending_diagnosis' THEN ARRAY['pending_repair']
    WHEN 'pending_repair' THEN ARRAY['repairing']
    WHEN 'repairing' THEN ARRAY['pending_close']
    WHEN 'pending_quality_check' THEN ARRAY['pending_close', 'repairing']
    WHEN 'pending_close' THEN ARRAY['pending_settlement']
    WHEN 'pending_settlement' THEN ARRAY['settled']
    WHEN 'settled' THEN ARRAY['delivered']
    ELSE ARRAY[]::TEXT[]
  END;
  IF NOT (p_next_status = ANY(v_valid_flow)) THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的状态流转: ' || v_order.status || ' -> ' || p_next_status);
  END IF;
  -- 待结单校验：全部完工且须质检全合格，或满足快速通道（全部派工+配件全出库）
  IF p_next_status = 'pending_close' AND NOT fn_order_ready_to_close(p_order_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '尚不满足结单条件：项目未全部完工/质检未全部合格，且未满足快速结单（全部派工+配件全出库）');
  END IF;
  UPDATE work_orders
  SET status = p_next_status::work_order_status,
      started_at = CASE WHEN p_next_status = 'repairing' AND started_at IS NULL THEN v_now ELSE started_at END,
      completed_at = CASE WHEN p_next_status IN ('pending_quality_check', 'pending_close') AND completed_at IS NULL THEN v_now ELSE completed_at END,
      settled_at = CASE WHEN p_next_status = 'pending_settlement' AND settled_at IS NULL THEN v_now ELSE settled_at END,
      delivered_at = CASE WHEN p_next_status = 'delivered' AND delivered_at IS NULL THEN v_now ELSE delivered_at END
  WHERE id = p_order_id;
  INSERT INTO work_order_history (work_order_id, from_status, to_status, notes)
  VALUES (p_order_id, v_order.status, p_next_status, COALESCE(p_notes, '状态流转'));
  RETURN jsonb_build_object('success', true);
END;
$$;
