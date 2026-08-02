/*
 * 财务/会员/提成相关表角色级 RLS 细分 + 存储桶改私有（2026-08-02 第二轮安全加固）
 * 原则：读不动（登录用户都可读，避免报表/页面报错），只收紧"写"
 * 角色对照 src/lib/permissions.ts：admin 全权、boss 老板、receptionist 接待（收银）、
 * accountant 财务、warehouse 库房、mechanic 维修工
 *
 * 本轮收紧：payments、finance_*、accounts_*、members、member_transactions、
 *           advance_payment_records、other_*、promotion_rules、profiles
 * 本轮不动：supplier_transactions（库房/维修手机端都在写）、价格表、工单/库存表
 */

/* 多角色判断函数：has_role('admin','boss') 表示任一角色即可 */
CREATE OR REPLACE FUNCTION public.has_role(VARIADIC p_roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profile_roles pr
    JOIN roles r ON pr.role_id = r.id
    WHERE pr.profile_id = auth.uid() AND r.name = ANY(p_roles)
  )
$$;

/* ========== 一、收银/资金往来：admin、boss、receptionist、accountant 可写 ========== */

DROP POLICY IF EXISTS auth_full_access ON payments;
CREATE POLICY payments_select ON payments FOR SELECT TO authenticated USING (true);
CREATE POLICY payments_insert ON payments FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','receptionist','accountant'));
CREATE POLICY payments_update ON payments FOR UPDATE TO authenticated USING (public.has_role('admin','boss','receptionist','accountant'));
CREATE POLICY payments_delete ON payments FOR DELETE TO authenticated USING (public.has_role('admin','boss','receptionist','accountant'));

DROP POLICY IF EXISTS advance_payment_records_auth ON advance_payment_records;
CREATE POLICY advance_payment_records_select ON advance_payment_records FOR SELECT TO authenticated USING (true);
CREATE POLICY advance_payment_records_insert ON advance_payment_records FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','receptionist','accountant'));
CREATE POLICY advance_payment_records_update ON advance_payment_records FOR UPDATE TO authenticated USING (public.has_role('admin','boss','receptionist','accountant'));
CREATE POLICY advance_payment_records_delete ON advance_payment_records FOR DELETE TO authenticated USING (public.has_role('admin','boss','receptionist','accountant'));

/* ========== 二、会员：admin、boss、receptionist、accountant 可写 ========== */

DROP POLICY IF EXISTS auth_full_access ON members;
CREATE POLICY members_select ON members FOR SELECT TO authenticated USING (true);
CREATE POLICY members_insert ON members FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','receptionist','accountant'));
CREATE POLICY members_update ON members FOR UPDATE TO authenticated USING (public.has_role('admin','boss','receptionist','accountant'));
CREATE POLICY members_delete ON members FOR DELETE TO authenticated USING (public.has_role('admin','boss','receptionist','accountant'));

DROP POLICY IF EXISTS auth_full_access ON member_transactions;
CREATE POLICY member_transactions_select ON member_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY member_transactions_insert ON member_transactions FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','receptionist','accountant'));
CREATE POLICY member_transactions_update ON member_transactions FOR UPDATE TO authenticated USING (public.has_role('admin','boss','receptionist','accountant'));
CREATE POLICY member_transactions_delete ON member_transactions FOR DELETE TO authenticated USING (public.has_role('admin','boss','receptionist','accountant'));

/* ========== 三、财务账目：admin、boss、accountant 可写 ========== */

DROP POLICY IF EXISTS auth_full_access ON finance_transactions;
CREATE POLICY finance_transactions_select ON finance_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_transactions_insert ON finance_transactions FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','accountant'));
CREATE POLICY finance_transactions_update ON finance_transactions FOR UPDATE TO authenticated USING (public.has_role('admin','boss','accountant'));
CREATE POLICY finance_transactions_delete ON finance_transactions FOR DELETE TO authenticated USING (public.has_role('admin','boss','accountant'));

DROP POLICY IF EXISTS auth_full_access ON finance_accounts;
CREATE POLICY finance_accounts_select ON finance_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_accounts_insert ON finance_accounts FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','accountant'));
CREATE POLICY finance_accounts_update ON finance_accounts FOR UPDATE TO authenticated USING (public.has_role('admin','boss','accountant'));
CREATE POLICY finance_accounts_delete ON finance_accounts FOR DELETE TO authenticated USING (public.has_role('admin','boss','accountant'));

DROP POLICY IF EXISTS auth_full_access ON finance_categories;
CREATE POLICY finance_categories_select ON finance_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_categories_insert ON finance_categories FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','accountant'));
CREATE POLICY finance_categories_update ON finance_categories FOR UPDATE TO authenticated USING (public.has_role('admin','boss','accountant'));
CREATE POLICY finance_categories_delete ON finance_categories FOR DELETE TO authenticated USING (public.has_role('admin','boss','accountant'));

