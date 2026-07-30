/* ============================================================
 * 2026-07-31 待结单口径统一：唯一通道「全部派工 + 配件全出库」
 *
 * 背景（用户拍板）：原"通道A（全部完工+质检全合格 → 可结单）"不看配件出库，
 * 配件还欠着工单就进了待结单。现删除通道A，只保留唯一通道：
 *   labor 全部已派工 + 选中配件全部出库 + 工单非空（无配件时只看全部派工）。
 * 完工的项目必然已派工（add_construction_log 有派工门禁），不丢失正常流程。
 *
 * 同步改动 4 个函数（JS 侧 src/lib/orderStage.ts readyToClose 同口径）：
 * 1. fn_order_ready_to_close：删通道A，唯一通道判定
 * 2. add_construction_log：完工自动待结单加"配件全出库"门禁
 * 3. submit_item_qc：质检全合格自动待结单加"配件全出库"门禁
 * 4. transition_work_order：待结单拦截文案同步新口径
 *
 * 配件"先完工后出库"的顺序：完工/合格时配件未出齐 → 工单停在 repairing；
 * 配件出齐后列表"待结单"徽章实时亮起（显示态），点"确认结单"经
 * transition_work_order 校验通过即转入 pending_close（存储态）。
 * ============================================================ */

-- ── 1. fn_order_ready_to_close：唯一通道 ─────────────────────
CREATE OR REPLACE FUNCTION fn_order_ready_to_close(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_unassigned INT;    -- 未派工的 labor 项目数
  v_part_short INT;    -- 选中配件中出库不足的分支数
  v_has_content BOOLEAN;
BEGIN
  -- 未派工的 labor 项目数（mechanics 表或旧 mechanic_id 字段有其一即算已派工）
  SELECT COUNT(*) FILTER (WHERE item_type = 'labor'
      AND NOT EXISTS (SELECT 1 FROM work_order_item_mechanics m WHERE m.work_order_item_id = work_order_items.id)
      AND mechanic_id IS NULL)
  INTO v_unassigned
  FROM work_order_items
  WHERE work_order_id = p_order_id
    AND customer_opinion IS DISTINCT FROM 'reject';  -- 否决项目不参与（不阻塞结单）

  -- 选中配件出库不足的分支数（净出库 = 领料合计 - 退库合计）
  SELECT COUNT(*) INTO v_part_short
  FROM work_order_item_parts p
  JOIN work_order_items i ON i.id = p.work_order_item_id
  WHERE i.work_order_id = p_order_id
    AND p.is_selected
    AND COALESCE(p.quantity, 0) > 0
    AND COALESCE((SELECT SUM(q.quantity) FROM part_picking_records q WHERE q.work_order_item_part_id = p.id), 0)
      - COALESCE((SELECT SUM(r.quantity) FROM part_return_records r WHERE r.work_order_item_part_id = p.id), 0)
      < p.quantity;

  SELECT EXISTS (SELECT 1 FROM work_order_items WHERE work_order_id = p_order_id
                   AND customer_opinion IS DISTINCT FROM 'reject')
      OR EXISTS (
        SELECT 1 FROM work_order_item_parts p
        JOIN work_order_items i ON i.id = p.work_order_item_id
        WHERE i.work_order_id = p_order_id AND p.is_selected
      )
  INTO v_has_content;

  -- 唯一通道（2026-07-31 用户拍板）：labor 全部已派工 + 选中配件全部出库 + 工单非空。
  -- 无配件时 v_part_short = 0，只看全部派工。完工/质检不再是独立放行条件。
  RETURN v_unassigned = 0 AND v_part_short = 0 AND v_has_content;
END;
$$;

-- ── 2. add_construction_log：完工自动待结单加"配件全出库"门禁 ──
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
  v_stats RECORD;
  v_施工秒 INT;
  v_跨度秒 INT;
BEGIN
  IF p_action NOT IN ('start', 'pause', 'resume', 'complete', 'cancel') THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的操作类型');
  END IF;

  SELECT status, work_order_id, mechanic_id, customer_opinion INTO v_item
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

  -- 门禁：客户同意(agree)才能开始/恢复施工（未确认 pending、否决 reject 都拦截）
  IF p_action IN ('start', 'resume') AND v_item.customer_opinion <> 'agree' THEN
    RETURN jsonb_build_object('success', false, 'error', '客户还未同意该项目，不能开始施工');
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

  /* 全部 labor 项目完工时自动推进（只统计 labor；part 项与客户否决项不参与）：
   *   有须质检未合格项目 → pending_quality_check（待质检）
   *   全部不须质检 或 已全部合格 → 尝试 pending_close（待结单）
   * 2026-07-31：进待结单统一走 fn_order_ready_to_close（全部派工+配件全出库）——
   *   配件未出齐时不再自动推进，工单停在原状态，待出库完成后由列表"待结单"徽章引导手动结单 */
  IF p_action = 'complete' AND NOT EXISTS (
    SELECT 1 FROM work_order_items
    WHERE work_order_id = v_work_order_id AND item_type = 'labor' AND status <> 'completed'
      AND customer_opinion IS DISTINCT FROM 'reject'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM work_order_items
      WHERE work_order_id = v_work_order_id AND item_type = 'labor'
        AND require_qc AND qc_status <> 'passed'
        AND customer_opinion IS DISTINCT FROM 'reject'
    ) THEN
      UPDATE work_orders SET status = 'pending_quality_check', completed_at = COALESCE(completed_at, v_now)
      WHERE id = v_work_order_id AND status IN ('pending_diagnosis', 'pending_repair', 'repairing');
    ELSE
      UPDATE work_orders SET status = 'pending_close', completed_at = COALESCE(completed_at, v_now)
      WHERE id = v_work_order_id AND status IN ('pending_diagnosis', 'pending_repair', 'repairing')
        AND fn_order_ready_to_close(v_work_order_id);
      IF FOUND THEN
        INSERT INTO work_order_history (work_order_id, from_status, to_status, notes)
        VALUES (v_work_order_id, 'repairing', 'pending_close', '全部项目完工（无须质检）、配件已出齐，自动待结单');
      END IF;
    END IF;
  END IF;

  -- ══════════ 工时统计（construction_stats）搬入 RPC ══════════
  -- start/resume：为每个施工人建"进行中"统计行（已有在建行的技师不重复建，防 resume 重复）
  IF p_action IN ('start', 'resume') THEN
    SELECT
      COALESCE(i.alias_name, i.name) AS item_name,
      o.id AS order_id,
      COALESCE(vm.品牌, v.brand) AS brand,
      vm.车系 AS series,
      COALESCE(vm.车型, v.model) AS model_name,
      vm.排量 AS displacement,
      COALESCE(vm.发动机型号, v.engine_no) AS engine,
      v.vin AS chassis,
      vm.变速箱详情 AS transmission
    INTO v_stats
    FROM work_order_items i
    JOIN work_orders o ON o.id = i.work_order_id
    LEFT JOIN vehicles v ON v.id = o.vehicle_id
    LEFT JOIN vehicle_models vm ON vm.id = v.vehicle_model_id
    WHERE i.id = p_work_order_item_id;

    INSERT INTO work_order_item_construction_stats (
      work_order_item_id, work_order_id, item_name,
      vehicle_brand, vehicle_series, vehicle_model_name, vehicle_displacement,
      vehicle_engine, vehicle_chassis, vehicle_transmission,
      mechanic_name, status
    )
    SELECT p_work_order_item_id, v_stats.order_id, v_stats.item_name,
      v_stats.brand, v_stats.series, v_stats.model_name, v_stats.displacement,
      v_stats.engine, v_stats.chassis, v_stats.transmission,
      COALESCE(p.full_name, '未分配'), 'in_progress'
    FROM work_order_item_mechanics m
    LEFT JOIN profiles p ON p.id = m.mechanic_id
    WHERE m.work_order_item_id = p_work_order_item_id
      AND NOT EXISTS (
        SELECT 1 FROM work_order_item_construction_stats s
        WHERE s.work_order_item_id = p_work_order_item_id
          AND s.mechanic_name = COALESCE(p.full_name, '未分配')
          AND s.status = 'in_progress'
      );

    -- 无派工记录（旧数据 mechanic_id 兜底）：为操作人建行
    IF NOT EXISTS (SELECT 1 FROM work_order_item_mechanics WHERE work_order_item_id = p_work_order_item_id) THEN
      INSERT INTO work_order_item_construction_stats (
        work_order_item_id, work_order_id, item_name,
        vehicle_brand, vehicle_series, vehicle_model_name, vehicle_displacement,
        vehicle_engine, vehicle_chassis, vehicle_transmission,
        mechanic_name, status
      )
      SELECT p_work_order_item_id, v_stats.order_id, v_stats.item_name,
        v_stats.brand, v_stats.series, v_stats.model_name, v_stats.displacement,
        v_stats.engine, v_stats.chassis, v_stats.transmission,
        COALESCE((SELECT full_name FROM profiles WHERE id = p_mechanic_id), '未分配'), 'in_progress'
      WHERE NOT EXISTS (
        SELECT 1 FROM work_order_item_construction_stats s
        WHERE s.work_order_item_id = p_work_order_item_id AND s.status = 'in_progress'
      );
    END IF;
  END IF;

  -- complete：结算统计行（秒数从施工日志用窗口函数配对 start/resume→pause/complete 计算）
  IF p_action = 'complete' THEN
    WITH ordered AS (
      SELECT action, created_at,
        LEAD(created_at) OVER (ORDER BY created_at) AS next_at,
        LEAD(action) OVER (ORDER BY created_at) AS next_action
      FROM work_order_item_construction_logs
      WHERE work_order_item_id = p_work_order_item_id
    )
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(next_at, v_now) - created_at))), 0)::INT
    INTO v_施工秒
    FROM ordered
    WHERE action IN ('start', 'resume') AND (next_action IN ('pause', 'complete') OR next_action IS NULL);

    SELECT EXTRACT(EPOCH FROM (
      MAX(created_at) FILTER (WHERE action = 'complete') -
      MIN(created_at) FILTER (WHERE action IN ('start', 'resume'))
    ))::INT INTO v_跨度秒
    FROM work_order_item_construction_logs
    WHERE work_order_item_id = p_work_order_item_id;

    UPDATE work_order_item_construction_stats
    SET status = 'completed',
        construction_seconds = v_施工秒,
        pause_seconds = GREATEST(0, COALESCE(v_跨度秒, 0) - v_施工秒),
        total_seconds = GREATEST(0, COALESCE(v_跨度秒, 0)),
        completed_at = v_now,
        updated_at = v_now
    WHERE work_order_item_id = p_work_order_item_id AND status = 'in_progress';
  END IF;

  -- cancel：取消施工→删在建统计行；取消完工→恢复在建
  IF p_action = 'cancel' THEN
    IF v_item.status = 'completed' THEN
      UPDATE work_order_item_construction_stats
      SET status = 'in_progress', completed_at = NULL, updated_at = v_now
      WHERE work_order_item_id = p_work_order_item_id AND status = 'completed';
    ELSE
      DELETE FROM work_order_item_construction_stats
      WHERE work_order_item_id = p_work_order_item_id AND status = 'in_progress';
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'item_status', v_new_item_status);
END;
$$;

