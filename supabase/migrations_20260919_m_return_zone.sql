/* ============================================================
 * 仓位支持"退料区"标记（2026-09-19 用户拍板）
 * 背景：退给供应商的货有些单独存放在专门仓位（退料区），
 *   退货弹窗的退自仓位应优先带出退料区，方便仓管核对。
 * 改动：warehouse_locations 加 is_return_zone 标记；
 *   退货弹窗预填退自仓位时，该配件在退料区有库存则优先选中退料区。
 * 幂等：ADD COLUMN IF NOT EXISTS，可重跑。
 * ============================================================ */

ALTER TABLE public.warehouse_locations ADD COLUMN IF NOT EXISTS is_return_zone BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.warehouse_locations.is_return_zone IS '退料区：单独存放待退供应商货物的仓位，退货弹窗优先带出';

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260919_m_return_zone.sql', '仓位加退料区标记，退货弹窗退自仓位优先带出退料区')
ON CONFLICT (file_name) DO NOTHING;
