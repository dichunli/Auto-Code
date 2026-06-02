/* ============================================================
   培训系统 - 增加线下考试支持
   1. 给 training_courses 表增加 exam_mode 字段
   2. 给 exam_questions 表增加 scoring 题型（评分项）
   ============================================================ */

/* 1. 课程考试方式 */
ALTER TABLE training_courses
  ADD COLUMN IF NOT EXISTS exam_mode TEXT DEFAULT 'online' CHECK (exam_mode IN ('online', 'offline'));

/* 已有 has_exam=true 的课程，默认设为线上考试 */
UPDATE training_courses SET exam_mode = 'online' WHERE has_exam = true AND exam_mode IS NULL;

/* 2. 扩展考题类型，增加 scoring（评分项） */
/* 先删除旧约束，再添加包含 scoring 的新约束 */
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS exam_questions_question_type_check;
ALTER TABLE exam_questions ADD CONSTRAINT exam_questions_question_type_check
  CHECK (question_type IN ('single_choice', 'multiple_choice', 'essay', 'scoring'));
