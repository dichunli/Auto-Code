-- ============================================================
-- 物流运单（记录物流单号、物流公司、运费、代收款）
-- ============================================================

CREATE TABLE logistics_waybills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_no TEXT NOT NULL,
  logistics_company_id UUID REFERENCES logistics_companies(id),
  logistics_company_name TEXT,
  freight_amount DECIMAL(10,2) DEFAULT 0,
  cod_amount DECIMAL(10,2) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'returned')),
  received_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_waybills_tracking ON logistics_waybills(tracking_no);
CREATE INDEX idx_waybills_status ON logistics_waybills(status);
CREATE INDEX idx_waybills_company ON logistics_waybills(logistics_company_id);

-- 入库日志关联运单
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS waybill_id UUID REFERENCES logistics_waybills(id);

CREATE INDEX idx_inventory_logs_waybill ON inventory_logs(waybill_id);
