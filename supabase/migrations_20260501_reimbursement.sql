-- ============================================================
-- 报销单（独立于工单的报销凭证，不影响利润/绩效/库存）
-- ============================================================

CREATE TABLE work_order_reimbursements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  title TEXT DEFAULT '维修费用报销单',
  company_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(work_order_id)
);

CREATE TABLE work_order_reimbursement_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reimbursement_id UUID NOT NULL REFERENCES work_order_reimbursements(id) ON DELETE CASCADE,
  source_item_id UUID, -- 关联原始工单项目（仅参考，不影响原始数据）
  name TEXT NOT NULL,
  spec TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX idx_reimbursements_work_order ON work_order_reimbursements(work_order_id);
CREATE INDEX idx_reimbursement_items_reimbursement ON work_order_reimbursement_items(reimbursement_id);
