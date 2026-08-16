/* 采购单撤销/作废 —— 原子事务函数（2026-08-17）
 *
 * 背景（用户 2026-08-16 拍板的采购单管理规矩）：
 *   采购单只允许两条受控出口，不提供直接删除：
 *   · 撤销(revoke)：误组单/要重新组单——配件退回待采购（工单配件行 is_purchased
 *     回 false、暂存件重建回 custom_purchase_staging），单据标 cancelled 留档
 *   · 作废(void)：这批件不要了——配件不退回，单据标 cancelled 留档
 *   仅未收货（submitted/approved）的采购单可操作；开始收货后只能走收货异常/
 *   退回流程。已入库的退回走 revoke_completed_inbound。
 *
 * 与 delete_purchase_item（少发弃货删明细→空单物理删单）的区别：
 *   那是收货异常专用通道（"这批货根本没来"），配件行一并删除；本函数是
 *   采购单管理通道，单据只废不删、留档可查。两条通道并存是有意的。
 *
 * 已知边界：暂存行的 source（safety_stock/custom）在进采购明细时未保留，
 * 撤销重建时统一记 'custom'；历史手工新建单（/procurement/new 已下线）的明细
 * 同样无工单配件关联，撤销时也会重建到暂存表——语义合理（可重新组单）。
*/

CREATE OR REPLACE FUNCTION cancel_purchase_order(
  p_purchase_order_id UUID,
  p_mode TEXT,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_supplier_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  IF p_mode NOT IN ('revoke', 'void') THEN
    RETURN jsonb_build_object('success', false, 'error', '无效的操作模式');
  END IF;

  /* 锁单并校验状态:仅未收货(已提交/已审批)可操作 */
  SELECT * INTO v_order FROM purchase_orders WHERE id = p_purchase_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status NOT IN ('submitted', 'approved') THEN
    RETURN jsonb_build_object('success', false, 'error',
      '仅未收货的采购单可撤销/作废；已开始收货的请走收货异常或退回流程');
  END IF;

  IF p_mode = 'revoke' THEN
    /* 1. 工单配件行回待采购:取消"已采购"标记;
       保留 supplier_name——待采购页按供应商分组,配件回到原供应商组 */
    UPDATE work_order_item_parts
    SET is_purchased = false
    WHERE id IN (
      SELECT work_order_item_part_id FROM purchase_order_items
      WHERE order_id = p_purchase_order_id AND work_order_item_part_id IS NOT NULL
    );

    /* 2. 无工单配件的明细(采购暂存件)重建回暂存表 */
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_order.supplier_id;
    INSERT INTO custom_purchase_staging (
      part_id, part_number, name, brand, specification,
      document_name, unit, unit_cost, quantity,
      supplier_id, supplier_name, source, created_by
    )
    SELECT
      poi.part_id, poi.part_number, poi.name, poi.brand, poi.specification,
      poi.supplier_part_name, poi.unit, poi.unit_cost, poi.quantity,
      v_order.supplier_id, v_supplier_name, 'custom', p_operator_id
    FROM purchase_order_items poi
    WHERE poi.order_id = p_purchase_order_id
      AND poi.work_order_item_part_id IS NULL;

    /* 3. 单据留档:标 cancelled + 备注前缀 */
    UPDATE purchase_orders
    SET status = 'cancelled',
        notes = '[撤销-配件已回待采购] ' || COALESCE(notes, '')
    WHERE id = p_purchase_order_id;
  ELSE
    /* 作废:配件不退回,仅单据留档 */
    UPDATE purchase_orders
    SET status = 'cancelled',
        notes = '[作废] ' || COALESCE(notes, '')
    WHERE id = p_purchase_order_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* 权限收尾(对齐 20260813 双保险):新建函数默认 PUBLIC 可执行,回收 anon/PUBLIC;
   authenticated 由 Supabase default privileges 单独授权,不受影响 */
REVOKE EXECUTE ON FUNCTION public.cancel_purchase_order(uuid, text, uuid) FROM anon, PUBLIC;

/* ============================================================
   验证方法(执行完本脚本后跑):
   SELECT proname FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname='cancel_purchase_order'
     AND pg_get_functiondef(oid) LIKE '%权限门禁%';
   应返回 1 行。
   ============================================================
*/
