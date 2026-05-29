/* ============================================================
   员工培训晋级系统 - 阶段三迁移
   1. 新建 promotion_rules 晋级规则表
   2. 新建 promotion_records 晋级/降级记录表
   3. 创建晋级条件检查函数
   ============================================================ */

/* -----------------------------------------------------------
   1. 晋级规则表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS promotion_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_level_id UUID REFERENCES mechanic_levels(id) ON DELETE CASCADE,
  to_level_id UUID NOT NULL REFERENCES mechanic_levels(id) ON DELETE CASCADE,
  min_course_points INTEGER DEFAULT 0,
  min_work_orders INTEGER DEFAULT 0,
  max_rework_loss DECIMAL(10,2) DEFAULT 0,
  max_daily_loss DECIMAL(10,2) DEFAULT 0,
  min_behavior_score INTEGER DEFAULT 0,
  exam_pass_required BOOLEAN DEFAULT TRUE,
  period_months INTEGER DEFAULT 6,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_from_level ON promotion_rules(from_level_id);
CREATE INDEX IF NOT EXISTS idx_promotion_to_level ON promotion_rules(to_level_id);

/* -----------------------------------------------------------
   2. 晋级/降级记录表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS promotion_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('promotion','demotion')),
  from_level_id UUID REFERENCES mechanic_levels(id),
  to_level_id UUID REFERENCES mechanic_levels(id),
  reason TEXT NOT NULL,
  course_points INTEGER DEFAULT 0,
  work_order_count INTEGER DEFAULT 0,
  rework_loss_total DECIMAL(10,2) DEFAULT 0,
  daily_loss_total DECIMAL(10,2) DEFAULT 0,
  behavior_score_total INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_rec_employee ON promotion_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_promotion_rec_created_at ON promotion_records(created_at);

/* -----------------------------------------------------------
   3. RLS 策略
   ----------------------------------------------------------- */
ALTER TABLE promotion_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full_access" ON promotion_rules;
CREATE POLICY "auth_full_access" ON promotion_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_access" ON promotion_records;
CREATE POLICY "auth_full_access" ON promotion_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

/* -----------------------------------------------------------
   4. 晋级条件检查函数
   ----------------------------------------------------------- */
