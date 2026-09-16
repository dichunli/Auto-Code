/* ═══════════════════════════════════════════════════════════
 * 2026-09-16 _b 已入库退货接入正规退货流程（用户拍板）
 *
 * 背景（三个线上问题）：
 *   1. 已入库页的「去退货/批量退货」此前调 create_purchase_return
 *      （库存退货体系）：只扣库存、不写 supplier_return_records、
 *      不生成采退单、不冲减应付款 —— 货退了钱照付，待退货页也看不到。
 *   2. 已入库行没有退货标识，同一件货可重复退。
 *   3. 供应商款项页余额公式本就有 credit 减项，只因没记账而看不到退货款。
 *
 * 本迁移内容：
 *   一、supplier_return_records 扩列：备货采购的货没有工单配件行，
 *       记录必须能自立（快照列 + 采购明细关联 + 来源区分）。
 *   二、新建 create_inbound_return：已入库退货一个事务完成
 *       「校验可退 → 扣批次/总库存 → 记流水 → 建待退货记录」。
 *   三、revoke_supplier_returns 加 inbound_return 分支：
 *       撤销已入库退货 = 加回库存 + 删记录（不碰入库单）；
 *       收货异常的老记录保持整单回滚逻辑不变。
 *   四、revoke_completed_inbound 安全检查扩展：新关联的退货记录
 *       也要拦截撤销入库。
 *   五、complete_return_record 记账口径：快照列/supplier_id 优先。
 * ═══════════════════════════════════════════════════════════ */

/* ============================================================
   一、supplier_return_records 扩列
   ============================================================ */

/* 备货采购的货没有工单配件行，放宽为可空（老数据不受影响） */
ALTER TABLE supplier_return_records
  ALTER COLUMN work_order_item_part_id DROP NOT NULL;

ALTER TABLE supplier_return_records
  /* 来源：receipt_exception=收货异常(现有全部数据) / inbound_return=已入库退货 */
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'receipt_exception',
  /* 关联采购明细行：防重复退货 + 已入库行「已退数量」统计 */
  ADD COLUMN IF NOT EXISTS purchase_order_item_id UUID REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  /* 供应商 id：记账直接用它，不再靠名称文本猜 */
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  /* 配件快照列：无工单配件行时展示/建采退单用 */
  ADD COLUMN IF NOT EXISTS part_id UUID REFERENCES parts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS part_number TEXT,
  ADD COLUMN IF NOT EXISTS part_name TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS specification TEXT,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2),
  /* 退货扣的批次（撤销退货时加回它） */
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES part_batches(id) ON DELETE SET NULL,
  /* 退货备注（弹窗自由文本） */
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE supplier_return_records DROP CONSTRAINT IF EXISTS supplier_return_records_source_check;
ALTER TABLE supplier_return_records ADD CONSTRAINT supplier_return_records_source_check
  CHECK (source IN ('receipt_exception', 'inbound_return'));

/* 退货原因加「其他」（已入库退货用 quality/cancel/other） */
ALTER TABLE supplier_return_records DROP CONSTRAINT IF EXISTS supplier_return_records_return_reason_check;
ALTER TABLE supplier_return_records ADD CONSTRAINT supplier_return_records_return_reason_check
  CHECK (return_reason IN ('wrong_ship', 'excess', 'damaged', 'cancel', 'quality', 'other'));

CREATE INDEX IF NOT EXISTS idx_supplier_return_records_poi ON supplier_return_records(purchase_order_item_id);
CREATE INDEX IF NOT EXISTS idx_supplier_return_records_supplier ON supplier_return_records(supplier_id);

