/*
 * 安全加固：收回 10 个 SECURITY DEFINER 函数的匿名执行权限
 * 背景：Supabase 安全顾问报告这些函数可被 anon（未登录）角色通过 /rest/v1/rpc/ 直接调用。
 * 函数内部虽有 auth.uid() 未登录兜底，但仍收回 anon 的执行权限，双保险。
 * 注意：authenticated（已登录员工）保留执行权限，前端/服务端正常调用不受影响。
 */

/* 注意：PostgreSQL 默认给 PUBLIC（包含匿名）执行权限，必须连 PUBLIC 一起收回才真正生效 */
REVOKE EXECUTE ON FUNCTION public.complete_purchase_inbound(uuid, jsonb, numeric, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_purchase_orders(jsonb, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_purchase_return_orders(jsonb, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_purchase_item(uuid, uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.receive_purchase_item(uuid, uuid, text, integer, jsonb, boolean, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.receive_purchase_item_partial(uuid, uuid, integer, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_pending_storage(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_purchase_receipt(uuid, uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_supplier_returns(uuid[], uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_supplier_full(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) FROM anon, PUBLIC;

/* 修复 generate_purchase_order_no 的 search_path 不固定问题（安全顾问 lint 0011） */
ALTER FUNCTION public.generate_purchase_order_no() SET search_path = public, pg_temp;
