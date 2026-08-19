/* 工单配件行（woip）写操作函数化（2026-08-19 批次5B 阶段1）
 *
 * 背景（采购梳理 woip 专项）：
 *   work_order_item_parts 跨采购/工单两业务，接待/技师/采购/仓管都在写，
 *   RLS 行级无法区分"谁为什么改"，本次先把高频/高危写操作收进函数：
 *   后续阶段 2（观察几天后）才把表 DELETE/INSERT 策略收紧，函数先就绪。
 *
 * 本迁移（全部 SECURITY DEFINER + 登录校验 + 五角色门禁）：
 *   一、delete_part_branch      —— 加固：补 SECURITY DEFINER+门禁+已采购/已到货守卫
 *                                  （原函数 0619/0701 版裸奔，表收紧即瘫）
 *   二、delete_part_group       —— 新建：整组删除（同目录键），守卫同上
 *   三、add_work_order_item_parts —— 新建：工单项目批量添加配件行
 *   四、add_part_branch         —— 新建：给已有目录加分支（沿用源行 branch_group_id，
 *                                  防"自成新目录"旧病；铁律：新分支永远不选中）
 *   五、select_part_branch      —— 新建：组内原子切换选中（替代前端 6 处非原子双写，
 *                                  根治"整组 0 选中→小计 ¥0"隐患）
 *   六、set_part_purchase_flag  —— 新建：手动标记已采购/已到货（兜底用途，
 *                                  守卫内置：库存>0 不可标采购、未采购不可标到货）
 *
 * 角色说明：这些操作是一线员工（接待/技师）日常高频动作，门禁放宽到
 * admin/boss/warehouse/receptionist/mechanic 五角色（仅排除 accountant 及未来外部账号）。
*/

/* ============================================================
   一、配件分支删除（加固版；口径与 0701 版一致：目录键=COALESCE(branch_group_id, part_name_id)）
   ============================================================ */
CREATE OR REPLACE FUNCTION delete_part_branch(p_part_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id UUID;
  v_name_id UUID;
  v_group_id UUID;
  v_dir_key TEXT;
  v_was_selected BOOLEAN;
  v_purchased BOOLEAN;
  v_arrived BOOLEAN;
  v_count INT;
  v_new_selected UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁：一线员工日常操作，五角色可用 */
  IF NOT public.has_role('admin', 'boss', 'warehouse', 'receptionist', 'mechanic') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限操作配件分支');
  END IF;

  -- 取被删分支信息
  SELECT work_order_item_id, part_name_id, branch_group_id, is_selected,
         COALESCE(is_purchased, false), COALESCE(is_arrived, false)
    INTO v_item_id, v_name_id, v_group_id, v_was_selected, v_purchased, v_arrived
  FROM work_order_item_parts WHERE id = p_part_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件分支不存在');
  END IF;

  /* 守卫（2026-08-19 加固）：已采购/已到货的分支不能删——请走采购流程撤销 */
  IF v_purchased OR v_arrived THEN
    RETURN jsonb_build_object('success', false, 'error', '该分支已采购或已到货，不能直接删除，请先走采购流程撤销');
  END IF;

  v_dir_key := COALESCE(v_group_id::text, v_name_id::text);

  -- 同目录分支数（同项目 + 同目录键），至少保留一个
  SELECT count(*) INTO v_count FROM work_order_item_parts
   WHERE work_order_item_id = v_item_id
     AND COALESCE(branch_group_id::text, part_name_id::text) IS NOT DISTINCT FROM v_dir_key;

  IF v_count <= 1 THEN
    RETURN jsonb_build_object('success', false, 'error', '至少需要保留一个配件分支');
  END IF;

  -- 删除该分支
  DELETE FROM work_order_item_parts WHERE id = p_part_id;

  -- 若删的是选中分支：把同目录剩余里排第一(sort_order 最小)的设为选中
  IF v_was_selected THEN
    SELECT id INTO v_new_selected FROM work_order_item_parts
     WHERE work_order_item_id = v_item_id
       AND COALESCE(branch_group_id::text, part_name_id::text) IS NOT DISTINCT FROM v_dir_key
     ORDER BY sort_order ASC NULLS LAST, created_at ASC
     LIMIT 1;

    IF v_new_selected IS NOT NULL THEN
      UPDATE work_order_item_parts SET is_selected = true WHERE id = v_new_selected;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'new_selected_id', v_new_selected);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   二、整组删除配件目录（同项目+同目录键的所有分支）
   参数: p_part_id 组内任意一个分支 id（函数自己算目录键）
   守卫: 组内任一分支已采购/已到货 → 整组拒绝删除
   ============================================================ */
