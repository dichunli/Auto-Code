/* 已入库采购单回滚事务 + 撤销退货函数修正（2026-08-16 批次1 错账风险收口）
 *
 * 背景（采购流程梳理 2026-08 问题清单 高危1 / 中危6）：
 *   1. 「已入库 → 退回待入库」此前是客户端 10 步连环写(CompletedStorageList.tsx)，
 *      无事务、库存先读再写，且 inbound_orders 等表 RLS 仅 admin 可写——
 *      非 admin 用户执行时删除静默 0 行，造成"库存已扣、单据还在"的错账。
 *   2. 存量 bug：complete_purchase_inbound 第 6 步对破损/错发/弃货明细按订购量
 *      减了 parts.quantity（退库等退货），但两个撤销路径（本函数/revoke_supplier_returns）
 *      只按入库明细扣回，没有回补退库量 → 撤销后破损/错发配件库存少算。
 *   3. complete_purchase_inbound 第 8.5 步把工单配件行 is_arrived 置 true，
 *      撤销路径都不回退 → 撤销后工单配件仍显示"已到货"。
 *
 * 本迁移：
 *   一、revoke_completed_inbound —— 新函数：已入库单整单回滚，一个事务
 *   二、revoke_supplier_returns   —— CREATE OR REPLACE 修正：已入库分支同样
 *        补退库回补 + is_arrived 回退；角色门禁直接写进函数体
 *       （此前门禁靠 20260814 迁移锚点注入，重建函数体会丢失，本次顺手固化）
 *
 * 设计要点（与原客户端 10 步的差异，均为有意改进）：
 *   · 库存回滚用"净额聚合 + 扣前预检报错"，替代逐行 GREATEST(0,...) 钳制——
 *     钳制会无声吞掉"入库后配件被领料/盘点调整"的差额（正是要消灭的错账）；
 *     预检不足直接报错整单回滚，提示人工核对（与批次 FK 拦截同一"显式失败"哲学）。
 *   · 退库回补只补 parts 总库存、严禁补仓位——入库第 6 步退库只动了 parts，
 *     没动 part_stock_locations，仓位只按入库量对称扣回。
 *   · 已生成采退单（有 completed 退货记录）的采购单拒绝回滚——货可能已寄回供应商，
 *     需先在「已退货」页撤销采退单。
 *   · purchase_price（最近采购价）不回退：入库时旧值未存，无法还原。
 *   · 运单状态不动（与原客户端一致）。
*/

/* ============================================================
   一、已入库采购单整单回滚（原子事务）
   参数: p_purchase_order_id 采购单 id(必须处于 completed)
   返回: { success, error? }
   ============================================================ */
