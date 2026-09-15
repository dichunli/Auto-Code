/* profiles 敏感字段物理隔离（2026-09-14）
   背景：profiles 表全员可读（派工/考核等选人列表需要全员姓名），
        导致任何登录员工能看到所有人的身份证号、身份证照片、底薪。
   方案：4 个敏感列拆到独立表 profile_privates，RLS 收紧为
        "本人 + admin/boss/accountant 可读"（财务发工资需要底薪）；
        profiles 表剩余列维持全员可读，30+ 处选人列表零改动。
   配合代码改动：员工新建/编辑、员工详情、个人中心、工资生成的
        敏感字段读写全部改走 profile_privates（同一提交）。
*/

/* ========== 一、敏感信息表 ========== */
CREATE TABLE IF NOT EXISTS profile_privates (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  id_card TEXT,
  id_card_front_url TEXT,
  id_card_back_url TEXT,
  base_salary DECIMAL(12,2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profile_privates ENABLE ROW LEVEL SECURITY;

/* 读：本人 或 admin/boss/accountant */
DROP POLICY IF EXISTS profile_privates_select ON profile_privates;
CREATE POLICY profile_privates_select ON profile_privates FOR SELECT TO authenticated
  USING (auth.uid() = profile_id OR public.has_role('admin','boss','accountant'));

/* 写：admin/boss/accountant（员工档案编辑是管理员操作；工资生成走 service role 不受 RLS 约束） */
DROP POLICY IF EXISTS profile_privates_insert ON profile_privates;
CREATE POLICY profile_privates_insert ON profile_privates FOR INSERT TO authenticated
  WITH CHECK (public.has_role('admin','boss','accountant'));

DROP POLICY IF EXISTS profile_privates_update ON profile_privates;
CREATE POLICY profile_privates_update ON profile_privates FOR UPDATE TO authenticated
  USING (public.has_role('admin','boss','accountant'));

DROP POLICY IF EXISTS profile_privates_delete ON profile_privates;
CREATE POLICY profile_privates_delete ON profile_privates FOR DELETE TO authenticated
  USING (public.is_admin());

/* ========== 二、存量数据搬迁（只搬有敏感数据的行） ========== */
INSERT INTO profile_privates (profile_id, id_card, id_card_front_url, id_card_back_url, base_salary)
SELECT id, id_card, id_card_front_url, id_card_back_url, base_salary
FROM profiles
WHERE id_card IS NOT NULL
   OR id_card_front_url IS NOT NULL
   OR id_card_back_url IS NOT NULL
   OR base_salary IS NOT NULL
ON CONFLICT (profile_id) DO NOTHING;

/* ========== 三、profiles 删除已迁出的敏感列 ========== */
ALTER TABLE profiles DROP COLUMN IF EXISTS id_card;
ALTER TABLE profiles DROP COLUMN IF EXISTS id_card_front_url;
ALTER TABLE profiles DROP COLUMN IF EXISTS id_card_back_url;
ALTER TABLE profiles DROP COLUMN IF EXISTS base_salary;

/* ========== 四、登记台账 ========== */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260914_a_profile_privates.sql')
ON CONFLICT DO NOTHING;