CREATE OR REPLACE FUNCTION delete_part_group(p_part_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id UUID;
  v_name_id UUID;
  v_group_id UUID;
  v_dir_key TEXT;
  v_deleted INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse', 'receptionist', 'mechanic') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限操作配件分支');
  END IF;

  SELECT work_order_item_id, part_name_id, branch_group_id
    INTO v_item_id, v_name_id, v_group_id
  FROM work_order_item_parts WHERE id = p_part_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件分支不存在');
  END IF;

  v_dir_key := COALESCE(v_group_id::text, v_name_id::text);

  /* 守卫：组内有已采购/已到货的分支则整组拒绝 */
  IF EXISTS (
    SELECT 1 FROM work_order_item_parts
    WHERE work_order_item_id = v_item_id
      AND COALESCE(branch_group_id::text, part_name_id::text) IS NOT DISTINCT FROM v_dir_key
      AND (is_purchased = true OR is_arrived = true)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '该组内有分支已采购或已到货，不能直接删除，请先走采购流程撤销');
  END IF;

  DELETE FROM work_order_item_parts
  WHERE work_order_item_id = v_item_id
    AND COALESCE(branch_group_id::text, part_name_id::text) IS NOT DISTINCT FROM v_dir_key;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'deleted', v_deleted);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   三、工单项目批量添加配件行（名称类/库存类）
   参数: p_item_id 工单项目 id
         p_parts JSONB 数组,每行字段照抄表列(可空字段不传即 NULL):
         part_name_id/part_id/part_number/name/alias_name/unit/brand/specification/
         unit_cost/unit_price/quantity/customer_opinion/is_selected/notes/sort_order/
         branch_group_id(不传则数据库默认自成新目录)
   ============================================================ */
CREATE OR REPLACE FUNCTION add_work_order_item_parts(
  p_item_id UUID,
  p_parts JSONB
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_part JSONB;
  v_ids UUID[] := '{}';
  v_new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse', 'receptionist', 'mechanic') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限操作配件分支');
  END IF;
  IF p_parts IS NULL OR jsonb_array_length(p_parts) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '配件列表不能为空');
  END IF;

  /* 校验工单项目存在 */
  PERFORM 1 FROM work_order_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '工单项目不存在');
  END IF;

  FOR v_part IN SELECT * FROM jsonb_array_elements(p_parts)
  LOOP
    IF NULLIF(TRIM(COALESCE(v_part->>'name', '')), '') IS NULL THEN
      RAISE EXCEPTION '配件名称不能为空';
    END IF;
    INSERT INTO work_order_item_parts (
      work_order_item_id, part_name_id, part_id, part_number, name, alias_name,
      unit, brand, specification, unit_cost, unit_price, quantity,
      customer_opinion, is_selected, notes, sort_order, branch_group_id
    ) VALUES (
      p_item_id,
      NULLIF(v_part->>'part_name_id', '')::UUID,
      NULLIF(v_part->>'part_id', '')::UUID,
      NULLIF(TRIM(COALESCE(v_part->>'part_number', '')), ''),
      TRIM(v_part->>'name'),
      NULLIF(TRIM(COALESCE(v_part->>'alias_name', '')), ''),
      NULLIF(TRIM(COALESCE(v_part->>'unit', '')), ''),
      NULLIF(TRIM(COALESCE(v_part->>'brand', '')), ''),
      NULLIF(TRIM(COALESCE(v_part->>'specification', '')), ''),
      NULLIF(v_part->>'unit_cost', '')::DECIMAL,
      NULLIF(v_part->>'unit_price', '')::DECIMAL,
      NULLIF(v_part->>'quantity', '')::INTEGER,
      COALESCE(NULLIF(v_part->>'customer_opinion', ''), 'pending'),
      COALESCE((v_part->>'is_selected')::BOOLEAN, true),
      NULLIF(TRIM(COALESCE(v_part->>'notes', '')), ''),
      NULLIF(v_part->>'sort_order', '')::INTEGER,
      /* 不传则服务端生成新目录 id（显式 NULL 不会触发列默认值，必须 COALESCE 兜底） */
      COALESCE(NULLIF(v_part->>'branch_group_id', '')::UUID, gen_random_uuid())
    )
    RETURNING id INTO v_new_id;
    v_ids := array_append(v_ids, v_new_id);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'ids', v_ids);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   四、给已有目录加分支（克隆源行的目录归属）
   参数: p_source_part_id 源分支 id（同目录下任意一行）
   业务铁律（原 PartGroupHeader:204-206 注释）：本操作是"给已有目录加分支"，
   该目录必然已有一个选中分支存在，所以新分支【永远不选中】(固定 false)。
   数量跟随目录：源行数量为 NULL 就留空（红底留白提醒补填），不兜底成 1。
   ============================================================ */