CREATE OR REPLACE FUNCTION revoke_completed_inbound(
  p_purchase_order_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_inbound_ids UUID[];
  v_不足编码 TEXT;
  v_当前库存 INTEGER;
  v_需扣回 BIGINT;
  v_仓位不足编码 TEXT;
BEGIN
  /* 0. 登录校验 + 角色门禁(直接写进函数体,不再依赖锚点注入) */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 1. 锁定采购单并校验状态(与 complete_purchase_inbound 互斥) */
  SELECT * INTO v_order FROM purchase_orders WHERE id = p_purchase_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', '仅「已入库」状态的采购单可退回');
  END IF;

  /* 2. 安全检查:已生成采退单的单禁止回滚(货可能已寄回供应商) */
  IF EXISTS (
    SELECT 1 FROM supplier_return_records srr
    JOIN purchase_order_items poi ON poi.work_order_item_part_id = srr.work_order_item_part_id
    WHERE poi.order_id = p_purchase_order_id AND srr.status = 'completed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      '该采购单已生成采退单(货可能已寄回供应商)，请先在「已退货」页撤销采退单，再回滚入库');
  END IF;

  /* 3. 该单全部入库单;已入库单找不到入库单属脏数据,显式报错不静默放行 */
  SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_inbound_ids
  FROM inbound_orders WHERE purchase_order_id = p_purchase_order_id;
  IF array_length(v_inbound_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error',
      '数据异常:采购单已是已入库状态但找不到入库单，请联系管理员核对');
  END IF;

  /* 4. 库存预检:按配件聚合"净扣量=入库量-退库回补量",不足即报错(不钳制) */
  WITH 入库量 AS (
    SELECT ii.part_id, SUM(ii.quantity) AS qty
    FROM inbound_order_items ii
    WHERE ii.inbound_order_id = ANY(v_inbound_ids)
      AND ii.part_id IS NOT NULL AND ii.quantity > 0
    GROUP BY ii.part_id
  ),
  退库回补量 AS (
    /* 对称 complete_purchase_inbound 第 6 步:破损/错发/弃货按订购量减过库存,撤销回补 */
    SELECT poi.part_id, SUM(poi.quantity) AS qty
    FROM purchase_order_items poi
    WHERE poi.order_id = p_purchase_order_id
      AND poi.handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard')
      AND poi.part_id IS NOT NULL AND poi.quantity > 0
    GROUP BY poi.part_id
  ),
  净额 AS (
    SELECT COALESCE(i.part_id, r.part_id) AS part_id,
           COALESCE(i.qty, 0) - COALESCE(r.qty, 0) AS net
    FROM 入库量 i FULL OUTER JOIN 退库回补量 r ON r.part_id = i.part_id
  )
  SELECT p.part_number, p.quantity, x.net INTO v_不足编码, v_当前库存, v_需扣回
  FROM 净额 x JOIN parts p ON p.id = x.part_id
  WHERE p.quantity < x.net
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '配件 % 当前库存 % 不足扣回 %(可能已领料或盘点调整)，请先人工核对库存',
      COALESCE(v_不足编码, '(无编码)'), v_当前库存, v_需扣回;
  END IF;

  /* 5. 净额回滚总库存(净额可为负=净回补,一条 UPDATE 通吃) */
  WITH 入库量 AS (
    SELECT ii.part_id, SUM(ii.quantity) AS qty
    FROM inbound_order_items ii
    WHERE ii.inbound_order_id = ANY(v_inbound_ids)
      AND ii.part_id IS NOT NULL AND ii.quantity > 0
    GROUP BY ii.part_id
  ),
  退库回补量 AS (
    SELECT poi.part_id, SUM(poi.quantity) AS qty
    FROM purchase_order_items poi
    WHERE poi.order_id = p_purchase_order_id
      AND poi.handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard')
      AND poi.part_id IS NOT NULL AND poi.quantity > 0
    GROUP BY poi.part_id
  ),
  净额 AS (
    SELECT COALESCE(i.part_id, r.part_id) AS part_id,
           COALESCE(i.qty, 0) - COALESCE(r.qty, 0) AS net
    FROM 入库量 i FULL OUTER JOIN 退库回补量 r ON r.part_id = i.part_id
  )
  UPDATE parts p SET quantity = p.quantity - x.net
  FROM 净额 x
  WHERE p.id = x.part_id AND x.net <> 0;

  /* 6. 仓位按入库量扣回。
     注意:严禁按退库量回补仓位——入库第 6 步退库只减了 parts 总库存,
     没动 part_stock_locations,仓位只与入库量对称。 */
  WITH 仓位入库量 AS (
    SELECT ii.part_id, ii.warehouse_id, COALESCE(ii.location, '') AS location, SUM(ii.quantity) AS qty
    FROM inbound_order_items ii
    WHERE ii.inbound_order_id = ANY(v_inbound_ids)
      AND ii.part_id IS NOT NULL AND ii.quantity > 0 AND ii.warehouse_id IS NOT NULL
    GROUP BY ii.part_id, ii.warehouse_id, COALESCE(ii.location, '')
  )
  SELECT p.part_number, y.qty INTO v_仓位不足编码, v_需扣回
  FROM 仓位入库量 y
  JOIN parts p ON p.id = y.part_id
  LEFT JOIN part_stock_locations psl
    ON psl.part_id = y.part_id AND psl.warehouse_id = y.warehouse_id
   AND COALESCE(psl.location, '') = y.location
  WHERE psl.id IS NULL OR psl.quantity < y.qty
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '配件 % 仓位库存不足扣回 %(可能已领料)，请先人工核对仓位',
      COALESCE(v_仓位不足编码, '(无编码)'), v_需扣回;
  END IF;

  WITH 仓位入库量 AS (
    SELECT ii.part_id, ii.warehouse_id, COALESCE(ii.location, '') AS location, SUM(ii.quantity) AS qty
    FROM inbound_order_items ii
    WHERE ii.inbound_order_id = ANY(v_inbound_ids)
      AND ii.part_id IS NOT NULL AND ii.quantity > 0 AND ii.warehouse_id IS NOT NULL
    GROUP BY ii.part_id, ii.warehouse_id, COALESCE(ii.location, '')
  )
  UPDATE part_stock_locations psl SET quantity = psl.quantity - y.qty
  FROM 仓位入库量 y
  WHERE psl.part_id = y.part_id AND psl.warehouse_id = y.warehouse_id
    AND COALESCE(psl.location, '') = y.location;

  /* 7. 删除入库相关数据(批次被领料占用时外键报错,整单回滚——显式失败) */
  DELETE FROM inbound_order_items WHERE inbound_order_id = ANY(v_inbound_ids);
  DELETE FROM inbound_orders WHERE id = ANY(v_inbound_ids);
  DELETE FROM part_batches WHERE reference_id = p_purchase_order_id AND inbound_type = 'purchase';
  DELETE FROM inventory_logs WHERE reference_type = 'inbound_order' AND reference_id = ANY(v_inbound_ids);
  DELETE FROM supplier_transactions WHERE reference_type = 'inbound_order' AND reference_id = ANY(v_inbound_ids);

  /* 8. 删除该单生成的待退货记录(仅 pending;completed 已在第 2 步拦截) */
  DELETE FROM supplier_return_records
  WHERE status = 'pending'
    AND work_order_item_part_id IN (
      SELECT work_order_item_part_id FROM purchase_order_items
      WHERE order_id = p_purchase_order_id AND work_order_item_part_id IS NOT NULL
    );

  /* 9. 清空采购明细处理结果 */
  UPDATE purchase_order_items
  SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL
  WHERE order_id = p_purchase_order_id;

  /* 10. 采购单回已提交(重新走收货流程) */
  UPDATE purchase_orders SET status = 'submitted' WHERE id = p_purchase_order_id;

  /* 11. 回退到货标记(对称 complete 第 8.5 步);
     防护:该配件行还被其他 completed 采购单关联时保留。
     已知边界:入库前被手工标"已到货"的行也会被回退(无法区分标记来源),接受。 */
  UPDATE work_order_item_parts
  SET is_arrived = false
  WHERE is_arrived = true
    AND id IN (
      SELECT work_order_item_part_id FROM purchase_order_items
      WHERE order_id = p_purchase_order_id AND work_order_item_part_id IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM purchase_order_items poi2
      JOIN purchase_orders po2 ON po2.id = poi2.order_id
      WHERE poi2.work_order_item_part_id = work_order_item_parts.id
        AND po2.status = 'completed'
        AND po2.id <> p_purchase_order_id
    );

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   二、批量撤销退货记录(修正版,签名保持原样 (UUID[], UUID))
   相对 20260811 版的修正:
   ① 角色门禁直接写进函数体(原靠 20260814 锚点注入,重建函数体会丢)
   ② 已入库整单回滚分支:退库回补 + 净额聚合预检报错(原逐行 GREATEST 钳制会吞错账)
   ③ 已入库整单回滚分支:is_arrived 到货标记回退(带防护)
   未入库弃货分支逻辑不变。
   ============================================================ */
CREATE OR REPLACE FUNCTION revoke_supplier_returns(
  p_record_ids UUID[],
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_poi RECORD;
  v_order_id UUID;
  v_revoked_orders UUID[] := '{}';
  v_inbound_ids UUID[];
  v_part_id UUID;
  v_any_handled BOOLEAN;
  v_不足编码 TEXT;
  v_当前库存 INTEGER;
  v_需扣回 BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;
  IF p_record_ids IS NULL OR array_length(p_record_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请先选择要撤销的记录');
  END IF;

  /* 按采购单逐单处理(同一采购单只处理一次,与原逻辑一致) */
  FOR v_rec IN
    SELECT id, work_order_item_part_id, quantity, return_reason
    FROM supplier_return_records
    WHERE id = ANY(p_record_ids)
  LOOP
    /* 找关联采购明细(取第一条,与原客户端一致;
       is_purchased 机制保证一配件行只进一张活单,实际安全) */
    SELECT id, order_id, handle_action INTO v_poi
    FROM purchase_order_items
    WHERE work_order_item_part_id = v_rec.work_order_item_part_id
    LIMIT 1;

    v_order_id := v_poi.order_id;
    IF v_order_id IS NULL OR v_order_id = ANY(v_revoked_orders) THEN
      CONTINUE;
    END IF;

    /* 该采购单的全部入库单 */
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_inbound_ids
    FROM inbound_orders WHERE purchase_order_id = v_order_id;

    IF array_length(v_inbound_ids, 1) > 0 THEN
      /* ── 已入库:整单回滚入库(净额聚合+预检报错+退库回补) ── */

      /* 库存预检:净扣量=入库量-退库回补量,不足即报错整单回滚 */
      WITH 入库量 AS (
        SELECT ii.part_id, SUM(ii.quantity) AS qty
        FROM inbound_order_items ii
        WHERE ii.inbound_order_id = ANY(v_inbound_ids)
          AND ii.part_id IS NOT NULL AND ii.quantity > 0
        GROUP BY ii.part_id
      ),
      退库回补量 AS (
        SELECT poi.part_id, SUM(poi.quantity) AS qty
        FROM purchase_order_items poi
        WHERE poi.order_id = v_order_id
          AND poi.handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard')
          AND poi.part_id IS NOT NULL AND poi.quantity > 0
        GROUP BY poi.part_id
      ),
      净额 AS (
        SELECT COALESCE(i.part_id, r.part_id) AS part_id,
               COALESCE(i.qty, 0) - COALESCE(r.qty, 0) AS net
        FROM 入库量 i FULL OUTER JOIN 退库回补量 r ON r.part_id = i.part_id
      )
      SELECT p.part_number, p.quantity, x.net INTO v_不足编码, v_当前库存, v_需扣回
      FROM 净额 x JOIN parts p ON p.id = x.part_id
      WHERE p.quantity < x.net
      LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION '配件 % 当前库存 % 不足扣回 %(可能已领料或盘点调整)，请先人工核对库存',
          COALESCE(v_不足编码, '(无编码)'), v_当前库存, v_需扣回;
      END IF;

      /* 净额回滚总库存 */
      WITH 入库量 AS (
        SELECT ii.part_id, SUM(ii.quantity) AS qty
        FROM inbound_order_items ii
        WHERE ii.inbound_order_id = ANY(v_inbound_ids)
          AND ii.part_id IS NOT NULL AND ii.quantity > 0
        GROUP BY ii.part_id
      ),
      退库回补量 AS (
        SELECT poi.part_id, SUM(poi.quantity) AS qty
        FROM purchase_order_items poi
        WHERE poi.order_id = v_order_id
          AND poi.handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard')
          AND poi.part_id IS NOT NULL AND poi.quantity > 0
        GROUP BY poi.part_id
      ),
      净额 AS (
        SELECT COALESCE(i.part_id, r.part_id) AS part_id,
               COALESCE(i.qty, 0) - COALESCE(r.qty, 0) AS net
        FROM 入库量 i FULL OUTER JOIN 退库回补量 r ON r.part_id = i.part_id
      )
      UPDATE parts p SET quantity = p.quantity - x.net
      FROM 净额 x
      WHERE p.id = x.part_id AND x.net <> 0;

      /* 仓位按入库量扣回(严禁退库回补仓位,理由同 revoke_completed_inbound 第 6 步) */
      WITH 仓位入库量 AS (
        SELECT ii.part_id, ii.warehouse_id, COALESCE(ii.location, '') AS location, SUM(ii.quantity) AS qty
        FROM inbound_order_items ii
        WHERE ii.inbound_order_id = ANY(v_inbound_ids)
          AND ii.part_id IS NOT NULL AND ii.quantity > 0 AND ii.warehouse_id IS NOT NULL
        GROUP BY ii.part_id, ii.warehouse_id, COALESCE(ii.location, '')
      )
      UPDATE part_stock_locations psl SET quantity = psl.quantity - y.qty
      FROM 仓位入库量 y
      WHERE psl.part_id = y.part_id AND psl.warehouse_id = y.warehouse_id
        AND COALESCE(psl.location, '') = y.location;

      /* 删除入库相关数据(若批次已被领料占用,外键报错整单回滚) */
      DELETE FROM inbound_order_items WHERE inbound_order_id = ANY(v_inbound_ids);
      DELETE FROM inbound_orders WHERE id = ANY(v_inbound_ids);
      DELETE FROM part_batches WHERE reference_id = v_order_id AND inbound_type = 'purchase';
      DELETE FROM inventory_logs WHERE reference_type = 'inbound_order' AND reference_id = ANY(v_inbound_ids);
      DELETE FROM supplier_transactions WHERE reference_type = 'inbound_order' AND reference_id = ANY(v_inbound_ids);

      /* 清空采购明细处理结果,采购单回已提交 */
      UPDATE purchase_order_items
      SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL
      WHERE order_id = v_order_id;
      UPDATE purchase_orders SET status = 'submitted' WHERE id = v_order_id;

      /* 回退到货标记(带防护:该行还被其他 completed 单关联时保留;
         多单批量撤销时随循环推进状态变化,最终均能正确回退) */
      UPDATE work_order_item_parts
      SET is_arrived = false
      WHERE is_arrived = true
        AND id IN (
          SELECT work_order_item_part_id FROM purchase_order_items
          WHERE order_id = v_order_id AND work_order_item_part_id IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi2
          JOIN purchase_orders po2 ON po2.id = poi2.order_id
          WHERE poi2.work_order_item_part_id = work_order_item_parts.id
            AND po2.status = 'completed'
            AND po2.id <> v_order_id
        );
    ELSE
      /* ── 未入库:弃货类加回库存(逻辑与原版一致) ── */
      IF v_poi.handle_action IN ('broken_discard', 'wrong_discard') THEN
        SELECT part_id INTO v_part_id FROM work_order_item_parts
        WHERE id = v_rec.work_order_item_part_id;
        IF v_part_id IS NOT NULL AND v_rec.quantity > 0 THEN
          UPDATE parts SET quantity = quantity + v_rec.quantity WHERE id = v_part_id;
        END IF;

        UPDATE purchase_order_items
        SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL
        WHERE id = v_poi.id;

        SELECT bool_or(handle_action IS NOT NULL) INTO v_any_handled
        FROM purchase_order_items WHERE order_id = v_order_id;
        UPDATE purchase_orders
        SET status = CASE WHEN v_any_handled THEN 'partial_received' ELSE 'submitted' END
        WHERE id = v_order_id;
      END IF;
    END IF;

    v_revoked_orders := array_append(v_revoked_orders, v_order_id);
  END LOOP;

  /* 删除退货记录本身 */
  DELETE FROM supplier_return_records WHERE id = ANY(p_record_ids);

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   三、权限收尾(对齐 20260813 迁移双保险)
   新建函数默认 PUBLIC 可执行,必须回收;
   CREATE OR REPLACE 保留原权限,revoke_supplier_returns 的回收在此重申幂等。
   ============================================================ */
REVOKE EXECUTE ON FUNCTION public.revoke_completed_inbound(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_supplier_returns(uuid[], uuid) FROM anon, PUBLIC;

/* ============================================================
   验证方法(执行完本脚本后跑):
   SELECT proname FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname IN ('revoke_completed_inbound','revoke_supplier_returns')
     AND pg_get_functiondef(oid) LIKE '%权限门禁%';
   应返回 2 行。
   ============================================================ */
