/* ============================================================
 * 三层库存数量列补负库存约束（2026-09-19，严谨性整改阶段二 · 任务9）
 *
 * 问题：parts.quantity / part_batches.remaining / part_stock_locations.quantity
 *   三列没有任何数据库层兜底，防负全靠 RPC 内的过程式防护。
 *   一旦有代码路径绕过 RPC 直写（历史上 submitPart 就这么干），
 *   数据库层没有任何东西拦得住负库存。
 *
 * 现状核查（2026-09-19 生产库只读查询）：三张表负值行数均为 0，可以加约束。
 *
 * 写法：NOT VALID 添加（不扫表现有数据、秒级、几乎不锁表）+ VALIDATE
 *   校验存量；VALIDATE 失败说明部署窗口内出现了负值，迁移应失败报警，
 *   先清数据再加——宁可响亮的失败，不要静默的脏数据。
 * 幂等：DO 块判重，重跑无害。
 * ============================================================ */

DO $$
BEGIN
  /* parts.quantity ≥ 0 */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parts_quantity_nonnegative') THEN
    ALTER TABLE public.parts
      ADD CONSTRAINT parts_quantity_nonnegative CHECK (quantity >= 0) NOT VALID;
    ALTER TABLE public.parts VALIDATE CONSTRAINT parts_quantity_nonnegative;
  END IF;

  /* part_batches.remaining ≥ 0（出库扣的是剩余量，绝不能为负） */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_batches_remaining_nonnegative') THEN
    ALTER TABLE public.part_batches
      ADD CONSTRAINT part_batches_remaining_nonnegative CHECK (remaining >= 0) NOT VALID;
    ALTER TABLE public.part_batches VALIDATE CONSTRAINT part_batches_remaining_nonnegative;
  END IF;

  /* part_batches.quantity ≥ 0（批次原始入库量） */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_batches_quantity_nonnegative') THEN
    ALTER TABLE public.part_batches
      ADD CONSTRAINT part_batches_quantity_nonnegative CHECK (quantity >= 0) NOT VALID;
    ALTER TABLE public.part_batches VALIDATE CONSTRAINT part_batches_quantity_nonnegative;
  END IF;

  /* part_stock_locations.quantity ≥ 0 */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_stock_locations_quantity_nonnegative') THEN
    ALTER TABLE public.part_stock_locations
      ADD CONSTRAINT part_stock_locations_quantity_nonnegative CHECK (quantity >= 0) NOT VALID;
    ALTER TABLE public.part_stock_locations VALIDATE CONSTRAINT part_stock_locations_quantity_nonnegative;
  END IF;
END $$;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_t_negative_stock_guard.sql') ON CONFLICT DO NOTHING;
