/* 给 purchase_orders 增加 logistics_company_id 字段
   场景:采购管理「待采购」Tab 中发起采购时批量选择物流公司,
         需要在采购单上记录所选物流公司,以便「待收货」按物流公司分组。 */

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS logistics_company_id UUID REFERENCES logistics_companies(id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_logistics_company ON purchase_orders(logistics_company_id);
