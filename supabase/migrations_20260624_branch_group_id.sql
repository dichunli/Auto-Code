/* ============================================================
   工单配件「目录分组」branch_group_id 迁移
   同一 branch_group_id 的若干分支 = 一个"配件名称（叶子目录）"。
   目的：支持同名但相互独立的多个目录；数量按目录级、金额按选中分支销售价。

   ⚠️ 重要：请【分步】在 Supabase SQL Editor 里执行，不要一次性全选运行，
   否则全表回填会触发网关超时（表大 + 行级触发器逐行调用）。
   只改 branch_group_id 不动 status，不会误扣/误退库存（触发器有 status 条件保护）。
   ============================================================ */


/* ───── 第 1 步（运行一次，秒级完成）─────
   加列 + 设默认值。之后"新增配件"会自动获得各自独立的目录 id；
   "加分支"时前端会显式传目标目录 id。老数据先留空，下一步再回填。 */

ALTER TABLE work_order_item_parts ADD COLUMN IF NOT EXISTS branch_group_id UUID;
ALTER TABLE work_order_item_parts ALTER COLUMN branch_group_id SET DEFAULT gen_random_uuid();


/* ───── 第 2 步（重复运行，直到结果显示 "0 rows" 为止）─────
   小批量回填老数据：同一 (工单项目, 配件名称) 归一个目录；无配件名称的每行各自一组。
   每次只处理 3000 行，秒级完成，反复点"运行"几次即可把历史数据补全。
   （应用已做兼容：未回填的老行会临时按配件名称分组，不影响使用，可从容回填。） */

WITH todo AS (
  SELECT id FROM work_order_item_parts WHERE branch_group_id IS NULL LIMIT 3000
)
UPDATE work_order_item_parts t
SET branch_group_id = CASE
  WHEN t.part_name_id IS NOT NULL
    THEN md5(t.work_order_item_id::text || ':' || t.part_name_id::text)::uuid
  ELSE md5('row:' || t.id::text)::uuid
END
FROM todo
WHERE t.id = todo.id;


/* ───── 第 3 步（回填全部完成后，运行一次）─────
   建索引，加速按目录分组查询。 */

CREATE INDEX IF NOT EXISTS idx_woip_branch_group ON work_order_item_parts(branch_group_id);
