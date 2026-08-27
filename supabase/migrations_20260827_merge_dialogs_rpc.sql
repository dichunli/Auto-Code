/* 配件合并 / 维修项目合并 —— 原子事务函数
   创建日期: 2026-08-27
   背景:
     PartMergeDialog 合并配件要动 11 张表(车型关联/单位价格/批次/日志/盘点/
     退货/采购明细/工单配件/保养模板/图片/配件主表),原来是客户端逐表循环写,
     中途失败就是"合并了一半"的脏数据。ServiceItemMergeDialog 同理(4 张价格表
     + 4 张引用表 + 主表)。
     本迁移把两条合并链路各收进一个数据库函数,一个事务要么全成要么全败;
     数量/冲突判断全部在服务端读最新值,不再信客户端传入的列表快照。
   角色: 登录即可(与两表现有 RLS 口径一致,合并入口本身在管理页)
   包含函数:
     一、merge_parts          —— 配件合并(库存数量服务端重新累加)
     二、merge_service_items  —— 维修项目合并(价格冲突策略: 保留主项目/覆盖)
*/

/* ============================================================
   一、配件合并(原子事务)
   参数: p_target_id 保留配件 / p_source_ids 被合并配件数组 /
         p_name 合并后名称 / p_part_number 合并后编号 /
         p_merge_quantity 是否累加库存(服务端读最新数量累加)
   ============================================================ */
