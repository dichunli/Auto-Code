/* ============================================================
   员工培训考试系统 - 阶段一迁移
   1. 扩展 training_courses 表（积分、视频、考试开关）
   2. 新建 exam_questions 考题表
   3. 新建 exam_answers 答题记录表
   4. 新建 exam_results 考试成绩表
   ============================================================ */

/* -----------------------------------------------------------
   1. 扩展 training_courses 表
   ----------------------------------------------------------- */
ALTER TABLE training_courses
  ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS has_exam BOOLEAN DEFAULT FALSE;

/* -----------------------------------------------------------
   2. 考试题目表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS exam_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL CHECK (question_type IN ('single_choice','multiple_choice','essay')),
  question_text TEXT NOT NULL,
  options JSONB DEFAULT '[]',
  correct_answer TEXT,
  score INTEGER DEFAULT 10,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exam_questions_course ON exam_questions(course_id);

/* -----------------------------------------------------------
   3. 员工答题记录表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS exam_answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id UUID NOT NULL REFERENCES training_assignments(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  answer_text TEXT,
  is_correct BOOLEAN,
  score INTEGER DEFAULT 0,
  graded_by UUID REFERENCES profiles(id),
  graded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exam_answers_assignment ON exam_answers(assignment_id);
CREATE INDEX IF NOT EXISTS idx_exam_answers_employee ON exam_answers(employee_id);

/* -----------------------------------------------------------
   4. 考试成绩表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS exam_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id UUID NOT NULL REFERENCES training_assignments(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  total_score INTEGER DEFAULT 0,
  max_score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','passed','failed')),
  exam_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exam_results_assignment ON exam_results(assignment_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_employee ON exam_results(employee_id);

/* -----------------------------------------------------------
   5. RLS 策略
   ----------------------------------------------------------- */
ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full_access" ON exam_questions;
CREATE POLICY "auth_full_access" ON exam_questions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_access" ON exam_answers;
CREATE POLICY "auth_full_access" ON exam_answers FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_access" ON exam_results;
CREATE POLICY "auth_full_access" ON exam_results FOR ALL TO authenticated USING (true) WITH CHECK (true);
