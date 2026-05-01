-- ============================================================
-- 会员 / 储值卡管理
-- ============================================================

CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_no TEXT NOT NULL UNIQUE,
  customer_id UUID REFERENCES customers(id),
  name TEXT NOT NULL,
  phone TEXT,
  balance DECIMAL(10,2) DEFAULT 0 NOT NULL,
  discount_rate DECIMAL(3,2) DEFAULT 1.00 NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'expired')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_members_card_no ON members(card_no);
CREATE INDEX idx_members_phone ON members(phone);
CREATE INDEX idx_members_customer ON members(customer_id);
CREATE INDEX idx_members_status ON members(status);

CREATE TABLE member_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('recharge', 'consume', 'refund')),
  amount DECIMAL(10,2) NOT NULL,
  balance_after DECIMAL(10,2) NOT NULL,
  work_order_id UUID REFERENCES work_orders(id),
  payment_method TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_member_transactions_member ON member_transactions(member_id);
CREATE INDEX idx_member_transactions_work_order ON member_transactions(work_order_id);
CREATE INDEX idx_member_transactions_created ON member_transactions(created_at);
