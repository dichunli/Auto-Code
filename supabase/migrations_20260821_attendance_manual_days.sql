-- ============================================================
-- 考勤记录：手动调整出勤天数
--
-- 背景：自动规则（正常/迟到/早退=1 天、缺卡=0.5 天、缺勤=0 天）有时不符合实际，
--       管理员可在「考勤月报 → 每日统计」里对异常行（迟到/早退/缺卡/缺勤）手动改成 0 / 0.5 / 1 天。
-- 口径：展示与工资折算统一用「有效出勤天数」= COALESCE(manual_days, 自动计算值)。
-- 注意：钉钉重同步（upsert）不更新本组列，手动调整不会被覆盖。
-- ============================================================

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS manual_days DECIMAL(4,1),
  ADD COLUMN IF NOT EXISTS manual_note TEXT,
  ADD COLUMN IF NOT EXISTS manual_updated_by UUID,
  ADD COLUMN IF NOT EXISTS manual_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN attendance_records.manual_days IS '手动调整后的出勤天数（NULL=按自动规则：正常/迟到/早退=1，缺卡=0.5，缺勤=0）';
COMMENT ON COLUMN attendance_records.manual_note IS '手动调整说明（为什么改）';
COMMENT ON COLUMN attendance_records.manual_updated_by IS '最后一次手动调整的操作人（profiles.id）';
COMMENT ON COLUMN attendance_records.manual_updated_at IS '最后一次手动调整时间';

-- 手动天数只允许 0 ~ 1 之间、0.5 步进（0 / 0.5 / 1）
ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_manual_days_check
  CHECK (manual_days IS NULL OR (manual_days >= 0 AND manual_days <= 1 AND manual_days * 2 = FLOOR(manual_days * 2)));
