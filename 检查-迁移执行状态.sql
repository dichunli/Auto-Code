/* 采购迁移执行状态总检查（2026-08-19）
 * 用法：整段复制到 Supabase SQL Editor 执行，把两个结果表发给我。

-- 第一部分：采购相关函数存在性（应返回 14 行） */
SELECT proname AS 函数名 FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND proname IN (
    'complete_purchase_inbound','create_purchase_orders','create_purchase_return_orders',
    'delete_purchase_item','receive_purchase_item','receive_purchase_item_partial',
    'revoke_pending_storage','revoke_purchase_receipt','revoke_supplier_returns','save_supplier_full',
    'revoke_completed_inbound','revoke_purchase_return_order','reset_outsource_finance','cancel_purchase_order'
  )
ORDER BY proname;

/* 第二部分：RLS 收紧策略（应返回 40 行；supplier_return_records 的 insert 为 true 其余写含 has_role） */
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('suppliers','supplier_contacts','supplier_part_categories',
                    'supplier_part_names','supplier_part_brands','supplier_vehicle_models',
                    'purchase_orders','purchase_order_items','custom_purchase_staging',
                    'supplier_return_records')
ORDER BY tablename, cmd;
