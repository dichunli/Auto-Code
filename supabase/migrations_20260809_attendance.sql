/* ============================================================
   考勤模块（钉钉对接）数据库迁移
   2026-08-09
   内容：
     1. profiles 员工表加钉钉编号、月底薪字段
     2. 新建 attendance_records 考勤日记录表
     3. payroll_records 工资表加考勤汇总字段
     4. 新建 attendance_settings 考勤扣款标准表
   本脚本幂等，重复执行不会报错。
   ============================================================ */

/* 1. 员工表：钉钉用户编号 + 月底薪标准 */
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dingtalk_userid TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS base_salary DECIMAL(12,2);

/* 钉钉编号唯一（允许空值，未绑定的员工不受影响） */
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_dingtalk_userid
  ON profiles(dingtalk_userid) WHERE dingtalk_userid IS NOT NULL;

/* 2. 考勤日记录表（每人每天一条，数据来自钉钉同步） */
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  dingtalk_userid TEXT NOT NULL,
  work_date DATE NOT NULL,
  /* 当天是否有排班（无排班 = 休息） */
  has_schedule BOOLEAN NOT NULL DEFAULT FALSE,
  /* 班次名称，无排班时为空 */
  shift_name TEXT,
  /* 上班打卡：实际打卡时间 + 钉钉判定结果（Normal/Late/SeriousLate/Absenteeism/NotSigned） */
  check_in_at TIMESTAMPTZ,
  check_in_result TEXT,
  /* 下班打卡：实际打卡时间 + 钉钉判定结果（Normal/Early/NotSigned） */
  check_out_at TIMESTAMPTZ,
  check_out_result TEXT,
  /* 当天汇总判定：normal 正常 / late 迟到 / early 早退 / miss_card 缺卡 / absent 缺勤 / rest 休息 */
  day_result TEXT NOT NULL DEFAULT 'rest'
    CHECK (day_result IN ('normal','late','early','miss_card','absent','rest')),
  /* 数据同步时间（排查用） */
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /* 每人每天唯一，重复同步时覆盖旧数据 */
  UNIQUE(profile_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON attendance_records(work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_profile ON attendance_records(profile_id, work_date);

/* RLS：登录用户可读；写操作只走服务端（同步接口用 service role，绕过 RLS） */
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_records_select ON attendance_records;
CREATE POLICY attendance_records_select ON attendance_records
  FOR SELECT TO authenticated USING (true);

/* 3. 工资表：加考勤汇总字段（生成工资单时自动填入，可手改） */
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS should_attendance_days DECIMAL(5,1);
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS attendance_days DECIMAL(5,1);
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS late_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS attendance_deduction DECIMAL(12,2) NOT NULL DEFAULT 0;

/* 4. 考勤扣款标准表（全店一行配置，管理员可改）
   late_penalty      迟到每次扣款（元）
   miss_card_penalty 缺卡每次扣款（元）
   absent_penalty    缺勤每天额外扣款（元，默认 0，缺勤已通过底薪折算少发，避免重复扣） */
CREATE TABLE IF NOT EXISTS attendance_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  late_penalty DECIMAL(12,2) NOT NULL DEFAULT 0,
  miss_card_penalty DECIMAL(12,2) NOT NULL DEFAULT 0,
  absent_penalty DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* 默认插入一行配置（全店只有一行） */
INSERT INTO attendance_settings (late_penalty, miss_card_penalty, absent_penalty)
SELECT 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM attendance_settings);

ALTER TABLE attendance_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_settings_select ON attendance_settings;
CREATE POLICY attendance_settings_select ON attendance_settings
  FOR SELECT TO authenticated USING (true);
/* 修改扣款标准走 Server Action（验证管理员身份后用 service role 写），不开放客户端直写 */
