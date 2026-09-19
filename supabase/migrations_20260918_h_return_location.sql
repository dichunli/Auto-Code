/* ============================================================
 * 退货记录仓位信息 + 仓位库存数量同步（2026-09-18 用户拍板）
 * 背景：已入库退货时没有要求输入仓位，待退货也不显示仓位；
 *   用户拍板：仓位要记录数量——退货时同步扣 part_stock_locations，
 *   撤销退货时同步加回（无记录则补建行）。
 * 改动：
 *   1. supplier_return_records 加 warehouse_id（外键 warehouses）+ location
 *   2. create_inbound_return：明细 JSON 支持 warehouse_id / location；
 *      传了仓位就同步扣 part_stock_locations（无记录/不足报错整单回滚）
 *   3. revoke_supplier_returns：inbound_return 分支撤销时按记录仓位加回
 * 幂等：ADD COLUMN IF NOT EXISTS + DO 块判重 + CREATE OR REPLACE，可重跑。
 * ============================================================ */

ALTER TABLE public.supplier_return_records ADD COLUMN IF NOT EXISTS warehouse_id UUID;
ALTER TABLE public.supplier_return_records ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN public.supplier_return_records.warehouse_id IS '退自仓库（退货时选）';
COMMENT ON COLUMN public.supplier_return_records.location IS '退自仓位（退货时选）';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_return_records_warehouse_id_fkey'
  ) THEN
    ALTER TABLE public.supplier_return_records
      ADD CONSTRAINT supplier_return_records_warehouse_id_fkey
      FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);
  END IF;
END $$;

