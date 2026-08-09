/*
 * RLS 通电专项：补齐从未启用 RLS 的 12 张表（2026-08-06，存在性免疫版）
 * 背景：2026-08-02 安全加固给部分表 CREATE POLICY 但没 ENABLE RLS，策略不生效；
 *       首次执行发现真实库 payroll_records 根本不存在（迁移文件与真实库有漂移），
 *       故每张表包 DO 块：存在才通电，不存在则跳过并 NOTICE，不再中途报错。
 *
 * 策略宽度决定（2026-08-06 经用户拍板）：
 *   - payroll_records 工资表：仅 admin/boss/accountant 可读写（含读！工资保密）
 *   - 报销单两表：登录可读，admin/boss/receptionist/accountant 可写（对齐 payments）
 *   - company_contacts / customer_photos / vehicle_photos：登录用户全访问
 *   - members / finance_accounts / finance_categories / accounts_payable /
 *     parts_specifications / service_item_special_prices：与 8/2 角色策略保持一致
 */

/* 角色判断函数兜底：万一 8/2 加固未执行，本文件也能独立跑通 */
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profile_roles pr
    JOIN roles r ON pr.role_id = r.id
    WHERE pr.profile_id = auth.uid() AND r.name = 'admin'
  )
$$;

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

/* ========== 一、工资表：仅 admin/boss/accountant 可读写（读也收紧） ========== */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='payroll_records') THEN
    ALTER TABLE payroll_records ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS payroll_records_select ON payroll_records;
    DROP POLICY IF EXISTS payroll_records_insert ON payroll_records;
    DROP POLICY IF EXISTS payroll_records_update ON payroll_records;
    DROP POLICY IF EXISTS payroll_records_delete ON payroll_records;
    CREATE POLICY payroll_records_select ON payroll_records FOR SELECT TO authenticated
    USING (public.has_role('admin','boss','accountant'));
    CREATE POLICY payroll_records_insert ON payroll_records FOR INSERT TO authenticated
    WITH CHECK (public.has_role('admin','boss','accountant'));
    CREATE POLICY payroll_records_update ON payroll_records FOR UPDATE TO authenticated
    USING (public.has_role('admin','boss','accountant'));
    CREATE POLICY payroll_records_delete ON payroll_records FOR DELETE TO authenticated
    USING (public.has_role('admin','boss','accountant'));
  ELSE
    RAISE NOTICE '表 payroll_records 不存在，已跳过';
  END IF;
END $$;

/* ========== 二、报销单两表：登录可读，admin/boss/receptionist/accountant 可写 ========== */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='work_order_reimbursements') THEN
    ALTER TABLE work_order_reimbursements ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS reimbursements_select ON work_order_reimbursements;
    DROP POLICY IF EXISTS reimbursements_insert ON work_order_reimbursements;
    DROP POLICY IF EXISTS reimbursements_update ON work_order_reimbursements;
    DROP POLICY IF EXISTS reimbursements_delete ON work_order_reimbursements;
    CREATE POLICY reimbursements_select ON work_order_reimbursements FOR SELECT TO authenticated USING (true);
    CREATE POLICY reimbursements_insert ON work_order_reimbursements FOR INSERT TO authenticated
    WITH CHECK (public.has_role('admin','boss','receptionist','accountant'));
    CREATE POLICY reimbursements_update ON work_order_reimbursements FOR UPDATE TO authenticated
    USING (public.has_role('admin','boss','receptionist','accountant'));
    CREATE POLICY reimbursements_delete ON work_order_reimbursements FOR DELETE TO authenticated
    USING (public.has_role('admin','boss','receptionist','accountant'));
  ELSE
    RAISE NOTICE '表 work_order_reimbursements 不存在，已跳过';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='work_order_reimbursement_items') THEN
    ALTER TABLE work_order_reimbursement_items ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS reimbursement_items_select ON work_order_reimbursement_items;
    DROP POLICY IF EXISTS reimbursement_items_insert ON work_order_reimbursement_items;
    DROP POLICY IF EXISTS reimbursement_items_update ON work_order_reimbursement_items;
    DROP POLICY IF EXISTS reimbursement_items_delete ON work_order_reimbursement_items;
    CREATE POLICY reimbursement_items_select ON work_order_reimbursement_items FOR SELECT TO authenticated USING (true);
    CREATE POLICY reimbursement_items_insert ON work_order_reimbursement_items FOR INSERT TO authenticated
    WITH CHECK (public.has_role('admin','boss','receptionist','accountant'));
    CREATE POLICY reimbursement_items_update ON work_order_reimbursement_items FOR UPDATE TO authenticated
    USING (public.has_role('admin','boss','receptionist','accountant'));
    CREATE POLICY reimbursement_items_delete ON work_order_reimbursement_items FOR DELETE TO authenticated
    USING (public.has_role('admin','boss','receptionist','accountant'));
  ELSE
    RAISE NOTICE '表 work_order_reimbursement_items 不存在，已跳过';
  END IF;
