/* ═══════════════════════════════════════════════════════════
 * 2026-09-12 入库单/采购明细的批次外键补建（404 事故修复）
 *
 * 背景：9月4 日 migrations_20260904_receiving_staged.sql 给
 *   inbound_orders 和 purchase_order_items 裸加 receiving_batch_id 列时
 *   漏了 REFERENCES 外键约束。入库单详情页 page.tsx 的 select 里 join 了
 *   receiving_batches(batch_no)，PostgREST 在 schema cache 里找不到该关系
 *   报 PGRST200，supabase-js 返回 data=null，page.tsx 误判"单不存在"
 *   notFound()——表现为入库单详情页稳定 404
 *  （2026-09-12 蓝天汽配 RK-20260912-001 详情页 404 事故）。
 *
 * 处理：
 *   1. 防御性清理指向已不存在批次的孤儿引用（理论上 0 行，防加约束失败）
 *   2. 两张表补 FK（ON DELETE SET NULL：批次被删不清空入库单/明细的指向历史）
 *   3. NOTIFY 让 PostgREST 立即重载 schema cache，不必等自动刷新
 * ═══════════════════════════════════════════════════════════ */

/* 防御：孤儿引用置 NULL（指向已不存在批次的值，正常应为 0 行受影响） */
UPDATE public.inbound_orders io SET receiving_batch_id = NULL
  WHERE receiving_batch_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.receiving_batches rb WHERE rb.id = io.receiving_batch_id);

UPDATE public.purchase_order_items poi SET receiving_batch_id = NULL
  WHERE receiving_batch_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.receiving_batches rb WHERE rb.id = poi.receiving_batch_id);

/* 补外键（IF NOT EXISTS 兼容重复执行：Postgres 无 ADD CONSTRAINT IF NOT EXISTS，
   用 DO 块判断） */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inbound_orders_receiving_batch_id_fkey'
  ) THEN
    ALTER TABLE public.inbound_orders
      ADD CONSTRAINT inbound_orders_receiving_batch_id_fkey
      FOREIGN KEY (receiving_batch_id) REFERENCES public.receiving_batches(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_receiving_batch_id_fkey'
  ) THEN
    ALTER TABLE public.purchase_order_items
      ADD CONSTRAINT purchase_order_items_receiving_batch_id_fkey
      FOREIGN KEY (receiving_batch_id) REFERENCES public.receiving_batches(id) ON DELETE SET NULL;
  END IF;
END $$;

/* 让 PostgREST 立即重载 schema cache，join 立即可用 */
NOTIFY pgrst, 'reload schema';

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260912_a_inbound_orders_receiving_batch_fk.sql');
