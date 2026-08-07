/* ============================================================
   供应商报价图片（2026-08-06）

   供应商打开询价链接后，可给每个配件上传/删除图片（实物照片）。
   存在询价明细的 quoted_images 数组里；提交报价时回写到工单配件的
   图片表（work_order_item_part_media），采购员在工单里直接看到。
   ============================================================ */

ALTER TABLE supplier_quote_items
  ADD COLUMN IF NOT EXISTS quoted_images TEXT[] NOT NULL DEFAULT '{}';
