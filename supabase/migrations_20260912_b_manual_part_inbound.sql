/* ============================================================
 * 手工入库事务化（2026-09-12 诊断 P0：并发丢库存）
 *
 * 背景：库存管理「入库登记」原来是服务端"先读数量、内存里加、再写回绝对值"，
 * 两人同时入库会互相覆盖（都读到 10、各入 5、都写回 15——丢 5 个且不报错），
 * 批次和流水也是分散三步写，中途失败留半账。
 * 本函数把「加库存→批次→流水」收进一个事务：
 * UPDATE ... SET quantity = quantity + n 由数据库排队执行，并发安全。
 * 与 create_purchase_return 等既有事务函数同模式：SECURITY DEFINER + 函数内查登录。
 *
 * 注意：仓位账（part_stock_locations）暂不在此函数内——手工入库表单没有
 * 仓库/仓位字段，货进哪个仓位需要业务拍板后另行补充。
 * ============================================================ */
CREATE OR REPLACE FUNCTION manual_part_inbound(
  p_part_id UUID,
  p_qty INTEGER,
  p_unit_cost DECIMAL DEFAULT NULL,
  p_batch_no TEXT DEFAULT NULL,
  p_waybill_id UUID DEFAULT NULL,
  p_log_notes TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_after_qty INTEGER;
BEGIN
  /* 必须已登录（SECURITY DEFINER 绕过 RLS，身份在此兜底） */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  IF p_part_id IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '入库数量必须大于0');
  END IF;

  /* 原子加库存：数据库内部排队执行，并发不会互相覆盖 */
  UPDATE parts
  SET quantity = quantity + p_qty
  WHERE id = p_part_id
  RETURNING quantity INTO v_after_qty;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件不存在');
  END IF;

  /* 批次（与原手工入库口径一致：有批次号才建） */
  IF NULLIF(TRIM(COALESCE(p_batch_no, '')), '') IS NOT NULL THEN
    INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost)
    VALUES (p_part_id, TRIM(p_batch_no), p_qty, p_qty, COALESCE(p_unit_cost, 0));
  END IF;

  /* 流水（前后数量在同一事务内算出，并发下也准确） */
  INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, waybill_id, notes)
  VALUES (p_part_id, 'inbound', p_qty, v_after_qty - p_qty, v_after_qty, p_waybill_id, p_log_notes);

  RETURN jsonb_build_object('success', true, 'before_qty', v_after_qty - p_qty, 'after_qty', v_after_qty);
END;
$$ LANGUAGE plpgsql;
