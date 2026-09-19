/* ============================================================
 * 施工用时统计报表聚合 RPC（2026-09-19，9-15 诊断🟠#11 收尾）
 *
 * 背景：reports/construction-stats 拉 construction_stats 全表到内存
 *   按"项目+车型+施工人"分组聚合，数据量涨后必超时；且搜索词直接拼 .or()
 *   未清洗（本迁移下推 SQL 后参数绑定，注入面一并消除）。
 * 口径对照（原 page.tsx）：
 *   分组键 = item_name|vehicle_brand|vehicle_series|vehicle_model_name|mechanic_name
 *     （JS 里 NULL 归到空串组 → SQL 用 COALESCE(col,'') 对齐）；
 *   vehicle_displacement 不在分组键，取组内代表值（MAX，同组车型下现实相同）；
 *   平均值 = ROUND(合计/次数)；排序 = 次数降序；
 *   顶部卡片 = 过滤后全量行数/施工秒数/中断秒数合计；
 *   筛选项 = completed 记录里 DISTINCT mechanic_name。
 * 权限：INVOKER（走调用者 RLS，与原页面直查口径一致），未登录拒绝。
 * 幂等：CREATE OR REPLACE（新函数无旧版），可重跑。
 * ============================================================ */

CREATE OR REPLACE FUNCTION public.report_construction_stats(
  p_mechanic TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
SET search_path = public
AS $func$
DECLARE
  v_groups JSONB;
  v_mechanics JSONB;
  v_total_rows INT;
  v_sum_construction NUMERIC;
  v_sum_pause NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  /* 分组聚合（过滤条件下推到 WHERE，参数绑定无注入面）；
     分组键 COALESCE 成空串对齐 JS（NULL 与 '' 归同组），SELECT 输出同源表达式 */
  SELECT COALESCE(jsonb_agg(row_to_json(g) ORDER BY g.cnt DESC), '[]'::jsonb)
  INTO v_groups
  FROM (
    SELECT item_name,
           COALESCE(vehicle_brand, '') AS vehicle_brand,
           COALESCE(vehicle_series, '') AS vehicle_series,
           COALESCE(vehicle_model_name, '') AS vehicle_model_name,
           MAX(vehicle_displacement) AS vehicle_displacement,
           mechanic_name,
           COUNT(*) AS cnt,
           COALESCE(SUM(COALESCE(construction_seconds, 0)), 0) AS total_construction_seconds,
           COALESCE(SUM(COALESCE(pause_seconds, 0)), 0) AS total_pause_seconds,
           COALESCE(SUM(COALESCE(total_seconds, 0)), 0) AS total_total_seconds,
           COALESCE(jsonb_agg(DISTINCT work_order_id), '[]'::jsonb) AS work_order_ids,
           ROUND(COALESCE(SUM(COALESCE(construction_seconds, 0)), 0) / COUNT(*)) AS avg_construction_seconds,
           ROUND(COALESCE(SUM(COALESCE(pause_seconds, 0)), 0) / COUNT(*)) AS avg_pause_seconds,
           ROUND(COALESCE(SUM(COALESCE(total_seconds, 0)), 0) / COUNT(*)) AS avg_total_seconds
    FROM work_order_item_construction_stats
    WHERE status = 'completed'
      AND (p_mechanic IS NULL OR mechanic_name = p_mechanic)
      AND (p_search IS NULL OR p_search = '' OR
           item_name ILIKE '%' || p_search || '%' OR
           vehicle_brand ILIKE '%' || p_search || '%' OR
           vehicle_series ILIKE '%' || p_search || '%' OR
           vehicle_model_name ILIKE '%' || p_search || '%')
    GROUP BY item_name,
             COALESCE(vehicle_brand, ''), COALESCE(vehicle_series, ''),
             COALESCE(vehicle_model_name, ''), mechanic_name
  ) g;

  /* 顶部卡片：过滤后全量行数与时长合计（不分组） */
  SELECT COUNT(*),
         COALESCE(SUM(COALESCE(construction_seconds, 0)), 0),
         COALESCE(SUM(COALESCE(pause_seconds, 0)), 0)
  INTO v_total_rows, v_sum_construction, v_sum_pause
  FROM work_order_item_construction_stats
  WHERE status = 'completed'
    AND (p_mechanic IS NULL OR mechanic_name = p_mechanic)
    AND (p_search IS NULL OR p_search = '' OR
         item_name ILIKE '%' || p_search || '%' OR
         vehicle_brand ILIKE '%' || p_search || '%' OR
         vehicle_series ILIKE '%' || p_search || '%' OR
         vehicle_model_name ILIKE '%' || p_search || '%');

  /* 技师筛选项：completed 记录去重（不受当前筛选影响，与原页面一致） */
  SELECT COALESCE(jsonb_agg(m.mechanic_name ORDER BY m.mechanic_name), '[]'::jsonb)
  INTO v_mechanics
  FROM (
    SELECT DISTINCT mechanic_name
    FROM work_order_item_construction_stats
    WHERE status = 'completed' AND mechanic_name IS NOT NULL
  ) m;

  RETURN jsonb_build_object(
    'groups', v_groups,
    'mechanics', v_mechanics,
    'total_rows', v_total_rows,
    'sum_construction_seconds', v_sum_construction,
    'sum_pause_seconds', v_sum_pause
  );
END;
$func$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.report_construction_stats(text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_construction_stats(text, text) TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_e_construction_stats.sql') ON CONFLICT DO NOTHING;