-- ── 3. submit_item_qc：质检全合格自动待结单加"配件全出库"门禁 ──
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

    /* 规则7：全部 labor 完工且须质检全部合格 → 尝试自动待结单（否决项目不参与）
     * 2026-07-31：统一走 fn_order_ready_to_close（全部派工+配件全出库）——
     *   配件未出齐时不再自动推进，待出库完成后由列表"待结单"徽章引导手动结单 */
    IF NOT EXISTS (
      SELECT 1 FROM work_order_items
      WHERE work_order_id = v_item.work_order_id AND item_type = 'labor'
        AND (status <> 'completed' OR (require_qc AND qc_status <> 'passed'))
        AND customer_opinion IS DISTINCT FROM 'reject'
    ) THEN
      UPDATE work_orders SET status = 'pending_close'
      WHERE id = v_item.work_order_id AND status IN ('repairing', 'pending_quality_check')
        AND fn_order_ready_to_close(v_item.work_order_id);
      IF FOUND THEN
        INSERT INTO work_order_history (work_order_id, from_status, to_status, notes)
        VALUES (v_item.work_order_id, 'repairing', 'pending_close', '全部项目质检合格、配件已出齐，自动待结单');
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

-- ── 4. transition_work_order：待结单拦截文案同步新口径 ──
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
  -- 待结单校验（唯一通道 2026-07-31：全部派工 + 配件全出库）
  IF p_next_status = 'pending_close' AND NOT fn_order_ready_to_close(p_order_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '尚不满足结单条件：维修项目未全部派工，或选中配件未全部出库');
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
