/* 配件名称合并 —— 原子事务函数
   创建日期: 2026-08-28
   背景:
     配件名称合并(MergeButton 单个 / BatchMergeDialog 批量)要动 6 张表
     (品牌关联/规格关联/parts/work_order_parts/company_part_prices/
     purchase_order_items + 删除源名称),原来是客户端逐表循环写,
     中途失败留"合并了一半"的脏数据。
     本函数一个事务要么全成要么全败;品牌/规格关联按"目标已有则跳过"合并。
   角色: 登录即可(与 part_names 表现有 RLS 口径一致)
   参数: p_target_id 保留名称 / p_source_ids 被合并名称数组 /
         p_final_name 合并后名称(空=保持目标原名)
*/
CREATE OR REPLACE FUNCTION merge_part_names(
  p_target_id UUID,
  p_source_ids UUID[],
  p_final_name TEXT DEFAULT NULL
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
    RETURN jsonb_build_object('success', false, 'error', '请选择要保留的名称和被合并的名称');
  END IF;
  IF p_target_id = ANY(p_source_ids) THEN
    RETURN jsonb_build_object('success', false, 'error', '保留名称不能同时是被合并名称');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM part_names WHERE id = p_target_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '保留名称不存在');
  END IF;

  /* 1. 改名(传了且与现名不同才改;名称唯一约束冲突会整体回滚) */
  IF NULLIF(TRIM(COALESCE(p_final_name, '')), '') IS NOT NULL THEN
    UPDATE part_names SET name = TRIM(p_final_name)
    WHERE id = p_target_id AND name <> TRIM(p_final_name);
  END IF;

  FOREACH v_source_id IN ARRAY p_source_ids LOOP
    /* 2a. 品牌关联:目标已有则跳过,其余迁移;然后清掉源的关联 */
    INSERT INTO part_name_brands (part_name_id, brand_id, usage_count)
    SELECT p_target_id, s.brand_id, COALESCE(s.usage_count, 0)
    FROM part_name_brands s
    WHERE s.part_name_id = v_source_id
      AND NOT EXISTS (
        SELECT 1 FROM part_name_brands t
        WHERE t.part_name_id = p_target_id AND t.brand_id = s.brand_id
      );
    DELETE FROM part_name_brands WHERE part_name_id = v_source_id;

    /* 2b. 规格关联:同上 */
    INSERT INTO part_name_specifications (part_name_id, specification_id, usage_count)
    SELECT p_target_id, s.specification_id, COALESCE(s.usage_count, 0)
    FROM part_name_specifications s
    WHERE s.part_name_id = v_source_id
      AND NOT EXISTS (
        SELECT 1 FROM part_name_specifications t
        WHERE t.part_name_id = p_target_id AND t.specification_id = s.specification_id
      );
    DELETE FROM part_name_specifications WHERE part_name_id = v_source_id;

    /* 2c. 引用表换主 */
    UPDATE parts SET part_name_id = p_target_id WHERE part_name_id = v_source_id;
    UPDATE work_order_parts SET part_name_id = p_target_id WHERE part_name_id = v_source_id;
    UPDATE company_part_prices SET part_name_id = p_target_id WHERE part_name_id = v_source_id;
    UPDATE purchase_order_items SET part_name_id = p_target_id WHERE part_name_id = v_source_id;

    /* 2d. 删除源名称 */
    DELETE FROM part_names WHERE id = v_source_id;
  END LOOP;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.merge_part_names(uuid, uuid[], text) FROM anon, PUBLIC;
