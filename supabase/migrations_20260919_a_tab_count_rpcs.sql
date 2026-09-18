/* ============================================================
 * 看板角标计数 RPC：采购 12 项 + 领料 4 项（2026-09-19）
 *
 * 9-15 诊断🟠#12：ProcurementTabBar / PickingTabBar 拉 2000 行进浏览器数数，
 *   超 2000 行角标静默失真（比慢更糟）。收编为数据库端聚合：
 *   一次 RPC 返回全部角标数字，不再拉行。
 * 口径说明：逐行对齐原客户端过滤逻辑（注释标明出处），修复"超 2000 截断失真"。
 * 权限：INVOKER（走调用者 RLS，与原客户端直查口径一致），未登录拒绝。
 * 幂等：CREATE OR REPLACE（新函数无旧版），可重跑。
 * ============================================================ */

/* ─── 一、采购看板 12 角标（对齐 ProcurementTabBar.tsx loadCounts 原口径） ─── */
CREATE OR REPLACE FUNCTION public.procurement_tab_counts()
RETURNS JSONB
SET search_path = public
AS $func$
DECLARE
  v_inquiry INT;          /* 待询价：未采购未到货 + 无成本价 */
  v_quote INT;            /* 待报价：有成本价 + 无销售价 */
  v_confirm INT;          /* 待确认：双价齐 + 客户意见 pending */
  v_purchase INT;         /* 待采购：双价齐 + 客户同意 +（无档案或无库存），外加自定义采购暂存行数 */
  v_staging INT;
  v_receipt INT;          /* 待收货：在途采购单中存在未处理明细的单数 */
  v_pending_storage INT;  /* 待入库单数 */
  v_completed_storage INT;/* 已入库单数 */
  v_pending_return INT;   /* 待退货记录数 */
  v_completed_return INT; /* 已退货记录数 */
  v_inbound INT;          /* 正式入库单（completed）数 */
  v_return_orders INT;    /* 采退单总数 */
  v_quote_sheets INT;     /* 供应商已报价待采用的询价单数 */
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  /* 前 4 项：工单配件（未结算/非作废/非保养单/未采购/未到货），原代码逐行 if 分支 */
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(p.unit_cost, 0) <= 0),
    COUNT(*) FILTER (WHERE COALESCE(p.unit_cost, 0) > 0 AND COALESCE(p.unit_price, 0) <= 0),
    COUNT(*) FILTER (WHERE COALESCE(p.unit_cost, 0) > 0 AND COALESCE(p.unit_price, 0) > 0
                     AND COALESCE(p.customer_opinion, 'pending') = 'pending'),
    COUNT(*) FILTER (WHERE COALESCE(p.unit_cost, 0) > 0 AND COALESCE(p.unit_price, 0) > 0
                     AND p.customer_opinion = 'agree'
                     AND (p.part_id IS NULL OR COALESCE(pt.quantity, 0) <= 0))
  INTO v_inquiry, v_quote, v_confirm, v_purchase
  FROM work_order_item_parts p
  JOIN work_order_items i ON i.id = p.work_order_item_id
  JOIN work_orders w ON w.id = i.work_order_id
  LEFT JOIN parts pt ON pt.id = p.part_id
  WHERE w.settled_at IS NULL
    AND COALESCE(w.order_type, '') NOT IN ('cancelled', 'maintenance')
    AND NOT COALESCE(p.is_purchased, false)
    AND NOT COALESCE(p.is_arrived, false);

  /* 自定义采购暂存（安全库存补货/手工添加）也计入待采购 */
  SELECT COUNT(*) INTO v_staging FROM custom_purchase_staging;
  v_purchase := v_purchase + v_staging;

  /* 待收货：submitted/approved/partial_received 单中有明细未标 handle_action 的单数
     （原口径 items.some(it => !it.handle_action) → EXISTS 等价） */
  SELECT COUNT(*) INTO v_receipt
  FROM purchase_orders o
  WHERE o.status IN ('submitted', 'approved', 'partial_received')
    AND EXISTS (
      SELECT 1 FROM purchase_order_items it
      WHERE it.order_id = o.id AND it.handle_action IS NULL
    );

  SELECT COUNT(*) INTO v_pending_storage FROM purchase_orders WHERE status = 'pending_storage';
  SELECT COUNT(*) INTO v_completed_storage FROM purchase_orders WHERE status = 'completed';
  SELECT COUNT(*) INTO v_pending_return FROM supplier_return_records WHERE status = 'pending';
  SELECT COUNT(*) INTO v_completed_return FROM supplier_return_records WHERE status = 'completed';
  /* 入库单只数正式单，待确认 draft 不计入 */
  SELECT COUNT(*) INTO v_inbound FROM inbound_orders WHERE status = 'completed';
  SELECT COUNT(*) INTO v_return_orders FROM purchase_return_orders;
  SELECT COUNT(*) INTO v_quote_sheets FROM supplier_quote_sheets WHERE status = 'submitted';

  RETURN jsonb_build_object(
    'pending_inquiry', v_inquiry,
    'pending_quote', v_quote,
    'pending_confirm', v_confirm,
    'pending_purchase', v_purchase,
    'pending_receipt', v_receipt,
    'pending_storage', v_pending_storage,
    'completed_storage', v_completed_storage,
    'pending_return', v_pending_return,
    'completed_return', v_completed_return,
    'inbound_orders', v_inbound,
    'return_orders', v_return_orders,
    'quote_sheets', v_quote_sheets
  );
