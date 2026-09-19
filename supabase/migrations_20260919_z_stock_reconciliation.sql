/* ============================================================
 * 库存三方对账巡检（2026-09-19，严谨性整改阶段二 · 任务14）
 *
 * 背景：总库存(parts.quantity) / 批次合计(part_batches.remaining) /
 *   仓位合计(part_stock_locations.quantity) 三本账没有任何强制一致机制，
 *   历史上多条路径会造成漂移（已逐一修复）。
 *   本函数提供一键巡检：找出三方不一致的配件清单，
 *   作为按仓位盘点纠偏的目标清单，也是修复效果的长期监控。
 *
 * 口径：
 *   批次差异 = 总库存 − 批次合计（正数=批次账少了，如期初未批次化的老数据）
 *   仓位差异 = 总库存 − 仓位合计（正数=仓位账少了，如不带仓位入库的老路径）
 *   两个差异都为 0 的配件不返回（一致）。
 *
 * 权限：INVOKER（走调用者 RLS，与报表函数同口径），未登录拒绝。
 * 幂等：新函数 CREATE OR REPLACE，可重跑。
 * ============================================================ */

CREATE OR REPLACE FUNCTION public.report_stock_reconciliation()
RETURNS JSONB
SET search_path = public
AS $func$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  RETURN (
    WITH 批次 AS (
      SELECT part_id, SUM(remaining) AS qty FROM part_batches GROUP BY part_id
    ),
    仓位 AS (
      SELECT part_id, SUM(quantity) AS qty FROM part_stock_locations GROUP BY part_id
    )
    SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.part_number), '[]'::jsonb)
    FROM (
      SELECT p.id AS part_id,
             p.part_number,
             p.name,
             p.quantity AS total_qty,
             COALESCE(b.qty, 0) AS batch_qty,
             COALESCE(l.qty, 0) AS location_qty,
             p.quantity - COALESCE(b.qty, 0) AS batch_diff,
             p.quantity - COALESCE(l.qty, 0) AS location_diff
      FROM parts p
      LEFT JOIN 批次 b ON b.part_id = p.id
      LEFT JOIN 仓位 l ON l.part_id = p.id
      WHERE p.quantity <> COALESCE(b.qty, 0)
         OR p.quantity <> COALESCE(l.qty, 0)
    ) r
  );
END;
$func$ LANGUAGE plpgsql STABLE;

REVOKE EXECUTE ON FUNCTION public.report_stock_reconciliation() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_stock_reconciliation() TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_z_stock_reconciliation.sql') ON CONFLICT DO NOTHING;
