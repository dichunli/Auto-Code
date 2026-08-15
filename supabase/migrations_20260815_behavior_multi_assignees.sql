/* ============================================================
   行为考核：责任人/检查人改多选 + 自检上报两阶段流程
   1. behavior_score_items：responsible_id/checker_id → responsible_ids/checker_ids JSONB 数组
   2. behavior_check_records：checker_id → checker_ids JSONB 数组
   3. behavior_check_records 加自检上报字段（照片/说明/时间）
   4. 状态约束加 self_reported（责任人已自检待核查）
   向后兼容：旧单值数据回填为单元素数组；空数组语义=旧模式
   ============================================================ */

/* -----------------------------------------------------------
   1. 项目责任人/检查人改多选数组
   ----------------------------------------------------------- */
ALTER TABLE behavior_score_items
  ADD COLUMN IF NOT EXISTS responsible_ids JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS checker_ids JSONB DEFAULT '[]';

/* 旧单值回填为单元素数组（只回填还是空数组的行） */
UPDATE behavior_score_items
SET responsible_ids = jsonb_build_array(responsible_id)
WHERE responsible_id IS NOT NULL AND (responsible_ids IS NULL OR responsible_ids = '[]'::jsonb);

UPDATE behavior_score_items
SET checker_ids = jsonb_build_array(checker_id)
WHERE checker_id IS NOT NULL AND (checker_ids IS NULL OR checker_ids = '[]'::jsonb);

ALTER TABLE behavior_score_items
  DROP COLUMN IF EXISTS responsible_id,
  DROP COLUMN IF EXISTS checker_id;

/* -----------------------------------------------------------
   2. 检查记录检查人改多选数组
   ----------------------------------------------------------- */
ALTER TABLE behavior_check_records
  ADD COLUMN IF NOT EXISTS checker_ids JSONB DEFAULT '[]';

UPDATE behavior_check_records
SET checker_ids = jsonb_build_array(checker_id)
WHERE checker_id IS NOT NULL AND (checker_ids IS NULL OR checker_ids = '[]'::jsonb);

ALTER TABLE behavior_check_records
  DROP COLUMN IF EXISTS checker_id;

/* -----------------------------------------------------------
   3. 自检上报字段（责任人先拍照自检，检查人再核查）
   ----------------------------------------------------------- */
ALTER TABLE behavior_check_records
  ADD COLUMN IF NOT EXISTS self_report_photos JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS self_report_note TEXT,
  ADD COLUMN IF NOT EXISTS self_reported_at TIMESTAMPTZ;

/* -----------------------------------------------------------
   4. 状态约束加 self_reported
   pending=待自检/待检查 self_reported=已自检待核查 completed=已完成
   ----------------------------------------------------------- */
ALTER TABLE behavior_check_records DROP CONSTRAINT IF EXISTS behavior_check_records_status_check;
ALTER TABLE behavior_check_records ADD CONSTRAINT behavior_check_records_status_check
  CHECK (status IN ('pending', 'self_reported', 'completed'));