CREATE OR REPLACE FUNCTION add_part_branch(p_source_part_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src RECORD;
  v_new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse', 'receptionist', 'mechanic') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限操作配件分支');
  END IF;

  SELECT work_order_item_id, branch_group_id, part_name_id, name, unit, quantity
    INTO v_src
  FROM work_order_item_parts WHERE id = p_source_part_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '源分支不存在');
  END IF;

  /* 关键：branch_group_id 沿用源行（不显式传则数据库默认自成新目录——旧病根治） */
  INSERT INTO work_order_item_parts (
    work_order_item_id, branch_group_id, part_name_id, name, unit, quantity,
    customer_opinion, is_selected
  ) VALUES (
    v_src.work_order_item_id, v_src.branch_group_id, v_src.part_name_id,
    v_src.name, v_src.unit, v_src.quantity,
    'pending', false
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   五、组内原子切换选中分支（替代前端 6 处"兄弟 false + 本行 true"两步写）
   ============================================================ */
CREATE OR REPLACE FUNCTION select_part_branch(p_part_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id UUID;
  v_name_id UUID;
  v_group_id UUID;
  v_dir_key TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse', 'receptionist', 'mechanic') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限操作配件分支');
  END IF;

  SELECT work_order_item_id, part_name_id, branch_group_id
    INTO v_item_id, v_name_id, v_group_id
  FROM work_order_item_parts WHERE id = p_part_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件分支不存在');
  END IF;

  v_dir_key := COALESCE(v_group_id::text, v_name_id::text);

  /* 一个事务：同目录其他行取消选中 + 本行选中（不会出现 0 选中中间态） */
  UPDATE work_order_item_parts SET is_selected = false
  WHERE work_order_item_id = v_item_id
    AND COALESCE(branch_group_id::text, part_name_id::text) IS NOT DISTINCT FROM v_dir_key
    AND id <> p_part_id;
  UPDATE work_order_item_parts SET is_selected = true WHERE id = p_part_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   六、手动标记已采购/已到货（兜底用途；正常由采购流程 RPC 自动回写）
   守卫（移植自客户端 PartBranchEditor:828/849、MobileItemEditor:1385/1401）：
   - 标记已采购：配件关联库存 quantity>0 时拒绝（库存不为 0 无需采购）
   - 取消已采购：放行
   - 标记已到货：须先已采购
   - 取消到货：放行
   ============================================================ */
CREATE OR REPLACE FUNCTION set_part_purchase_flag(
  p_part_id UUID,
  p_flag TEXT,
  p_value BOOLEAN
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_stock INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse', 'receptionist', 'mechanic') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限操作配件分支');
  END IF;
  IF p_flag NOT IN ('is_purchased', 'is_arrived') THEN
    RETURN jsonb_build_object('success', false, 'error', '无效的标记类型');
  END IF;

  SELECT id, part_id, COALESCE(is_purchased, false) AS is_purchased
    INTO v_row
  FROM work_order_item_parts WHERE id = p_part_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件分支不存在');
  END IF;

  IF p_flag = 'is_purchased' AND p_value = true THEN
    /* 库存守卫：有关联库存配件且库存>0 时无需采购 */
    IF v_row.part_id IS NOT NULL THEN
      SELECT quantity INTO v_stock FROM parts WHERE id = v_row.part_id;
      IF COALESCE(v_stock, 0) > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', '库存不为 0，无需采购');
      END IF;
    END IF;
  END IF;

  IF p_flag = 'is_arrived' AND p_value = true AND NOT v_row.is_purchased THEN
    RETURN jsonb_build_object('success', false, 'error', '需先采购后才能标记到货');
  END IF;

  IF p_flag = 'is_purchased' THEN
    UPDATE work_order_item_parts SET is_purchased = p_value WHERE id = p_part_id;
  ELSE
    UPDATE work_order_item_parts SET is_arrived = p_value WHERE id = p_part_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   权限收尾：新建/重建函数回收 anon/PUBLIC（authenticated 由 default privileges 授权）
   delete_part_branch 是 0619 就存在的老函数，CREATE OR REPLACE 保留原权限，
   在此一并补齐回收（幂等）。
   ============================================================ */
REVOKE EXECUTE ON FUNCTION public.delete_part_branch(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_part_group(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_work_order_item_parts(uuid, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_part_branch(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.select_part_branch(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_part_purchase_flag(uuid, text, boolean) FROM anon, PUBLIC;

/* ============================================================
   验证方法(执行完本脚本后跑):
   SELECT proname FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname IN ('delete_part_branch','delete_part_group','add_work_order_item_parts',
                     'add_part_branch','select_part_branch','set_part_purchase_flag')
     AND pg_get_functiondef(oid) LIKE '%权限门禁%';
   应返回 6 行。
   ============================================================
*/