DROP POLICY IF EXISTS auth_full_access ON accounts_receivable;
CREATE POLICY accounts_receivable_select ON accounts_receivable FOR SELECT TO authenticated USING (true);
CREATE POLICY accounts_receivable_insert ON accounts_receivable FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','accountant'));
CREATE POLICY accounts_receivable_update ON accounts_receivable FOR UPDATE TO authenticated USING (public.has_role('admin','boss','accountant'));
CREATE POLICY accounts_receivable_delete ON accounts_receivable FOR DELETE TO authenticated USING (public.has_role('admin','boss','accountant'));

DROP POLICY IF EXISTS auth_full_access ON accounts_payable;
CREATE POLICY accounts_payable_select ON accounts_payable FOR SELECT TO authenticated USING (true);
CREATE POLICY accounts_payable_insert ON accounts_payable FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','accountant'));
CREATE POLICY accounts_payable_update ON accounts_payable FOR UPDATE TO authenticated USING (public.has_role('admin','boss','accountant'));
CREATE POLICY accounts_payable_delete ON accounts_payable FOR DELETE TO authenticated USING (public.has_role('admin','boss','accountant'));

DROP POLICY IF EXISTS "登录用户可查看" ON other_transactions;
DROP POLICY IF EXISTS "登录用户可插入" ON other_transactions;
DROP POLICY IF EXISTS "登录用户可更新" ON other_transactions;
DROP POLICY IF EXISTS "登录用户可删除" ON other_transactions;
CREATE POLICY other_transactions_select ON other_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY other_transactions_insert ON other_transactions FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','accountant'));
CREATE POLICY other_transactions_update ON other_transactions FOR UPDATE TO authenticated USING (public.has_role('admin','boss','accountant'));
CREATE POLICY other_transactions_delete ON other_transactions FOR DELETE TO authenticated USING (public.has_role('admin','boss','accountant'));

DROP POLICY IF EXISTS "登录用户可查看" ON other_payment_methods;
DROP POLICY IF EXISTS "登录用户可插入" ON other_payment_methods;
DROP POLICY IF EXISTS "登录用户可更新" ON other_payment_methods;
DROP POLICY IF EXISTS "登录用户可删除" ON other_payment_methods;
CREATE POLICY other_payment_methods_select ON other_payment_methods FOR SELECT TO authenticated USING (true);
CREATE POLICY other_payment_methods_insert ON other_payment_methods FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','accountant'));
CREATE POLICY other_payment_methods_update ON other_payment_methods FOR UPDATE TO authenticated USING (public.has_role('admin','boss','accountant'));
CREATE POLICY other_payment_methods_delete ON other_payment_methods FOR DELETE TO authenticated USING (public.has_role('admin','boss','accountant'));

DROP POLICY IF EXISTS "登录用户可查看" ON other_transaction_categories;
DROP POLICY IF EXISTS "登录用户可插入" ON other_transaction_categories;
DROP POLICY IF EXISTS "登录用户可更新" ON other_transaction_categories;
DROP POLICY IF EXISTS "登录用户可删除" ON other_transaction_categories;
CREATE POLICY other_transaction_categories_select ON other_transaction_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY other_transaction_categories_insert ON other_transaction_categories FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','accountant'));
CREATE POLICY other_transaction_categories_update ON other_transaction_categories FOR UPDATE TO authenticated USING (public.has_role('admin','boss','accountant'));
CREATE POLICY other_transaction_categories_delete ON other_transaction_categories FOR DELETE TO authenticated USING (public.has_role('admin','boss','accountant'));

/* ========== 四、促销规则：admin、boss 可写 ========== */

DROP POLICY IF EXISTS auth_full_access ON promotion_rules;
CREATE POLICY promotion_rules_select ON promotion_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY promotion_rules_insert ON promotion_rules FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss'));
CREATE POLICY promotion_rules_update ON promotion_rules FOR UPDATE TO authenticated USING (public.has_role('admin','boss'));
CREATE POLICY promotion_rules_delete ON promotion_rules FOR DELETE TO authenticated USING (public.has_role('admin','boss'));

/* ========== 五、员工档案：仅 admin 可写（防普通员工改自己提成/工资字段） ========== */

DROP POLICY IF EXISTS auth_full_access ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_insert ON profiles FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY profiles_delete ON profiles FOR DELETE TO authenticated USING (public.is_admin());

/* ========== 六、存储桶全部改私有（应用未使用这些桶，媒体都在本地磁盘） ========== */

UPDATE storage.buckets SET public = false
WHERE name IN ('work-order-media','training-media','behavior-media','customer-media','vehicle-media');

DROP POLICY IF EXISTS customer_media_public_read ON storage.objects;
DROP POLICY IF EXISTS vehicle_media_public_read ON storage.objects;