/* ============================================================
   二、create_inbound_return —— 已入库退货（原子事务）
   参数: p_items JSONB 数组，元素：
     { purchase_order_item_id, batch_id, quantity, return_reason, notes }
   语义: 逐行校验「可退数 = 实际入库数 − 已退数」，
         锁批次扣剩余 + 锁配件扣总库存(不足报错不钳制) + 记流水
         + 插待退货记录(source=inbound_return, 带快照)。
         任一失败整体回滚。
   ============================================================ */
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

    /* 原因白名单：已入库退货只允许 质量问题/客户悔单/其他 */
    v_reason := COALESCE(NULLIF(TRIM(v_item->>'return_reason'), ''), 'other');
    IF v_reason NOT IN ('quality', 'cancel', 'other') THEN
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

    /* 6. 插待退货记录(快照从采购明细取，供应商从采购单取，准确不靠猜) */
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_order.supplier_id;

    INSERT INTO supplier_return_records (
      work_order_item_part_id, purchase_order_item_id, source,
      return_reason, quantity,
      supplier_id, supplier_name,
      part_id, part_number, part_name, brand, specification, unit, unit_cost,
      batch_id, notes, status, created_by
    ) VALUES (
      v_poi.work_order_item_part_id, v_poi.id, 'inbound_return',
      v_reason, v_qty,
      v_order.supplier_id, COALESCE(v_supplier_name, ''),
      v_poi.part_id, v_poi.part_number, v_poi.name, v_poi.brand,
      v_poi.specification, v_poi.unit, v_poi.unit_cost,
      v_batch.id,
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), ''),
      'pending', p_operator_id
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

