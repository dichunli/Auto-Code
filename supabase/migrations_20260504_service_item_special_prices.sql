-- 维修项目指定用户价格（单位/客户/客户+车辆）
CREATE TABLE IF NOT EXISTS service_item_special_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_item_id UUID NOT NULL REFERENCES service_items(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sisp_service_item ON service_item_special_prices(service_item_id);
CREATE INDEX IF NOT EXISTS idx_sisp_company ON service_item_special_prices(company_id);
CREATE INDEX IF NOT EXISTS idx_sisp_customer ON service_item_special_prices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sisp_vehicle ON service_item_special_prices(vehicle_id);
