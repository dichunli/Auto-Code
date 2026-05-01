-- ============================================================
-- 员工联系人（支持多联系人 + 关系说明）
-- ============================================================

CREATE TABLE employee_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  relationship TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_employee_contacts_profile ON employee_contacts(profile_id);
