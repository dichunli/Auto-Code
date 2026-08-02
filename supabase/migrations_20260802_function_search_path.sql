/*
 * 固定数据库函数的 search_path（2026-08-02 安全顾问 function_search_path_mutable 告警）
 * 原理：函数没固定 search_path 时，理论上可被"搜索路径劫持"（在建了同名恶意对象的 schema 里执行）
 * 修复：给业务自研函数统一加 SET search_path = public，纯声明、不改任何逻辑
 * 说明：pg_trgm 扩展自带的函数（similarity/gtrgm_* 等）由扩展管理，不在此列
 */

ALTER FUNCTION public.add_construction_log(uuid, uuid, text) SET search_path = public;
ALTER FUNCTION public.auto_fill_part_info() SET search_path = public;
ALTER FUNCTION public.auto_fill_service_item_name() SET search_path = public;
ALTER FUNCTION public.auto_link_part_to_vehicle() SET search_path = public;
ALTER FUNCTION public.check_promotion_eligibility(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.create_material_return_order(uuid, uuid, jsonb, text, text, text, uuid) SET search_path = public;
ALTER FUNCTION public.create_picking_order(uuid, jsonb, text, text, uuid) SET search_path = public;
ALTER FUNCTION public.create_work_order(uuid, uuid, integer, integer, text, text, uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.create_work_order(text, text, text, text, text, text, text, integer, integer, text, text, uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.create_work_order(uuid, uuid, integer, integer, text, text, uuid, jsonb, text, text) SET search_path = public;
ALTER FUNCTION public.deduct_part_batch_fifo() SET search_path = public;
ALTER FUNCTION public.delete_part_branch(uuid) SET search_path = public;
ALTER FUNCTION public.extract_knowledge_blocks_text(jsonb) SET search_path = public;
ALTER FUNCTION public.fn_deduct_batch_on_picking() SET search_path = public;
ALTER FUNCTION public.fn_order_ready_to_close(uuid) SET search_path = public;
ALTER FUNCTION public.fn_restore_batch_on_return() SET search_path = public;
ALTER FUNCTION public.generate_inbound_no() SET search_path = public;
ALTER FUNCTION public.generate_material_return_no() SET search_path = public;
ALTER FUNCTION public.generate_order_no() SET search_path = public;
ALTER FUNCTION public.generate_picking_no() SET search_path = public;
ALTER FUNCTION public.generate_return_order_no() SET search_path = public;
ALTER FUNCTION public.log_work_order_status_change() SET search_path = public;
ALTER FUNCTION public.merge_customers(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.recharge_member(uuid, numeric, text, text) SET search_path = public;
ALTER FUNCTION public.return_part_to_batch() SET search_path = public;
ALTER FUNCTION public.save_service_item_prices(uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.save_service_item_special_prices(uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.score_on_completion() SET search_path = public;
ALTER FUNCTION public.score_on_quality_fail() SET search_path = public;
ALTER FUNCTION public.search_knowledge_articles(text[], uuid, integer, integer) SET search_path = public;
ALTER FUNCTION public.search_knowledge_semantic(extensions.vector, uuid, integer, integer) SET search_path = public;
ALTER FUNCTION public.search_knowledge_semantic_v4(extensions.vector, text[], uuid, integer, integer) SET search_path = public;
ALTER FUNCTION public.settle_work_order(uuid, numeric, jsonb, uuid, text) SET search_path = public;
ALTER FUNCTION public.submit_item_qc(uuid, text, text, jsonb) SET search_path = public;
ALTER FUNCTION public.transition_work_order(uuid, text, text) SET search_path = public;
ALTER FUNCTION public.update_customer_star_level() SET search_path = public;
ALTER FUNCTION public.update_knowledge_article_search_vector() SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
