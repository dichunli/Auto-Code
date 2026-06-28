-- 配件分支「原子删除」RPC
-- 解决：删除分支(删自己) + 转移选中(设下一条) 原来是前端两步请求，
-- 远程网络不稳时第二步可能失败，导致整组 0 选中、金额算错。
-- 改为数据库内一个事务完成，要么全成功、要么全不动。

CREATE OR REPLACE FUNCTION delete_part_branch(p_part_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item_id UUID;
  v_name_id UUID;
  v_was_selected BOOLEAN;
  v_count INT;
  v_new_selected UUID;
BEGIN
  -- 取被删分支信息
  SELECT work_order_item_id, part_name_id, is_selected
    INTO v_item_id, v_name_id, v_was_selected
  FROM work_order_item_parts WHERE id = p_part_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件分支不存在');
  END IF;

  -- 同组分支数（同项目 + 同配件名），至少保留一个
  SELECT count(*) INTO v_count FROM work_order_item_parts
   WHERE work_order_item_id = v_item_id
     AND part_name_id IS NOT DISTINCT FROM v_name_id;

  IF v_count <= 1 THEN
    RETURN jsonb_build_object('success', false, 'error', '至少需要保留一个配件分支');
  END IF;

  -- 删除该分支
  DELETE FROM work_order_item_parts WHERE id = p_part_id;

  -- 若删的是选中分支：把同组剩余里排第一(sort_order 最小)的设为选中
  IF v_was_selected THEN
    SELECT id INTO v_new_selected FROM work_order_item_parts
     WHERE work_order_item_id = v_item_id
       AND part_name_id IS NOT DISTINCT FROM v_name_id
     ORDER BY sort_order ASC NULLS LAST, created_at ASC
     LIMIT 1;

    IF v_new_selected IS NOT NULL THEN
      UPDATE work_order_item_parts SET is_selected = true WHERE id = v_new_selected;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'new_selected_id', v_new_selected);
END;
$$;