/* ─── create_inbound_return：退货记录支持仓位（参数列表未变） ─── */
CREATE OR REPLACE FUNCTION create_inbound_return(
  p_items JSONB,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_poi RECORD;
  v_order RECORD;
  v_batch RECORD;
  v_qty INTEGER;
  v_已退 INTEGER;
  v_可退 INTEGER;
  v_before_qty INTEGER;
  v_reason TEXT;
  v_supplier_name TEXT;
  v_record_id UUID;
  v_ids UUID[] := '{}';
  v_loc TEXT;
  v_loc_qty INTEGER;
BEGIN
  /* 0. 登录校验 + 角色门禁(对齐采购其他事务函数) */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购退货');
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '退货明细不能为空');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION '退货数量必须大于0';
    END IF;

    /* 原因白名单（2026-09-18 放宽为 6 种）：多发/破损/发错/质量原因/客户悔单/其它 */
    v_reason := NULLIF(TRIM(COALESCE(v_item->>'return_reason', '')), '');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION '请选择退货原因';
    END IF;
    IF v_reason NOT IN ('excess', 'damaged', 'wrong_ship', 'quality', 'cancel', 'other') THEN
      RAISE EXCEPTION '非法的退货原因: %', v_reason;
    END IF;

    /* 1. 锁采购明细行(防并发重复退货) */
    SELECT * INTO v_poi FROM purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '采购明细不存在';
    END IF;
    IF v_poi.part_id IS NULL THEN
      RAISE EXCEPTION '「%」未关联配件档案，不能退货', COALESCE(v_poi.name, '(无名)');
    END IF;

    /* 2. 采购单必须已入库 */
    SELECT id, status, supplier_id INTO v_order
    FROM purchase_orders WHERE id = v_poi.order_id;
    IF v_order.status <> 'completed' THEN
      RAISE EXCEPTION '仅「已入库」的采购单可以退货(单号 % 当前状态 %)', v_poi.id, v_order.status;
    END IF;

    /* 3. 可退数 = 实际入库数 − 已退数（撤销的记录已物理删除，不会虚占）
       同一明细在一次调用里出现多行时，先插入的记录同事务可见，天然防超退 */
    SELECT COALESCE(SUM(quantity), 0) INTO v_已退
    FROM supplier_return_records
    WHERE purchase_order_item_id = v_poi.id;
    v_可退 := COALESCE(v_poi.received_qty, v_poi.quantity) - v_已退;
    IF v_qty > v_可退 THEN
      RAISE EXCEPTION '「%」最多还能退 % 件（已入库 % 件，已退 % 件）',
        COALESCE(v_poi.name, '(无名)'), v_可退,
        COALESCE(v_poi.received_qty, v_poi.quantity), v_已退;
    END IF;

    /* 4. 锁批次扣剩余 */
    SELECT id, part_id, remaining, batch_no INTO v_batch
    FROM part_batches WHERE id = (v_item->>'batch_id')::UUID FOR UPDATE;
    IF v_batch.id IS NULL OR v_batch.part_id <> v_poi.part_id THEN
      RAISE EXCEPTION '批次不存在或不属于「%」', COALESCE(v_poi.name, '(无名)');
    END IF;
    IF v_batch.remaining < v_qty THEN
      RAISE EXCEPTION '「%」批次 % 剩余仅 % 件，不足退货',
        COALESCE(v_poi.name, '(无名)'), COALESCE(v_batch.batch_no, '(未命名)'), v_batch.remaining;
    END IF;

    /* 5. 锁配件扣总库存(不足报错不钳制，账实不符宁可拦下人工核对) */
    SELECT quantity INTO v_before_qty FROM parts WHERE id = v_poi.part_id FOR UPDATE;
    IF v_before_qty IS NULL THEN
      RAISE EXCEPTION '配件档案不存在';
    END IF;
    IF v_before_qty < v_qty THEN
      RAISE EXCEPTION '「%」当前库存 % 件不足退 % 件(可能已领料)，请先人工核对库存',
        COALESCE(v_poi.name, '(无名)'), v_before_qty, v_qty;
    END IF;

    UPDATE part_batches SET remaining = remaining - v_qty WHERE id = v_batch.id;
    UPDATE parts SET quantity = quantity - v_qty WHERE id = v_poi.part_id;

    /* 5.5 仓位库存同步扣减（2026-09-18 用户拍板：仓位要记录数量）：
       传了仓位就扣 part_stock_locations，无记录/不足报错整单回滚；
       没传仓位（如退库连续退货老路径）则跳过 */
    IF NULLIF(v_item->>'warehouse_id', '') IS NOT NULL THEN
      v_loc := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''), '');
      SELECT quantity INTO v_loc_qty FROM public.part_stock_locations
      WHERE part_id = v_poi.part_id
        AND warehouse_id = (v_item->>'warehouse_id')::UUID
        AND COALESCE(location, '') = v_loc
      FOR UPDATE;
      IF v_loc_qty IS NULL THEN
        RAISE EXCEPTION '「%」在所选仓位没有库存记录，请核对仓位', COALESCE(v_poi.name, '(无名)');
      END IF;
      IF v_loc_qty < v_qty THEN
        RAISE EXCEPTION '「%」所选仓位仅剩 % 件，不足退 % 件，请核对仓位',
          COALESCE(v_poi.name, '(无名)'), v_loc_qty, v_qty;
      END IF;
      UPDATE public.part_stock_locations SET quantity = quantity - v_qty
      WHERE part_id = v_poi.part_id
        AND warehouse_id = (v_item->>'warehouse_id')::UUID
        AND COALESCE(location, '') = v_loc;
    END IF;

    /* 6. 插待退货记录(快照从采购明细取，供应商从采购单取，准确不靠猜)
       2026-09-18：支持货物照片 photos / 外包装照片 package_photos（退货时可选拍）
                  + 退自仓位 warehouse_id / location（退货时选，只记账不扣仓位库存） */
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_order.supplier_id;

    INSERT INTO supplier_return_records (
      work_order_item_part_id, purchase_order_item_id, source,
      return_reason, quantity,
      supplier_id, supplier_name,
      part_id, part_number, part_name, brand, specification, unit, unit_cost,
      batch_id, notes, status, created_by,
      photos, package_photos, warehouse_id, location
    ) VALUES (
      v_poi.work_order_item_part_id, v_poi.id, 'inbound_return',
      v_reason, v_qty,
      v_order.supplier_id, COALESCE(v_supplier_name, ''),
      v_poi.part_id, v_poi.part_number, v_poi.name, v_poi.brand,
      v_poi.specification, v_poi.unit, v_poi.unit_cost,
      v_batch.id,
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), ''),
      'pending', p_operator_id,
      CASE WHEN jsonb_typeof(v_item->'photos') = 'array'
           THEN (SELECT ARRAY(SELECT jsonb_array_elements_text(v_item->'photos')))
           ELSE NULL END,
      CASE WHEN jsonb_typeof(v_item->'package_photos') = 'array'
           THEN (SELECT ARRAY(SELECT jsonb_array_elements_text(v_item->'package_photos')))
           ELSE NULL END,
      NULLIF(v_item->>'warehouse_id', '')::UUID,
      NULLIF(TRIM(COALESCE(v_item->>'location', '')), '')
    )
    RETURNING id INTO v_record_id;
    v_ids := array_append(v_ids, v_record_id);

    /* 7. 库存流水 */
    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, operator_id, notes)
    VALUES (
      v_poi.part_id, 'return_out', -v_qty, v_before_qty, v_before_qty - v_qty,
      'supplier_return_record', v_record_id, p_operator_id,
      '已入库退货: ' || COALESCE(v_poi.name, '') ||
        CASE WHEN v_batch.batch_no IS NOT NULL THEN ' 批次:' || v_batch.batch_no ELSE '' END
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'record_ids', v_ids);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_inbound_return(jsonb, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_inbound_return(jsonb, uuid) TO authenticated;

/* ─── revoke_supplier_returns：inbound_return 分支撤销时按记录仓位加回 ───
   函数体与 migrations_20260916_b_inbound_return.sql 一致，仅两处改动：
   (a) 记录查询带 warehouse_id/location；(b) inbound_return 分支同步加回仓位库存 */
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
  v_before_qty INTEGER;
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
    SELECT id, work_order_item_part_id, purchase_order_item_id, source,
           batch_id, part_id, part_name, quantity, return_reason, status,
           warehouse_id, location
    FROM supplier_return_records
    WHERE id = ANY(p_record_ids)
  LOOP
    /* ── 已入库退货(2026-09-16 新增分支):只回加库存+记流水,
          记录由末尾统一删除,不碰入库单/采购单/收货结果 ── */
    IF v_rec.source = 'inbound_return' THEN
      /* 双保险:已生成采退单的记录不该走到这(正常 UI 在已退货页撤采退单),
         真混进来就报错整体回滚,防止"采退单还在、库存却加回了"的错账 */
      IF v_rec.status <> 'pending' THEN
        RAISE EXCEPTION '退货记录已生成采退单，请先在「已退货」页撤销采退单';
      END IF;
      IF v_rec.part_id IS NOT NULL AND v_rec.quantity > 0 THEN
        /* 批次加回(撤销时批次可能已被后续操作变动,加锁读最新值) */
        IF v_rec.batch_id IS NOT NULL THEN
          UPDATE part_batches SET remaining = remaining + v_rec.quantity
          WHERE id = v_rec.batch_id;
          /* 批次若已被删(如撤销入库连锅端),不回加批次但总要回加总库存 */
        END IF;
        SELECT quantity INTO v_before_qty FROM parts WHERE id = v_rec.part_id FOR UPDATE;
        UPDATE parts SET quantity = quantity + v_rec.quantity WHERE id = v_rec.part_id;

        /* 仓位库存同步加回（2026-09-18 用户拍板：仓位要记录数量）；
           仓位行不存在则补建（如期间被清空） */
        IF v_rec.warehouse_id IS NOT NULL THEN
          UPDATE part_stock_locations SET quantity = quantity + v_rec.quantity
          WHERE part_id = v_rec.part_id AND warehouse_id = v_rec.warehouse_id
            AND COALESCE(location, '') = COALESCE(v_rec.location, '');
          IF NOT FOUND THEN
            INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity)
            VALUES (v_rec.part_id, v_rec.warehouse_id, v_rec.location, v_rec.quantity);
          END IF;
        END IF;

        INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, operator_id, notes)
        VALUES (
          v_rec.part_id, 'return_in', v_rec.quantity, v_before_qty, v_before_qty + v_rec.quantity,
          'supplier_return_record', v_rec.id, p_operator_id,
          '撤销已入库退货: ' || COALESCE(v_rec.part_name, '')
        );
      END IF;
      CONTINUE;
    END IF;

    /* ── 以下为收货异常(receipt_exception)老记录的原逻辑,一字未改 ── */
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

  /* 删除退货记录本身(两种来源统一在此物理删除) */
  DELETE FROM supplier_return_records WHERE id = ANY(p_record_ids);

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.revoke_supplier_returns(uuid[], uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_supplier_returns(uuid[], uuid) TO authenticated;

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260918_h_return_location.sql', '退货记录加退自仓库/仓位字段，退货RPC支持写入仓位')
ON CONFLICT (file_name) DO NOTHING;
