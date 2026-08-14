/* ============================================================
   behavior_check_records 加唯一约束（待清理后执行）

   【执行前必读】本文件分三步，每步单独在 Dashboard SQL 编辑器执行并确认：
   第 1 步：查重 —— 先单独跑，确认重复量；0 行则跳过第 2 步直接执行第 3 步
   第 2 步：去重 —— 有重复时才执行
   第 3 步：加唯一约束 —— 前序确认无重复后再执行

   背景：今日考核记录是页面打开时"先查后插"懒生成的，并发打开可能产生
   重复记录。代码端已加"忽略 23505 冲突"兜底，本约束是数据库层兜底。
   ============================================================ */

/* 第 1 步：查重
SELECT task_id, employee_id, check_date, COUNT(*) AS cnt
FROM behavior_check_records
GROUP BY task_id, employee_id, check_date
HAVING COUNT(*) > 1;
*/

/* 第 2 步：去重（有重复时才执行）
   保留规则：completed 优先于 pending；同状态保留最早创建的；再并列保留 id 最小者
   （偏序构成全序，每组恰好保留一行）
   注意：被删记录若带 score_record_id，对应打分流水的 score_record_id 引用是
   ON DELETE SET NULL，流水本身不会被删，历史分数不丢
DELETE FROM behavior_check_records a
USING behavior_check_records b
WHERE a.task_id = b.task_id
  AND a.employee_id = b.employee_id
  AND a.check_date = b.check_date
  AND (
    (a.status = 'pending' AND b.status = 'completed')
    OR (a.status = b.status AND a.created_at > b.created_at)
    OR (a.status = b.status AND a.created_at = b.created_at AND a.id > b.id)
  );
*/

/* 第 3 步：加唯一约束（确认无重复后再执行）
ALTER TABLE behavior_check_records
  ADD CONSTRAINT uq_behavior_check_records_task_emp_date
  UNIQUE (task_id, employee_id, check_date);
*/
