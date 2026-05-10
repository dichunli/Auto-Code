-- 修复 Security Advisor 警告：v_inventory_turnover 视图使用 SECURITY DEFINER
-- 将视图改为以调用者权限执行（security_invoker），确保 RLS 策略生效

ALTER VIEW IF EXISTS v_inventory_turnover SET (security_invoker = on);
