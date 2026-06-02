/* ============================================================
   1. 更新晋级条件检查函数 - 增加必修课程和考核得分检查
   2. 新建行为考核定时任务表
   ============================================================ */

/* -----------------------------------------------------------
   1. 更新晋级检查函数
   ----------------------------------------------------------- */
DROP FUNCTION IF EXISTS check_promotion_eligibility(UUID, UUID);

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
  required_courses_completed BOOLEAN,
  required_courses_count INTEGER,
  required_courses_done INTEGER,
  exam_total_score INTEGER,
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
  v_required_courses_completed BOOLEAN := TRUE;
  v_required_courses_count INTEGER := 0;
  v_required_courses_done INTEGER := 0;
  v_exam_total_score INTEGER := 0;
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_pending_exams INTEGER := 0;
  v_course_id UUID;
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

  /* 7. 必修课程完成情况 */
  IF v_rule.required_course_ids IS NOT NULL AND jsonb_array_length(v_rule.required_course_ids) > 0 THEN
    v_required_courses_count := jsonb_array_length(v_rule.required_course_ids);
    v_required_courses_done := 0;

    FOR v_course_id IN
      SELECT value::text::UUID
      FROM jsonb_array_elements_text(v_rule.required_course_ids) AS value
    LOOP
      /* 检查员工是否已完成该课程 */
      IF EXISTS (
        SELECT 1 FROM training_assignments
        WHERE employee_id = p_employee_id
          AND course_id = v_course_id
          AND status = 'completed'
      ) THEN
        v_required_courses_done := v_required_courses_done + 1;
      END IF;
    END LOOP;

    IF v_required_courses_done < v_required_courses_count THEN
      v_required_courses_completed := FALSE;
      v_missing := array_append(v_missing, '必修课程未完成（完成 ' || v_required_courses_done || '/' || v_required_courses_count || '）');
    END IF;
  END IF;

  /* 8. 考核总分（所有已分配且通过考试的分数总和） */
  SELECT COALESCE(SUM(er.total_score), 0) INTO v_exam_total_score
  FROM exam_results er
  JOIN training_assignments ta ON ta.id = er.assignment_id
  WHERE ta.employee_id = p_employee_id
    AND er.status = 'passed';

  IF v_rule.min_exam_score > 0 AND v_exam_total_score < v_rule.min_exam_score THEN
    v_missing := array_append(v_missing, '考核得分不足（需要 ' || v_rule.min_exam_score || '，当前 ' || v_exam_total_score || '）');
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
  required_courses_completed := v_required_courses_completed;
  required_courses_count := v_required_courses_count;
  required_courses_done := v_required_courses_done;
  exam_total_score := v_exam_total_score;
  missing_items := v_missing;

  RETURN NEXT;
  RETURN;
END;
$$ LANGUAGE plpgsql;

/* -----------------------------------------------------------
   2. 行为考核定时任务表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS behavior_check_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  item_id UUID NOT NULL REFERENCES behavior_score_items(id) ON DELETE CASCADE,
  employee_ids JSONB DEFAULT '[]',
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  execute_time TIME NOT NULL DEFAULT '09:00',
  execute_weekday INTEGER DEFAULT 1 CHECK (execute_weekday BETWEEN 0 AND 6),
  execute_day INTEGER DEFAULT 1 CHECK (execute_day BETWEEN 1 AND 31),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_behavior_check_tasks_active ON behavior_check_tasks(is_active);

/* -----------------------------------------------------------
   3. 行为考核执行记录表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS behavior_check_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES behavior_check_tasks(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  check_date DATE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  score_record_id UUID REFERENCES behavior_score_records(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_behavior_check_records_task ON behavior_check_records(task_id);
CREATE INDEX IF NOT EXISTS idx_behavior_check_records_employee ON behavior_check_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_behavior_check_records_date ON behavior_check_records(check_date);

/* -----------------------------------------------------------
   4. RLS 策略
   ----------------------------------------------------------- */
ALTER TABLE behavior_check_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_check_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full_access" ON behavior_check_tasks;
CREATE POLICY "auth_full_access" ON behavior_check_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_access" ON behavior_check_records;
CREATE POLICY "auth_full_access" ON behavior_check_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
