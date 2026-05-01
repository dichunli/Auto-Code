-- ============================================================
-- 财务管理 & 报表统计 数据库迁移
-- ============================================================

-- ============================================================
-- 1. 资金账户
-- ============================================================
CREATE TABLE finance_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('cash','bank','wechat','alipay','other')),
  balance DECIMAL(12,2) DEFAULT 0,
  opening_balance DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO finance_accounts (name, account_type, opening_balance) VALUES
('现金账户', 'cash', 0),
('微信商户', 'wechat', 0),
('支付宝商户', 'alipay', 0);

-- ============================================================
-- 2. 收支分类
-- ============================================================
CREATE TABLE finance_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO finance_categories (name, type, sort_order) VALUES
('维修收入', 'income', 1),
('配件销售', 'income', 2),
('其他收入', 'income', 3),
('配件采购', 'expense', 1),
('员工工资', 'expense', 2),
('场地租金', 'expense', 3),
('水电杂费', 'expense', 4),
('其他支出', 'expense', 5);

-- ============================================================
-- 3. 收支流水
-- ============================================================
CREATE TABLE finance_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES finance_accounts(id),
  category_id UUID REFERENCES finance_categories(id),
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount DECIMAL(12,2) NOT NULL,
  related_type TEXT CHECK (related_type IN ('work_order','purchase_order','payroll','other')),
  related_id UUID,
  description TEXT,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_finance_transactions_date ON finance_transactions(transaction_date);
CREATE INDEX idx_finance_transactions_type ON finance_transactions(type);
CREATE INDEX idx_finance_transactions_related ON finance_transactions(related_type, related_id);

-- ============================================================
-- 4. 应收账款
-- ============================================================
CREATE TABLE accounts_receivable (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  work_order_id UUID REFERENCES work_orders(id),
  amount DECIMAL(12,2) NOT NULL,
  paid_amount DECIMAL(12,2) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','cancelled')),
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ar_customer ON accounts_receivable(customer_id);
CREATE INDEX idx_ar_status ON accounts_receivable(status);

-- ============================================================
-- 5. 应付账款
-- ============================================================
CREATE TABLE accounts_payable (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID REFERENCES suppliers(id),
  purchase_order_id UUID REFERENCES purchase_orders(id),
  amount DECIMAL(12,2) NOT NULL,
  paid_amount DECIMAL(12,2) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','cancelled')),
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ap_supplier ON accounts_payable(supplier_id);
CREATE INDEX idx_ap_status ON accounts_payable(status);

-- ============================================================
-- 6. 工资/提成记录
-- ============================================================
CREATE TABLE payroll_records (
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

CREATE INDEX idx_payroll_profile ON payroll_records(profile_id);
CREATE INDEX idx_payroll_period ON payroll_records(period_start, period_end);
CREATE INDEX idx_payroll_status ON payroll_records(status);

-- ============================================================
-- 7. 更新角色权限
-- ============================================================
UPDATE roles SET permissions = ARRAY['*'] WHERE name = 'admin';
UPDATE roles SET permissions = ARRAY['report:view','report:profit','report:performance','dashboard:all','customer:manage','vehicle:manage','payment:manage'] WHERE name = 'boss';
UPDATE roles SET permissions = ARRAY['payment:manage','report:view','report:profit','report:performance'] WHERE name = 'accountant';

-- ============================================================
-- 8. 触发器：更新账户余额
-- ============================================================
CREATE OR REPLACE FUNCTION update_account_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.type = 'income' THEN
      UPDATE finance_accounts SET balance = balance + NEW.amount WHERE id = NEW.account_id;
    ELSIF NEW.type = 'expense' THEN
      UPDATE finance_accounts SET balance = balance - NEW.amount WHERE id = NEW.account_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.type = 'income' THEN
      UPDATE finance_accounts SET balance = balance - OLD.amount WHERE id = OLD.account_id;
    ELSIF OLD.type = 'expense' THEN
      UPDATE finance_accounts SET balance = balance + OLD.amount WHERE id = OLD.account_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_account_balance
AFTER INSERT OR DELETE ON finance_transactions
FOR EACH ROW EXECUTE FUNCTION update_account_balance();

-- ============================================================
-- 9. 视图：营收日报
-- ============================================================
CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT
  DATE(wo.settled_at) AS date,
  COUNT(*) AS order_count,
  SUM(wo.parts_cost) AS total_parts_cost,
  SUM(wo.labor_cost) AS total_labor_cost,
  SUM(wo.other_cost) AS total_other_cost,
  SUM(wo.total_cost) AS total_revenue,
  SUM(COALESCE(p.amount, 0)) AS total_paid
FROM work_orders wo
LEFT JOIN (
  SELECT work_order_id, SUM(amount) AS amount FROM payments GROUP BY work_order_id
) p ON p.work_order_id = wo.id
WHERE wo.status IN ('settled', 'delivered')
  AND wo.settled_at IS NOT NULL
GROUP BY DATE(wo.settled_at)
ORDER BY date DESC;

-- ============================================================
-- 12. 视图：员工业绩
-- ============================================================
CREATE OR REPLACE VIEW v_mechanic_performance AS
SELECT
  p.id AS profile_id,
  p.full_name,
  ml.name AS level_name,
  COUNT(DISTINCT woi.work_order_id) AS work_order_count,
  COUNT(DISTINCT woi.id) AS item_count,
  SUM(woi.total_price) AS total_item_value,
  SUM(wo.duration_seconds / 3600.0) AS total_hours
FROM profiles p
LEFT JOIN mechanic_levels ml ON ml.id = p.mechanic_level_id
LEFT JOIN work_order_items woi ON woi.mechanic_id = p.id AND woi.status = 'completed'
LEFT JOIN work_order_item_construction_logs wo ON wo.mechanic_id = p.id AND wo.action = 'complete'
WHERE p.is_active = TRUE
GROUP BY p.id, p.full_name, ml.name;

-- ============================================================
-- 13. 视图：库存周转
-- ============================================================
CREATE OR REPLACE VIEW v_inventory_turnover AS
SELECT
  pn.id AS part_name_id,
  pn.name AS part_name,
  pc.name AS category_name,
  COALESCE(SUM(p.stock_quantity), 0) AS total_stock,
  COALESCE(SUM(p.stock_quantity * p.average_cost), 0) AS total_value,
  COALESCE(SUM(il.out_quantity), 0) AS total_out_30d,
  CASE
    WHEN COALESCE(SUM(p.stock_quantity), 0) > 0
    THEN ROUND(COALESCE(SUM(il.out_quantity), 0) * 30.0 / NULLIF(SUM(p.stock_quantity), 0), 2)
    ELSE NULL
  END AS turnover_days
FROM part_names pn
LEFT JOIN part_categories pc ON pc.id = pn.category_id
LEFT JOIN parts p ON p.part_name_id = pn.id
LEFT JOIN inventory_logs il ON il.part_id = p.id AND il.type = 'out' AND il.created_at >= NOW() - INTERVAL '30 days'
GROUP BY pn.id, pn.name, pc.name;
