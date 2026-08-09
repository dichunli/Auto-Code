/* ============================================================
   询价明细支持供应商添加备选分支（2026-08-06）

   供应商在报价页可对同一配件"+分支"报备选（多品牌/多价格选择）：
   新增的明细行标记 is_supplier_added=true，只能删自己加的分支；
   提交报价时自动在工单里生成同目录的新分支（is_selected=false）。
   ============================================================ */

ALTER TABLE supplier_quote_items
  ADD COLUMN IF NOT EXISTS is_supplier_added BOOLEAN NOT NULL DEFAULT false;

/* 提交报价后生成的工单分支 id：重复提交时更新同一分支，不会重复创建 */
ALTER TABLE supplier_quote_items
  ADD COLUMN IF NOT EXISTS created_branch_id UUID;