END;
$func$ LANGUAGE plpgsql;

/* ─── 二、领料看板 4 角标（对齐 PickingTabBar.tsx loadCounts 原口径） ─── */
CREATE OR REPLACE FUNCTION public.picking_tab_counts()
RETURNS JSONB
SET search_path = public
AS $func$
DECLARE
  v_pending_pick INT;   /* 待领料：选中分支+客户同意+净领未达+（有库存或待入库中） */
  v_picked INT;         /* 已领料：confirmed 领料单数 */
  v_pending_return INT; /* 待退料：pending 退料申请数 */
  v_returned INT;       /* 已退料：退料单总数 */
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  /* 候选分支：选中+客户同意+工单未结算/非作废/非 settled/delivered（与 page.tsx 待领料 Tab 同口径） */
  WITH cand AS (
    SELECT p.id, COALESCE(p.quantity, 0) AS 需求数, p.part_id, COALESCE(pt.quantity, 0) AS 库存数
    FROM work_order_item_parts p
    JOIN work_order_items i ON i.id = p.work_order_item_id
    JOIN work_orders w ON w.id = i.work_order_id
    LEFT JOIN parts pt ON pt.id = p.part_id
    WHERE p.is_selected = true
      AND p.customer_opinion = 'agree'
      AND w.settled_at IS NULL
      AND COALESCE(w.order_type, '') <> 'cancelled'
      AND w.status NOT IN ('settled', 'delivered')
  ),
  /* 净领 = 累计实领 - 累计退料（退多于领时按 0 算，对齐 Math.max(0, 净领)） */
  net AS (
    SELECT bid, SUM(qty) AS net_qty FROM (
      SELECT work_order_item_part_id AS bid, quantity AS qty
      FROM part_picking_records WHERE work_order_item_part_id IN (SELECT id FROM cand)
      UNION ALL
      SELECT work_order_item_part_id AS bid, -quantity AS qty
      FROM part_return_records WHERE work_order_item_part_id IN (SELECT id FROM cand)
    ) t GROUP BY bid
  ),
  /* 待入库中：采购明细挂的收货批次 pending_storage，或采购单 pending_storage */
  pending_inbound AS (
    SELECT DISTINCT poi.work_order_item_part_id AS bid
    FROM purchase_order_items poi
    LEFT JOIN receiving_batches rb ON rb.id = poi.receiving_batch_id
    LEFT JOIN purchase_orders po ON po.id = poi.order_id
    WHERE poi.work_order_item_part_id IN (SELECT id FROM cand)
      AND (rb.status = 'pending_storage' OR po.status = 'pending_storage')
  )
  SELECT COUNT(*) INTO v_pending_pick
  FROM cand c
  LEFT JOIN net n ON n.bid = c.id
  WHERE c.需求数 - GREATEST(0, COALESCE(n.net_qty, 0)) > 0
    AND (
      (c.part_id IS NOT NULL AND c.库存数 > 0)
      OR EXISTS (SELECT 1 FROM pending_inbound pi WHERE pi.bid = c.id)
    );

  SELECT COUNT(*) INTO v_picked FROM picking_orders WHERE status = 'confirmed';
  SELECT COUNT(*) INTO v_pending_return FROM part_return_requests WHERE status = 'pending';
  SELECT COUNT(*) INTO v_returned FROM material_return_orders;

  RETURN jsonb_build_object(
    'pending_pick', v_pending_pick,
    'picked', v_picked,
    'pending_return', v_pending_return,
    'returned', v_returned
  );
END;
$func$ LANGUAGE plpgsql;

/* ─── 权限：收回匿名，放行登录用户（对齐其他只读统计函数） ─── */
REVOKE EXECUTE ON FUNCTION public.procurement_tab_counts() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.procurement_tab_counts() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.picking_tab_counts() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.picking_tab_counts() TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_a_tab_count_rpcs.sql') ON CONFLICT DO NOTHING;
