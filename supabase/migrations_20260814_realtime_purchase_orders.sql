/*
 * 把采购单相关表加入 Realtime 发布，让采购管理页角标能实时刷新
 * 背景（2026-08-14）：采购管理页角标订阅了 purchase_orders 表的变化，
 * 但该表不在 supabase_realtime 发布里，事件根本不发，待收货/待入库角标不实时。
 * purchase_order_items 的 handle_action 变化也影响待收货角标，一并加入。
 */

ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_order_items;