END $$;

/* ========== 三、公司联系人/客户照片/车辆照片：登录用户全访问 ========== */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='company_contacts') THEN
    ALTER TABLE company_contacts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS company_contacts_auth ON company_contacts;
    CREATE POLICY company_contacts_auth ON company_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
  ELSE
    RAISE NOTICE '表 company_contacts 不存在，已跳过';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='customer_photos') THEN
    ALTER TABLE customer_photos ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS customer_photos_auth ON customer_photos;
    CREATE POLICY customer_photos_auth ON customer_photos FOR ALL TO authenticated USING (true) WITH CHECK (true);
  ELSE
    RAISE NOTICE '表 customer_photos 不存在，已跳过';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='vehicle_photos') THEN
    ALTER TABLE vehicle_photos ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS vehicle_photos_auth ON vehicle_photos;
    CREATE POLICY vehicle_photos_auth ON vehicle_photos FOR ALL TO authenticated USING (true) WITH CHECK (true);
  ELSE
    RAISE NOTICE '表 vehicle_photos 不存在，已跳过';
  END IF;
END $$;

/* ========== 四、8/2 已配好角色策略的 6 张表（策略一并补齐，保持与 8/2 一致） ========== */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='members') THEN
    ALTER TABLE members ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS members_select ON members;
    DROP POLICY IF EXISTS members_insert ON members;
    DROP POLICY IF EXISTS members_update ON members;
    DROP POLICY IF EXISTS members_delete ON members;
    CREATE POLICY members_select ON members FOR SELECT TO authenticated USING (true);
    CREATE POLICY members_insert ON members FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','receptionist','accountant'));
    CREATE POLICY members_update ON members FOR UPDATE TO authenticated USING (public.has_role('admin','boss','receptionist','accountant'));
    CREATE POLICY members_delete ON members FOR DELETE TO authenticated USING (public.has_role('admin','boss','receptionist','accountant'));
  ELSE
    RAISE NOTICE '表 members 不存在，已跳过';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='finance_accounts') THEN
    ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS finance_accounts_select ON finance_accounts;
    DROP POLICY IF EXISTS finance_accounts_insert ON finance_accounts;
    DROP POLICY IF EXISTS finance_accounts_update ON finance_accounts;
    DROP POLICY IF EXISTS finance_accounts_delete ON finance_accounts;
    CREATE POLICY finance_accounts_select ON finance_accounts FOR SELECT TO authenticated USING (true);
    CREATE POLICY finance_accounts_insert ON finance_accounts FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','accountant'));
    CREATE POLICY finance_accounts_update ON finance_accounts FOR UPDATE TO authenticated USING (public.has_role('admin','boss','accountant'));
    CREATE POLICY finance_accounts_delete ON finance_accounts FOR DELETE TO authenticated USING (public.has_role('admin','boss','accountant'));
  ELSE
    RAISE NOTICE '表 finance_accounts 不存在，已跳过';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='finance_categories') THEN
    ALTER TABLE finance_categories ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS finance_categories_select ON finance_categories;
    DROP POLICY IF EXISTS finance_categories_insert ON finance_categories;
    DROP POLICY IF EXISTS finance_categories_update ON finance_categories;
    DROP POLICY IF EXISTS finance_categories_delete ON finance_categories;
    CREATE POLICY finance_categories_select ON finance_categories FOR SELECT TO authenticated USING (true);
    CREATE POLICY finance_categories_insert ON finance_categories FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','accountant'));
    CREATE POLICY finance_categories_update ON finance_categories FOR UPDATE TO authenticated USING (public.has_role('admin','boss','accountant'));
    CREATE POLICY finance_categories_delete ON finance_categories FOR DELETE TO authenticated USING (public.has_role('admin','boss','accountant'));
  ELSE
    RAISE NOTICE '表 finance_categories 不存在，已跳过';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='accounts_payable') THEN
    ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS accounts_payable_select ON accounts_payable;
    DROP POLICY IF EXISTS accounts_payable_insert ON accounts_payable;
    DROP POLICY IF EXISTS accounts_payable_update ON accounts_payable;
    DROP POLICY IF EXISTS accounts_payable_delete ON accounts_payable;
    CREATE POLICY accounts_payable_select ON accounts_payable FOR SELECT TO authenticated USING (true);
    CREATE POLICY accounts_payable_insert ON accounts_payable FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','accountant'));
    CREATE POLICY accounts_payable_update ON accounts_payable FOR UPDATE TO authenticated USING (public.has_role('admin','boss','accountant'));
    CREATE POLICY accounts_payable_delete ON accounts_payable FOR DELETE TO authenticated USING (public.has_role('admin','boss','accountant'));
  ELSE
    RAISE NOTICE '表 accounts_payable 不存在，已跳过';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='parts_specifications') THEN
    ALTER TABLE parts_specifications ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS parts_specifications_auth ON parts_specifications;
    CREATE POLICY parts_specifications_auth ON parts_specifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
  ELSE
    RAISE NOTICE '表 parts_specifications 不存在，已跳过';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='service_item_special_prices') THEN
    ALTER TABLE service_item_special_prices ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS service_item_special_prices_select ON service_item_special_prices;
    DROP POLICY IF EXISTS service_item_special_prices_insert ON service_item_special_prices;
    DROP POLICY IF EXISTS service_item_special_prices_update ON service_item_special_prices;
    DROP POLICY IF EXISTS service_item_special_prices_delete ON service_item_special_prices;
    CREATE POLICY service_item_special_prices_select ON service_item_special_prices FOR SELECT TO authenticated USING (true);
    CREATE POLICY service_item_special_prices_insert ON service_item_special_prices FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
    CREATE POLICY service_item_special_prices_update ON service_item_special_prices FOR UPDATE TO authenticated USING (public.has_role('admin','boss','warehouse'));
    CREATE POLICY service_item_special_prices_delete ON service_item_special_prices FOR DELETE TO authenticated USING (public.has_role('admin','boss','warehouse'));
  ELSE
    RAISE NOTICE '表 service_item_special_prices 不存在，已跳过';
  END IF;
END $$;

/* ========== 收尾：输出本次通电结果自检表（在结果面板查看） ========== */

SELECT t.tablename AS 表名, t.rowsecurity AS 已启用RLS,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename) AS 策略数
FROM pg_tables t
WHERE t.schemaname='public'
  AND t.tablename IN ('payroll_records','work_order_reimbursements','work_order_reimbursement_items',
    'company_contacts','customer_photos','vehicle_photos','members','finance_accounts',
    'finance_categories','accounts_payable','parts_specifications','service_item_special_prices')
ORDER BY t.tablename;
