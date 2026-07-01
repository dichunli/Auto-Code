-- 配件分支「原子删除」RPC —— 口径修正版
-- 背景：原 delete_part_branch 按 part_name_id 判定"同组"并转移选中，
-- 但页面显示与分组是按 branch_group_id（目录）来的。两个口径不一致时，
-- 若一个项目里存在"同名但独立的多个目录"（同 part_name_id、不同 branch_group_id），
-- 删除某目录的分支会把选中错误地转移到另一个目录去，且计数也算错。
--
-- 本次修正：同组判定与选中转移一律按"目录键"= COALESCE(branch_group_id::text, part_name_id::text)
-- 与前端分组 key（branch_group_id || part_name_id）完全对齐。
-- 仍只改 is_selected / 删行，不动 status，不触发库存误扣/误退。

CREATE OR REPLACE FUNCTION delete_part_branch(p_part_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item_id UUID;
  v_name_id UUID;
  v_group_id UUID;
  v_dir_key TEXT;          -- 目录键：优先 branch_group_id，空则回退 part_name_id
  v_was_selected BOOLEAN;
  v_count INT;
  v_new_selected UUID;
BEGIN
  -- 取被删分支信息
  SELECT work_order_item_id, part_name_id, branch_group_id, is_selected
    INTO v_item_id, v_name_id, v_group_id, v_was_selected
  FROM work_order_item_parts WHERE id = p_part_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件分支不存在');
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
END;
$$;
