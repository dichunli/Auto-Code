/* 采购建单 —— 原子事务函数 + 单号序列触发器 */
/* 创建日期: 2026-08-11 */
/* 背景:
     原建采购单在浏览器分 3 步(建单头 → 插明细 → 回写工单配件行),中途失败留"只有头没有明细"的孤儿单;
     安全库存批量建单按供应商循环,某一供应商失败则前面已生成、后面不再生成;
     单号有两种客户端格式(4 位随机数 / UUID8 位),且并发可能撞号。
   本迁移:
     一、generate_purchase_order_no 触发器 —— 单号统一为 CG-YYYYMMDD-NNN 服务端序列
     二、create_purchase_orders —— 一次调用可建多张采购单(按供应商分组),
         每张单的 建头+明细+回写工单配件行 都在同一个事务里,任一失败整体回滚
*/

/* ============================================================
   一、采购单号序列触发器
   注意:历史数据有两种旧格式(CG-日期-4位随机数 / CG-日期-UUID8位含字母),
   取序号时只统计纯数字后缀,避免类型转换报错
   ============================================================ */
CREATE OR REPLACE FUNCTION generate_purchase_order_no()
RETURNS TRIGGER AS $$
DECLARE
  seq_num INTEGER;
  today TEXT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COALESCE(MAX(suffix::INTEGER), 0) + 1 INTO seq_num
  FROM (
    SELECT REGEXP_REPLACE(order_no, '^CG-' || today || '-', '') AS suffix
    FROM purchase_orders
    WHERE order_no LIKE 'CG-' || today || '-%'
  ) t
  WHERE suffix ~ '^\d+$';
  NEW.order_no := 'CG-' || today || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_purchase_order_no ON purchase_orders;
CREATE TRIGGER set_purchase_order_no BEFORE INSERT ON purchase_orders
  FOR EACH ROW WHEN (NEW.order_no IS NULL) EXECUTE FUNCTION generate_purchase_order_no();

/* ============================================================
   二、批量创建采购单(原子事务)
   参数:
     p_orders JSONB 数组,每个元素是一张采购单:
       supplier_id          供应商 id(必填)
       status               初始状态(submitted=勾选建单/手工建单, draft=安全库存)
       logistics_company_id 物流公司 id(可空)
       notes                备注(可空)
       items                明细数组,每行:
                            part_id / part_name_id / part_number / name /
                            supplier_part_name / brand / specification /
                            quantity / unit / unit_cost / category /
                            license_plate / photos / notes /
                            work_order_item_part_id(工单来源时必填,用于回写已采购)
     p_operator_id 操作人 id(Server Action 验证登录后传入)
   返回: { success, orders: [{id, order_no}], error? }
   ============================================================ */
CREATE OR REPLACE FUNCTION create_purchase_orders(
  p_orders JSONB,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group JSONB;
  v_item JSONB;
  v_order_id UUID;
  v_order_no TEXT;
  v_total DECIMAL(12,2);
  v_supplier_name TEXT;
  v_result JSONB := '[]'::JSONB;
  v_branch_ids UUID[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF p_orders IS NULL OR jsonb_array_length(p_orders) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不能为空');
  END IF;

  FOR v_group IN SELECT * FROM jsonb_array_elements(p_orders)
  LOOP
    /* 校验供应商并取名(回写工单配件行用) */
    SELECT name INTO v_supplier_name FROM suppliers
    WHERE id = (v_group->>'supplier_id')::UUID;
    IF NOT FOUND THEN
      RAISE EXCEPTION '供应商不存在';
    END IF;
    IF v_group->'items' IS NULL OR jsonb_array_length(v_group->'items') = 0 THEN
      RAISE EXCEPTION '采购单明细不能为空';
    END IF;

    /* 服务端算总金额,不用客户端传的数 */
    SELECT COALESCE(SUM(
      COALESCE((it->>'quantity')::INTEGER, 0) * COALESCE((it->>'unit_cost')::DECIMAL, 0)
    ), 0) INTO v_total
    FROM jsonb_array_elements(v_group->'items') it;

    /* 建单头(order_no 由触发器生成) */
    INSERT INTO purchase_orders (supplier_id, status, total_amount, logistics_company_id, notes, created_by)
    VALUES (
      (v_group->>'supplier_id')::UUID,
      COALESCE(NULLIF(v_group->>'status', ''), 'submitted'),
      v_total,
      NULLIF(v_group->>'logistics_company_id', '')::UUID,
      v_group->>'notes',
      p_operator_id
    )
    RETURNING id, order_no INTO v_order_id, v_order_no;

    /* 插明细 */
    v_branch_ids := '{}';
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_group->'items')
    LOOP
      INSERT INTO purchase_order_items (
        order_id, part_id, part_name_id, part_number, name, supplier_part_name,
        brand, specification, quantity, unit, unit_cost, category, license_plate,
        photos, notes, work_order_item_part_id, received_qty
      ) VALUES (
        v_order_id,
        NULLIF(v_item->>'part_id', '')::UUID,
        NULLIF(v_item->>'part_name_id', '')::UUID,
        v_item->>'part_number',
        v_item->>'name',
        v_item->>'supplier_part_name',
        v_item->>'brand',
        v_item->>'specification',
        GREATEST(1, COALESCE((v_item->>'quantity')::INTEGER, 1)),
        v_item->>'unit',
        COALESCE((v_item->>'unit_cost')::DECIMAL, 0),
        v_item->>'category',
        v_item->>'license_plate',
        COALESCE(v_item->'photos', '[]'::JSONB),
        v_item->>'notes',
        NULLIF(v_item->>'work_order_item_part_id', '')::UUID,
        0
      );
      IF NULLIF(v_item->>'work_order_item_part_id', '') IS NOT NULL THEN
        v_branch_ids := array_append(v_branch_ids, (v_item->>'work_order_item_part_id')::UUID);
      END IF;
    END LOOP;

    /* 回写工单配件行:已采购 + 供应商名称(与单头同事务) */
    IF array_length(v_branch_ids, 1) > 0 THEN
      UPDATE work_order_item_parts
      SET is_purchased = true, supplier_name = v_supplier_name
      WHERE id = ANY(v_branch_ids);
    END IF;

    v_result := v_result || jsonb_build_object('id', v_order_id, 'order_no', v_order_no);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'orders', v_result);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;
