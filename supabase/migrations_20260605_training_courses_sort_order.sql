/* ============================================================
   培训课程列表 - 增加排序字段
   ============================================================ */

ALTER TABLE training_courses
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

/* 初始化已有数据的排序值（按创建时间倒序，新创建的在前面） */
UPDATE training_courses
SET sort_order = sub.rank_num
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) as rank_num
  FROM training_courses
) sub
WHERE training_courses.id = sub.id;