CREATE OR REPLACE FUNCTION merge_parts(
  p_target_id UUID,
  p_source_ids UUID[],
  p_name TEXT,
  p_part_number TEXT,
  p_merge_quantity BOOLEAN
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_id UUID;
  v_total_qty INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF p_target_id IS NULL OR p_source_ids IS NULL OR array_length(p_source_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择要保留的配件和被合并的配件');
  END IF;
  IF p_target_id = ANY(p_source_ids) THEN
    RETURN jsonb_build_object('success', false, 'error', '保留配件不能同时是被合并配件');
  END IF;
  IF NULLIF(TRIM(COALESCE(p_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请输入合并后的名称');
  END IF;
  IF NULLIF(TRIM(COALESCE(p_part_number, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请输入合并后的配件编号');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM parts WHERE id = p_target_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '保留配件不存在');
  END IF;

  /* 1. 更新主配件名称/编号(编号唯一约束冲突会整体回滚,不再留半成品) */
  IF p_merge_quantity THEN
    /* 服务端读最新库存累加(不用客户端快照) */
    SELECT COALESCE(SUM(quantity), 0) INTO v_total_qty
    FROM parts WHERE id = p_target_id OR id = ANY(p_source_ids);
    UPDATE parts SET name = TRIM(p_name), part_number = TRIM(p_part_number), quantity = v_total_qty
    WHERE id = p_target_id;
  ELSE
    UPDATE parts SET name = TRIM(p_name), part_number = TRIM(p_part_number)
    WHERE id = p_target_id;
  END IF;

  /* 2. 逐个迁移被合并配件的关联数据 */
  FOREACH v_source_id IN ARRAY p_source_ids LOOP
    /* 车型关联:跳过目标已有的(冲突忽略,与原逻辑一致) */
    INSERT INTO part_vehicle_models (part_id, vehicle_model_id, fitment_position, source, vin17_fitness_id)
    SELECT p_target_id, s.vehicle_model_id, s.fitment_position, s.source, s.vin17_fitness_id
    FROM part_vehicle_models s
    WHERE s.part_id = v_source_id
      AND NOT EXISTS (
        SELECT 1 FROM part_vehicle_models t
        WHERE t.part_id = p_target_id AND t.vehicle_model_id = s.vehicle_model_id
      );

    /* 单位专属价格:跳过冲突 */
    INSERT INTO company_part_prices (part_id, company_id, price)
    SELECT p_target_id, s.company_id, s.price
    FROM company_part_prices s
    WHERE s.part_id = v_source_id
      AND NOT EXISTS (
        SELECT 1 FROM company_part_prices t
        WHERE t.part_id = p_target_id AND t.company_id = s.company_id
      );

    /* 直接换主的引用表 */
    UPDATE part_batches SET part_id = p_target_id WHERE part_id = v_source_id;
    UPDATE inventory_logs SET part_id = p_target_id WHERE part_id = v_source_id;
    UPDATE inventory_check_items SET part_id = p_target_id WHERE part_id = v_source_id;
    UPDATE purchase_returns SET part_id = p_target_id WHERE part_id = v_source_id;
    UPDATE purchase_order_items SET part_id = p_target_id WHERE part_id = v_source_id;
    UPDATE work_order_item_parts SET part_id = p_target_id WHERE part_id = v_source_id;
    UPDATE vehicle_maintenance_template_parts SET part_id = p_target_id WHERE part_id = v_source_id;
    UPDATE part_images SET part_id = p_target_id WHERE part_id = v_source_id;

    /* 删除被合并配件 */
    DELETE FROM parts WHERE id = v_source_id;
  END LOOP;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.merge_parts(uuid, uuid[], text, text, boolean) FROM anon, PUBLIC;

/* ============================================================
   二、维修项目合并(原子事务)
   参数: p_target_id 保留项目 / p_source_ids 被合并项目数组 /
         p_name 合并后名称 / p_strategy 价格冲突策略
           ('keep_target' 保留主项目价格 / 'override' 用被合并项目覆盖)
   ============================================================ */
CREATE OR REPLACE FUNCTION merge_service_items(
  p_target_id UUID,
  p_source_ids UUID[],
  p_name TEXT,
  p_strategy TEXT
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF p_target_id IS NULL OR p_source_ids IS NULL OR array_length(p_source_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择要保留的项目和被合并的项目');
  END IF;
  IF p_target_id = ANY(p_source_ids) THEN
    RETURN jsonb_build_object('success', false, 'error', '保留项目不能同时是被合并项目');
  END IF;
  IF NULLIF(TRIM(COALESCE(p_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请输入合并后的名称');
  END IF;
  IF p_strategy NOT IN ('keep_target', 'override') THEN
    RETURN jsonb_build_object('success', false, 'error', '价格冲突策略无效');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM service_items WHERE id = p_target_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '保留项目不存在');
  END IF;

  /* 1. 更新主项目名称(名称唯一约束冲突会整体回滚) */
  UPDATE service_items SET name = TRIM(p_name) WHERE id = p_target_id;

  FOREACH v_source_id IN ARRAY p_source_ids LOOP
    /* 2a. 车型定价:无冲突插入;有冲突按策略覆盖或跳过 */
    IF p_strategy = 'override' THEN
      UPDATE service_item_prices t SET
        price = s.price, vip_price = s.vip_price,
        customer_parts_price = s.customer_parts_price, company_price = s.company_price
      FROM service_item_prices s
      WHERE s.service_item_id = v_source_id
        AND t.service_item_id = p_target_id
        AND t.vehicle_model_id = s.vehicle_model_id
        AND COALESCE(t.group_key, '') = COALESCE(s.group_key, '');
    END IF;
    INSERT INTO service_item_prices (service_item_id, vehicle_model_id, price, vip_price, customer_parts_price, company_price, group_key)
    SELECT p_target_id, s.vehicle_model_id, s.price, s.vip_price, s.customer_parts_price, s.company_price, s.group_key
    FROM service_item_prices s
    WHERE s.service_item_id = v_source_id
      AND NOT EXISTS (
        SELECT 1 FROM service_item_prices t
        WHERE t.service_item_id = p_target_id
          AND t.vehicle_model_id = s.vehicle_model_id
          AND COALESCE(t.group_key, '') = COALESCE(s.group_key, '')
      );

    /* 2b. 指定用户价格(按 单位/客户/车辆 三元组判冲突) */
    IF p_strategy = 'override' THEN
      UPDATE service_item_special_prices t SET price = s.price
      FROM service_item_special_prices s
      WHERE s.service_item_id = v_source_id
        AND t.service_item_id = p_target_id
        AND COALESCE(t.company_id::TEXT, '') = COALESCE(s.company_id::TEXT, '')
        AND COALESCE(t.customer_id::TEXT, '') = COALESCE(s.customer_id::TEXT, '')
        AND COALESCE(t.vehicle_id::TEXT, '') = COALESCE(s.vehicle_id::TEXT, '');
    END IF;
    INSERT INTO service_item_special_prices (service_item_id, company_id, customer_id, vehicle_id, price)
    SELECT p_target_id, s.company_id, s.customer_id, s.vehicle_id, s.price
    FROM service_item_special_prices s
    WHERE s.service_item_id = v_source_id
      AND NOT EXISTS (
        SELECT 1 FROM service_item_special_prices t
        WHERE t.service_item_id = p_target_id
          AND COALESCE(t.company_id::TEXT, '') = COALESCE(s.company_id::TEXT, '')
          AND COALESCE(t.customer_id::TEXT, '') = COALESCE(s.customer_id::TEXT, '')
          AND COALESCE(t.vehicle_id::TEXT, '') = COALESCE(s.vehicle_id::TEXT, '')
      );

    /* 2c. 单位服务价格 */
    IF p_strategy = 'override' THEN
      UPDATE company_service_prices t SET price = s.price
      FROM company_service_prices s
      WHERE s.service_item_id = v_source_id
        AND t.service_item_id = p_target_id
        AND t.company_id = s.company_id;
    END IF;
    INSERT INTO company_service_prices (service_item_id, company_id, price)
    SELECT p_target_id, s.company_id, s.price
    FROM company_service_prices s
    WHERE s.service_item_id = v_source_id
      AND NOT EXISTS (
        SELECT 1 FROM company_service_prices t
        WHERE t.service_item_id = p_target_id AND t.company_id = s.company_id
      );

    /* 2d. 引用表换主 */
    UPDATE work_order_items SET service_item_id = p_target_id WHERE service_item_id = v_source_id;
    UPDATE vehicle_maintenance_template_items SET service_item_id = p_target_id WHERE service_item_id = v_source_id;
    UPDATE knowledge_service_links SET service_item_id = p_target_id WHERE service_item_id = v_source_id;
    UPDATE outsource_order_items SET service_item_id = p_target_id WHERE service_item_id = v_source_id;

    /* 2e. 删除被合并项目(级联清理其旧定价行) */
    DELETE FROM service_items WHERE id = v_source_id;
  END LOOP;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.merge_service_items(uuid, uuid[], text, text) FROM anon, PUBLIC;