/* ============================================================
   三、revoke_supplier_returns —— 加 inbound_return 分支
   函数体 = 0816 版原逻辑 + 循环开头的新分支。
   注意:本函数签名未变,用 CREATE OR REPLACE 即可,无需 DROP。
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
           batch_id, part_id, quantity, return_reason, status
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

/* ============================================================
   四、revoke_completed_inbound —— 安全检查扩展
   函数体 = 0913_a 版原逻辑 + 两处扩展:
   (a) 检查一的关联条件补 purchase_order_item_id(新来源记录);
   (b) 新增检查:存在「已入库退货」记录(pending)时拦截撤销入库。
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
  v_批次们 UUID[];
  v_inbound_ids UUID[];
  v_涉及单们 UUID[];
  v_批次入库单数 INT;
  v_不足编码 TEXT;
  v_当前库存 INTEGER;
  v_需扣回 BIGINT;
  v_仓位不足编码 TEXT;
  v_其它入库单单号 TEXT;
BEGIN
  /* 0. 登录校验 + 角色门禁 */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 1. 锁定采购单并校验状态 */
  SELECT * INTO v_order FROM purchase_orders WHERE id = p_purchase_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', '仅「已入库」状态的采购单可撤销');
  END IF;

  /* 2. 找该单明细挂的批次（空=蓝卡流程，非空=黄卡流程要整批回滚） */
  SELECT COALESCE(ARRAY_AGG(DISTINCT receiving_batch_id), '{}') INTO v_批次们
  FROM purchase_order_items
  WHERE order_id = p_purchase_order_id AND receiving_batch_id IS NOT NULL;

  IF array_length(v_批次们, 1) IS NULL THEN
    /* ─── 蓝卡流程：单单回滚 ─── */
    v_涉及单们 := ARRAY[p_purchase_order_id];
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_inbound_ids
    FROM inbound_orders
    WHERE purchase_order_id = p_purchase_order_id AND status = 'completed';
  ELSE
    /* ─── 黄卡流程：整批回滚（批次入库单是批次级一张单，不能按单拆） ─── */
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_inbound_ids
    FROM inbound_orders
    WHERE receiving_batch_id = ANY(v_批次们) AND status = 'completed';
    /* 批次下所有采购单都纳入回滚范围 */
    SELECT COALESCE(ARRAY_AGG(DISTINCT order_id), '{}') INTO v_涉及单们
    FROM purchase_order_items
    WHERE receiving_batch_id = ANY(v_批次们);
  END IF;

  IF array_length(v_inbound_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error',
      '数据异常:采购单已是已入库状态但找不到入库单，请联系管理员核对');
  END IF;

  /* 3. 安全检查一：涉及单里已有 completed 采退单的禁止回滚（货可能已寄回供应商）
       2026-09-16 扩展:关联条件补 purchase_order_item_id(已入库退货来源的记录) */
  IF EXISTS (
    SELECT 1 FROM supplier_return_records srr
    JOIN purchase_order_items poi
      ON poi.work_order_item_part_id = srr.work_order_item_part_id
      OR poi.id = srr.purchase_order_item_id
    WHERE poi.order_id = ANY(v_涉及单们) AND srr.status = 'completed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      '涉及采购单已生成采退单(货可能已寄回供应商)，请先在「已退货」页撤销采退单，再撤销入库');
  END IF;

  /* 3.5 安全检查一·补(2026-09-16)：有待处理的「已入库退货」记录时拦截——
       退货已扣库存，撤销入库再全额扣回必出错；且记录会挂在一张回滚掉的单上 */
  IF EXISTS (
    SELECT 1 FROM supplier_return_records srr
    JOIN purchase_order_items poi ON poi.id = srr.purchase_order_item_id
    WHERE poi.order_id = ANY(v_涉及单们)
      AND srr.source = 'inbound_return' AND srr.status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      '该单存在「已入库退货」记录，请先在「待退货」页撤销退货(库存会自动加回)，再撤销入库');
  END IF;

  /* 4. 安全检查二：涉及单还有【不在本次范围】的已完成入库单时拦截
       （该单一部分货随别的批次/蓝卡单入的，回滚会把它的状态搞乱） */
  SELECT inbound_no INTO v_其它入库单单号
  FROM inbound_orders
  WHERE status = 'completed'
    AND purchase_order_id = ANY(v_涉及单们)
    AND NOT (id = ANY(v_inbound_ids))
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      '涉及采购单还有另一张已完成入库单 ' || v_其它入库单单号 || '（货是分次入的），暂不支持撤销，请联系管理员人工处理');
  END IF;

  /* 5. 库存预检：净扣量=入库量-退库回补量，不足即报错（不钳制） */
  WITH 入库量 AS (
    SELECT ii.part_id, SUM(ii.quantity) AS qty
    FROM inbound_order_items ii
    WHERE ii.inbound_order_id = ANY(v_inbound_ids)
      AND ii.part_id IS NOT NULL AND ii.quantity > 0
    GROUP BY ii.part_id
  ),
  退库回补量 AS (
    /* 对称入库逻辑:破损/错发/弃货按订购量减过库存,撤销回补 */
    SELECT poi.part_id, SUM(poi.quantity) AS qty
    FROM purchase_order_items poi
    WHERE poi.order_id = ANY(v_涉及单们)
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

  /* 6. 净额回滚总库存 */
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
    WHERE poi.order_id = ANY(v_涉及单们)
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

  /* 7. 仓位按入库量扣回（仓位只与入库量对称，不按退库量回补） */
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

  /* 8. 删除入库相关数据 */
  DELETE FROM inbound_order_items WHERE inbound_order_id = ANY(v_inbound_ids);
  DELETE FROM inbound_orders WHERE id = ANY(v_inbound_ids);
  /* 未确认的 draft 确认单一并删除（没加过库存，但留着会误导再次确认） */
  DELETE FROM inbound_order_items
  WHERE inbound_order_id IN (
    SELECT id FROM inbound_orders
    WHERE status = 'draft'
      AND (purchase_order_id = ANY(v_涉及单们)
           OR (array_length(v_批次们, 1) IS NOT NULL AND receiving_batch_id = ANY(v_批次们)))
  );
  DELETE FROM inbound_orders
  WHERE status = 'draft'
    AND (purchase_order_id = ANY(v_涉及单们)
         OR (array_length(v_批次们, 1) IS NOT NULL AND receiving_batch_id = ANY(v_批次们)));
  /* 库存批次：蓝卡按采购单、黄卡按批次（与各自入库时的 reference_id 对称） */
  DELETE FROM part_batches
  WHERE inbound_type = 'purchase'
    AND (reference_id = ANY(v_涉及单们)
         OR (array_length(v_批次们, 1) IS NOT NULL AND reference_id = ANY(v_批次们)));
  DELETE FROM inventory_logs WHERE reference_type = 'inbound_order' AND reference_id = ANY(v_inbound_ids);
  DELETE FROM supplier_transactions WHERE reference_type = 'inbound_order' AND reference_id = ANY(v_inbound_ids);

  /* 9. 采购单退回「待入库」（收货结果 handle_action/received_qty 全部保留） */
  UPDATE purchase_orders SET status = 'pending_storage'
  WHERE id = ANY(v_涉及单们) AND status = 'completed';

  /* 10. 批次退回「待入库」（黄卡重新显示）；蓝卡流程 v_批次们 为空，此句无操作 */
  IF array_length(v_批次们, 1) IS NOT NULL THEN
    UPDATE receiving_batches SET status = 'pending_storage', inbounded_at = NULL
    WHERE id = ANY(v_批次们);
  END IF;

  /* 说明（2026-09-13 新语义，刻意不做的事）：
     - 不清 handle_action/received_qty/discount_amount/evidence_photos（收货结果保留）
     - 不回退 work_order_item_parts.is_arrived（货确实到了，待入库需要它）
     - 不删 supplier_return_records 待退货记录（收货环节产生，退货流程继续走）
     - 不删收货时生成的补货分支（收货环节产生） */

  RETURN jsonb_build_object('success', true, 'orders', array_length(v_涉及单们, 1));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION revoke_completed_inbound(UUID, UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_completed_inbound(UUID, UUID) TO authenticated;

/* ============================================================
   五、complete_return_record —— 记账口径：快照列/supplier_id 优先
   函数体 = 0819 版原逻辑 + 取值优先级调整。
   ============================================================ */
CREATE OR REPLACE FUNCTION complete_return_record(
  p_record_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_unit_cost NUMERIC(12,2);
  v_supplier_id UUID;
  v_amount DECIMAL(12,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 锁记录并校验状态（防重复点击重复记账） */
  SELECT id, status, work_order_item_part_id, quantity, supplier_name,
         supplier_id, unit_cost
  INTO v_rec
  FROM supplier_return_records WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '退货记录不存在');
  END IF;
  IF v_rec.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', '该记录已是完成状态，请勿重复操作');
  END IF;

  /* 标记完成 */
  UPDATE supplier_return_records SET status = 'completed' WHERE id = p_record_id;

  /* 计算金额：数量 × 采购价。
     2026-09-16：采购价优先取记录快照列(已入库退货写入时存了准确值)，
     兜底工单配件行采购价(收货异常的老记录) */
  v_unit_cost := v_rec.unit_cost;
  IF v_unit_cost IS NULL AND v_rec.work_order_item_part_id IS NOT NULL THEN
    SELECT unit_cost INTO v_unit_cost
    FROM work_order_item_parts WHERE id = v_rec.work_order_item_part_id;
  END IF;

  /* 供应商：优先记录上的 supplier_id 列(准确)，兜底按名称文本匹配 */
  v_supplier_id := v_rec.supplier_id;
  IF v_supplier_id IS NULL AND v_rec.supplier_name IS NOT NULL AND TRIM(v_rec.supplier_name) <> '' THEN
    SELECT id INTO v_supplier_id FROM suppliers
    WHERE name = v_rec.supplier_name
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  v_amount := ROUND(COALESCE(v_rec.quantity, 0) * COALESCE(v_unit_cost, 0), 2);

  IF v_supplier_id IS NOT NULL AND v_amount > 0 THEN
    INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type, created_by)
    VALUES (v_supplier_id, 'credit', v_amount, '采购退货', p_record_id, 'supplier_return_record', p_operator_id);
    RETURN jsonb_build_object('success', true, 'accounted', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'accounted', false);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.complete_return_record(uuid, uuid) FROM anon, PUBLIC;

/* ============================================================
   台账登记（三防规范：ON CONFLICT DO NOTHING 重跑无害）
   ============================================================ */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260916_b_inbound_return.sql') ON CONFLICT DO NOTHING;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. SELECT proname FROM pg_proc
      WHERE pronamespace='public'::regnamespace
        AND proname IN ('create_inbound_return','revoke_supplier_returns',
                        'revoke_completed_inbound','complete_return_record')
        AND pg_get_functiondef(oid) LIKE '%inbound_return%';
      应至少返回 4 行(新函数 + 三个改造函数都含新分支/新口径)。
   2. SELECT column_name FROM information_schema.columns
      WHERE table_name='supplier_return_records'
        AND column_name IN ('source','purchase_order_item_id','supplier_id',
                            'part_name','batch_id','notes');
      应返回 6 行。
   ============================================================
*/
