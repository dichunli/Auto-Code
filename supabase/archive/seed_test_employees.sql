-- ============================================================
-- 批量创建测试员工（绕过 Supabase signUp 频率限制）
-- 在 Supabase Dashboard 的 SQL Editor 中执行
-- ============================================================

-- 确保 pgcrypto 扩展可用（密码加密需要）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 测试员工数据：可以修改下面的姓名、手机号、密码
DO $$
DECLARE
  v_user RECORD;
  v_new_id UUID;
BEGIN
  FOR v_user IN
    SELECT * FROM (VALUES
      ('u13800138001@auto.local', '123456', '张三'),
      ('u13800138002@auto.local', '123456', '李四'),
      ('u13800138003@auto.local', '123456', '王五'),
      ('u13800138004@auto.local', '123456', '赵六')
    ) AS t(email, password, full_name)
  LOOP
    -- 如果该邮箱已存在则跳过
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_user.email) THEN
      CONTINUE;
    END IF;

    v_new_id := gen_random_uuid();

    INSERT INTO auth.users (
      id, email, encrypted_password, email_confirmed_at,
      raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_new_id, v_user.email, crypt(v_user.password, gen_salt('bf')),
      NOW(), jsonb_build_object('full_name', v_user.full_name),
      NOW(), NOW()
    );
  END LOOP;
END $$;

-- 说明：
-- 1. 上面的数据会自动触发 handle_new_user() 触发器，自动创建 profiles 记录
-- 2. 登录时输入手机号（如 13800138001）+ 密码 123456 即可
-- 3. 如需修改员工信息，去系统里「员工档案」页面编辑
-- 4. 如要添加更多员工，复制 VALUES 里的行，修改手机号和姓名即可
