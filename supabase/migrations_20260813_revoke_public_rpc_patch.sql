/*
 * 补丁：收回 10 个采购函数的 PUBLIC 默认执行权限
 * 背景：上一版只 REVOKE FROM anon，但 PostgreSQL 默认把 EXECUTE 授给了 PUBLIC
 * （PUBLIC 包含匿名用户），所以匿名仍可调用。收回 PUBLIC 后才真正生效。
 * authenticated（已登录员工）权限保留，系统正常使用不受影响。
 */

REVOKE EXECUTE ON FUNCTION public.complete_purchase_inbound(uuid, jsonb, numeric, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_purchase_orders(jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_purchase_return_orders(jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_purchase_item(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.receive_purchase_item(uuid, uuid, text, integer, jsonb, boolean, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.receive_purchase_item_partial(uuid, uuid, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_pending_storage(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_purchase_receipt(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_supplier_returns(uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_supplier_full(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
