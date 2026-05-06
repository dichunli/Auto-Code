-- 为 work_order_requirements 添加派单人字段
ALTER TABLE work_order_requirements
  ADD COLUMN IF NOT EXISTS dispatcher_id UUID REFERENCES profiles(id);

-- 为 service_categories 添加派单提成和领单提成字段
ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS dispatch_commission_type TEXT CHECK (dispatch_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  ADD COLUMN IF NOT EXISTS dispatch_commission_value DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS claim_commission_type TEXT CHECK (claim_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  ADD COLUMN IF NOT EXISTS claim_commission_value DECIMAL(10,2);

-- 为 service_names 添加派单提成和领单提成字段
ALTER TABLE service_names
  ADD COLUMN IF NOT EXISTS dispatch_commission_type TEXT CHECK (dispatch_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  ADD COLUMN IF NOT EXISTS dispatch_commission_value DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS claim_commission_type TEXT CHECK (claim_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  ADD COLUMN IF NOT EXISTS claim_commission_value DECIMAL(10,2);

-- 为 service_items 添加派单提成和领单提成字段
ALTER TABLE service_items
  ADD COLUMN IF NOT EXISTS dispatch_commission_type TEXT CHECK (dispatch_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  ADD COLUMN IF NOT EXISTS dispatch_commission_value DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS claim_commission_type TEXT CHECK (claim_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  ADD COLUMN IF NOT EXISTS claim_commission_value DECIMAL(10,2);
