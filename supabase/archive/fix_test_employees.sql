-- ============================================================
-- 修复：手动将 auth.users 同步到 profiles 表
-- ============================================================

-- 1. 先确认测试用户是否已在 auth.users 中创建
SELECT id, email, raw_user_meta_data->>'full_name' as name, created_at
FROM auth.users
WHERE email LIKE 'u138001380%@auto.local';

-- 2. 把缺少 profiles 记录的用户补充进去
INSERT INTO public.profiles (id, full_name, is_active, created_at, updated_at)
SELECT
  au.id,
  COALESCE(au.raw_user_meta_data->>'full_name', au.email, '新用户'),
  TRUE,
  NOW(),
  NOW()
FROM auth.users au
WHERE au.email LIKE 'u138001380%@auto.local'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id);

-- 3. 确认 profiles 中已有这些员工
SELECT id, full_name, is_active, created_at
FROM public.profiles
WHERE id IN (SELECT id FROM auth.users WHERE email LIKE 'u138001380%@auto.local');
