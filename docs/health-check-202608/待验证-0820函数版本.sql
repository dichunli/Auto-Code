/* ============================================================
   系统体检配套验证 SQL（2026-08-21）—— 全部只读，放心执行
   ------------------------------------------------------------
   背景：8月20日 有 3 个升级文件里定义了同名函数（到货确认/入库），
   版本一个比一个新。如果当时按文件名顺序执行（而不是按开发时间顺序），
   数据库里生效的会是"中间版"，悄悄丢掉最新功能：
     - 补录采购单外货品时"按档案价兜底入库价"（丢了→补录件入库价变 0）
   本脚本验证数据库里当前生效的到底是哪个版本。

   使用方法：
     1. 打开 Supabase 后台 → 左边菜单 SQL Editor → New query
     2. 把本文件全部内容粘贴进去 → 点 Run
     3. 把结果（右下角 Results）截图或复制发给我

   结果怎么看：
     - 验证1/2/3：返回的列全是 true → ✅ 没事，是最新版
     - 有任何 false → ❌ 那个函数是旧版，我来帮你重跑最新版修复
     - 验证4：返回 2 行 → ✅ 考核照片升级已执行；0 行 → 需要补执行
   ============================================================ */

/* 【验证1】到货确认函数 confirm_arrival_receipt —— 期望两个都 true */
SELECT
  pg_get_functiondef('confirm_arrival_receipt(uuid)'::regprocedure) LIKE '%代收货款勾稽%' AS 有结算功能,
  pg_get_functiondef('confirm_arrival_receipt(uuid)'::regprocedure) LIKE '%purchase_price FROM parts%' AS 有档案价兜底;

/* 【验证2】到货入库函数 complete_arrival_inbound —— 期望两个都 true */
SELECT
  pg_get_functiondef('complete_arrival_inbound(uuid,numeric,uuid)'::regprocedure) LIKE '%v_goods_amount%' AS 有货款口径,
  pg_get_functiondef('complete_arrival_inbound(uuid,numeric,uuid)'::regprocedure) LIKE '%purchase_price FROM parts%' AS 有档案价兜底;

/* 【验证3】采购入库函数 complete_purchase_inbound —— 期望两个都 true */
SELECT
  pg_get_functiondef('complete_purchase_inbound(uuid,jsonb,numeric,uuid)'::regprocedure) LIKE '%防双流程%' AS 有防双流程,
  pg_get_functiondef('complete_purchase_inbound(uuid,jsonb,numeric,uuid)'::regprocedure) LIKE '%v_goods_amount%' AS 有货款口径;

/* 【验证4】0816 考核照片自检计分迁移是否已执行 —— 期望返回 2 行 */
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name='behavior_score_items' AND column_name='guide_images')
   OR (table_name='behavior_check_records' AND column_name='review_score_record_id');