CREATE OR REPLACE FUNCTION check_promotion_eligibility(
  p_employee_id UUID,
  p_target_level_id UUID
) RETURNS TABLE (
  eligible BOOLEAN,
  current_level_id UUID,
  course_points INTEGER,
  work_order_count INTEGER,
  rework_loss_total DECIMAL,
  daily_loss_total DECIMAL,
  behavior_score_total INTEGER,
  exam_all_passed BOOLEAN,
  missing_items TEXT[]
) AS $$
DECLARE
  v_rule RECORD;
  v_period_start TIMESTAMPTZ;
  v_current_level_id UUID;
  v_course_points INTEGER := 0;
  v_work_order_count INTEGER := 0;
  v_rework_loss_total DECIMAL(10,2) := 0;
  v_daily_loss_total DECIMAL(10,2) := 0;
  v_behavior_score_total INTEGER := 0;
  v_exam_all_passed BOOLEAN := TRUE;
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_pending_exams INTEGER := 0;
BEGIN
  /* 查找对应的晋级规则 */
  SELECT * INTO v_rule
  FROM promotion_rules
  WHERE to_level_id = p_target_level_id
    AND is_active = TRUE
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_rule IS NULL THEN
    eligible := FALSE;
    missing_items := ARRAY['未找到对应的晋级规则'];
    RETURN NEXT;
    RETURN;
  END IF;

  /* 获取员工当前等级 */
  SELECT mechanic_level_id INTO v_current_level_id
  FROM profiles
  WHERE id = p_employee_id;

  /* 检查起始等级是否匹配 */
  IF v_rule.from_level_id IS NOT NULL AND v_rule.from_level_id <> v_current_level_id THEN
    eligible := FALSE;
    missing_items := ARRAY['当前等级不符合晋级要求'];
    RETURN NEXT;
    RETURN;
  END IF;

  /* 计算考察期起始时间 */
  v_period_start := NOW() - (v_rule.period_months || ' months')::INTERVAL;

  /* 1. 课程积分（已完成且通过考试的分配记录） */
  SELECT COALESCE(SUM(tc.points), 0) INTO v_course_points
  FROM training_assignments ta
  JOIN training_courses tc ON tc.id = ta.course_id
  WHERE ta.employee_id = p_employee_id
    AND ta.status = 'completed'
    AND ta.completed_at >= v_period_start;

  /* 2. 工单数量（员工作为施工人的工单） */
  SELECT COUNT(DISTINCT wo.id) INTO v_work_order_count
  FROM work_orders wo
  JOIN work_order_items woi ON woi.work_order_id = wo.id
  WHERE woi.mechanic_id = p_employee_id
    AND wo.created_at >= v_period_start
    AND wo.status IN ('completed', 'pending_settlement', 'settled', 'delivered');

  /* 3. 返工损失 */
  SELECT COALESCE(SUM(loss_amount), 0) INTO v_rework_loss_total
  FROM rework_records
  WHERE employee_id = p_employee_id
    AND recorded_at >= v_period_start;

  /* 4. 日常损失 */
  SELECT COALESCE(SUM(loss_amount), 0) INTO v_daily_loss_total
  FROM daily_loss_records
  WHERE employee_id = p_employee_id
    AND recorded_at >= v_period_start;

  /* 5. 行为规范分数 */
  SELECT COALESCE(SUM(score), 0) INTO v_behavior_score_total
  FROM behavior_score_records
  WHERE employee_id = p_employee_id
    AND scored_at >= v_period_start;

  /* 6. 考试通过情况（所有已分配课程的考试状态） */
  SELECT COUNT(*) INTO v_pending_exams
  FROM exam_results er
  JOIN training_assignments ta ON ta.id = er.assignment_id
  WHERE ta.employee_id = p_employee_id
    AND er.status IN ('pending', 'failed');

  IF v_pending_exams > 0 THEN
    v_exam_all_passed := FALSE;
  END IF;

  /* 检查各项条件 */
  IF v_course_points < v_rule.min_course_points THEN
    v_missing := array_append(v_missing, '课程积分不足（需要 ' || v_rule.min_course_points || '，当前 ' || v_course_points || '）');
  END IF;

  IF v_work_order_count < v_rule.min_work_orders THEN
    v_missing := array_append(v_missing, '工单数量不足（需要 ' || v_rule.min_work_orders || '，当前 ' || v_work_order_count || '）');
  END IF;

  IF v_rule.max_rework_loss > 0 AND v_rework_loss_total > v_rule.max_rework_loss THEN
    v_missing := array_append(v_missing, '返工损失超限（上限 ¥' || v_rule.max_rework_loss || '，当前 ¥' || v_rework_loss_total || '）');
  END IF;

  IF v_rule.max_daily_loss > 0 AND v_daily_loss_total > v_rule.max_daily_loss THEN
    v_missing := array_append(v_missing, '日常损失超限（上限 ¥' || v_rule.max_daily_loss || '，当前 ¥' || v_daily_loss_total || '）');
  END IF;

  IF v_behavior_score_total < v_rule.min_behavior_score THEN
    v_missing := array_append(v_missing, '行为规范分数不足（需要 ' || v_rule.min_behavior_score || '，当前 ' || v_behavior_score_total || '）');
  END IF;

  IF v_rule.exam_pass_required AND NOT v_exam_all_passed THEN
    v_missing := array_append(v_missing, '有考试未通过或待判卷');
  END IF;

  /* 返回结果 */
  eligible := array_length(v_missing, 1) IS NULL;
  current_level_id := v_current_level_id;
  course_points := v_course_points;
  work_order_count := v_work_order_count;
  rework_loss_total := v_rework_loss_total;
  daily_loss_total := v_daily_loss_total;
  behavior_score_total := v_behavior_score_total;
  exam_all_passed := v_exam_all_passed;
  missing_items := v_missing;

  RETURN NEXT;
  RETURN;
END;
$$ LANGUAGE plpgsql;
