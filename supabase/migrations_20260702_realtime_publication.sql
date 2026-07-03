/* ============================================================
   扩大实时同步：把工单详情页依赖的表加入 Realtime 发布
   目的：桌面/移动/采购各端在别人改动后能自动刷新，不止配件表。

   ⚠️ 在 Supabase 后台 SQL Editor 里【整段】运行一次即可（秒级完成）。
   可重复运行：已在发布中的表会跳过报错（用 DO 块逐个判断）。
   只改"发布成员"和"复制标识"，不动任何业务数据、不影响金额/库存。
   ============================================================ */

/* ── 第 1 步：把这些表加入 supabase_realtime 发布 ──
   work_order_item_parts 之前已加入，这里补齐其余详情页/采购页依赖的表。 */
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'work_orders',
    'work_order_items',
    'work_order_requirements',
    'work_order_inspections',
    'payments',
    'quality_checks',
    'advance_payment_records',
    'work_order_item_mechanics',
    'part_picking_records',
    'part_return_records',
    'supplier_return_records'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

/* ── 第 2 步：设置 REPLICA IDENTITY FULL ──
   让 UPDATE/DELETE 的变更消息里带上完整旧行，
   这样"按 work_order_id / work_order_item_id / work_order_item_part_id 过滤订阅"
   在删除、改动时也能被正确匹配到（否则默认只带主键，过滤会漏）。
   这些表都不大，FULL 的开销可忽略。 */
ALTER TABLE public.work_orders REPLICA IDENTITY FULL;
ALTER TABLE public.work_order_items REPLICA IDENTITY FULL;
ALTER TABLE public.work_order_requirements REPLICA IDENTITY FULL;
ALTER TABLE public.work_order_inspections REPLICA IDENTITY FULL;
ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.quality_checks REPLICA IDENTITY FULL;
ALTER TABLE public.advance_payment_records REPLICA IDENTITY FULL;
ALTER TABLE public.work_order_item_mechanics REPLICA IDENTITY FULL;
ALTER TABLE public.part_picking_records REPLICA IDENTITY FULL;
ALTER TABLE public.part_return_records REPLICA IDENTITY FULL;
ALTER TABLE public.supplier_return_records REPLICA IDENTITY FULL;
ALTER TABLE public.work_order_item_parts REPLICA IDENTITY FULL;
