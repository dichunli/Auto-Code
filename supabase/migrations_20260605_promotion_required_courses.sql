/* ============================================================
   晋级规则 - 增加必修课程和考核得分要求
   ============================================================ */

ALTER TABLE promotion_rules
  ADD COLUMN IF NOT EXISTS required_course_ids JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS min_exam_score INTEGER DEFAULT 0;
