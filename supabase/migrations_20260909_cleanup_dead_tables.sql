/* 清理 4 张废弃表
   创建日期: 2026-09-09
   背景: 2026-09-09 垃圾体检发现 4 张表建完后功能从未开发/已废弃，
         全部 0 行数据、前端代码零引用：
         1. customer_invoices      —— "客户发票"功能从未开发（初始 schema 遗留）
         2. behavior_tasks         —— 初始 schema 遗留，现行行为考核用 behavior_check_tasks 等新表
         3. behavior_checks        —— 同上，现行用 behavior_check_records
         4. service_item_prices_backup —— 2026-05-04 迁移临时备份表，迁移文件里 DROP 被注释忘删
   安全性确认（删前已核查）:
         - 四张表的外键全是"指向别人"，没有任何其他表依赖它们
         - merge_customers 函数里对 customer_invoices 的引用带
           EXCEPTION WHEN undefined_table 兜底，删表不影响该函数
   幂等: 全部 DROP TABLE IF EXISTS，可重复执行。
*/

DROP TABLE IF EXISTS public.customer_invoices;
DROP TABLE IF EXISTS public.behavior_tasks;
DROP TABLE IF EXISTS public.behavior_checks;
DROP TABLE IF EXISTS public.service_item_prices_backup;

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260909_cleanup_dead_tables.sql', '删除4张废弃表：customer_invoices/behavior_tasks/behavior_checks/service_item_prices_backup')
ON CONFLICT (file_name) DO NOTHING;
