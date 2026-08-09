/*
 * 补建真实库缺失的 4 张表（2026-08-06，经用户拍板"都在用，全部补建"）
 * 背景：RLS 通电时发现 payroll_records / work_order_reimbursements(+items) /
 *       company_contacts 在真实库不存在（早期迁移未执行），对应工资页/报销单/
 *       单位联系人功能一直打不开。本文件补建并顺手通电 RLS。
 * 结构来源：migrations_20260501_finance_reports.sql、20260501_reimbursement.sql、
 *           20260503_company_contacts_invoice.sql（原样搬运，含索引）
 * 附带：companies 表开票信息 6 个字段（与 company_contacts 同批迁移，一并补齐）
 * 全部幂等：IF NOT EXISTS，可重复执行。
 */

/* ========== 一、工资表（财务-工资页） ========== */

CREATE TABLE IF NOT EXISTS payroll_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  base_salary DECIMAL(12,2) DEFAULT 0,
  commission_diagnosis DECIMAL(12,2) DEFAULT 0,
  commission_repair DECIMAL(12,2) DEFAULT 0,
  commission_sales DECIMAL(12,2) DEFAULT 0,
  commission_qc DECIMAL(12,2) DEFAULT 0,
  commission_picking DECIMAL(12,2) DEFAULT 0,
  commission_total DECIMAL(12,2) GENERATED ALWAYS AS (
    COALESCE(commission_diagnosis,0) + COALESCE(commission_repair,0) +
    COALESCE(commission_sales,0) + COALESCE(commission_qc,0) + COALESCE(commission_picking,0)
  ) STORED,
  bonus DECIMAL(12,2) DEFAULT 0,
  deduction DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) GENERATED ALWAYS AS (
    COALESCE(base_salary,0) + COALESCE(commission_total,0) + COALESCE(bonus,0) - COALESCE(deduction,0)
  ) STORED,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_profile ON payroll_records(profile_id);
CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll_records(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll_records(status);

/* 工资表 RLS：仅 admin/boss/accountant 可读写（工资保密，2026-08-06 用户拍板） */
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

/* ========== 二、报销单两表（工单详情-报销单，独立于工单不影响利润/绩效/库存） ========== */

CREATE TABLE IF NOT EXISTS work_order_reimbursements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  title TEXT DEFAULT '维修费用报销单',
  company_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(work_order_id)
);

CREATE TABLE IF NOT EXISTS work_order_reimbursement_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reimbursement_id UUID NOT NULL REFERENCES work_order_reimbursements(id) ON DELETE CASCADE,
  source_item_id UUID, /* 关联原始工单项目（仅参考，不影响原始数据） */
  name TEXT NOT NULL,
  spec TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reimbursements_work_order ON work_order_reimbursements(work_order_id);
CREATE INDEX IF NOT EXISTS idx_reimbursement_items_reimbursement ON work_order_reimbursement_items(reimbursement_id);

/* 报销单 RLS：登录可读，admin/boss/receptionist/accountant 可写（对齐 payments） */
ALTER TABLE work_order_reimbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_reimbursement_items ENABLE ROW LEVEL SECURITY;

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

/* ========== 三、单位联系人表 + 单位开票信息字段（客户单位模块） ========== */

CREATE TABLE IF NOT EXISTS company_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_contacts_company ON company_contacts(company_id);

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS invoice_title TEXT,
  ADD COLUMN IF NOT EXISTS tax_no TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account TEXT,
  ADD COLUMN IF NOT EXISTS invoice_address TEXT,
  ADD COLUMN IF NOT EXISTS invoice_phone TEXT;

/* 单位联系人 RLS：登录用户全访问（对齐 customers 模式） */
ALTER TABLE company_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_contacts_auth ON company_contacts;
CREATE POLICY company_contacts_auth ON company_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);

/* ========== 自检：4 张表应全部"已启用RLS=true" ========== */

SELECT t.tablename AS 表名, t.rowsecurity AS 已启用RLS,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename) AS 策略数
FROM pg_tables t
WHERE t.schemaname='public'
  AND t.tablename IN ('payroll_records','work_order_reimbursements','work_order_reimbursement_items','company_contacts')
ORDER BY t.tablename;
