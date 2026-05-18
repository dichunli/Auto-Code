/*
  采购流程 V2 升级 — 待收货统一收货弹窗 + 5 大处理分支
  日期: 2026-05-17
  目的:
    将原来的"确认到货 / 未到货 / 退货"三个按钮 + 多个子弹窗,
    合并为一个统一的"收货"弹窗,系统根据输入数量自动识别
    正常 / 多发 / 少发,同时支持反馈"破损" / "错发"。

  新增字段说明:
*/

/*
  1. purchase_order_items.handle_action — 收货处理方式标签
     取值与含义:
       normal          正常到货 → 待入库
       broken_exchange 破损换货  → 待入库 + 待退货(破损) + 待采购(破损补发)
       broken_discount 破损折价  → 待入库,按 discount_amount 折扣
       broken_discard  破损弃货  → 待入库 + 待退货(破损)
       wrong_exchange  错发换货  → 待入库 + 待退货(错发) + 待采购(错发换货)
       wrong_discard   错发弃货  → 待退货(错发),不入库
       excess_return   多发退货  → 订购数入库 + 多出部分待退货(多发)
       excess_paid     多发备用,对供应商付款 → 订购数入库 + 多出部分待入库(原价)
       excess_free     多发备用,不付款       → 订购数入库 + 多出部分待入库(零价)
       short_repurchase 少发补货 → 实际数入库 + 少发数待采购
       short_discard    少发弃货 → 实际数入库 + 凭证截图
*/
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS handle_action TEXT;

/*
  2. purchase_order_items.discount_amount — 破损折价金额(总额折扣)
     仅 handle_action='broken_discount' 时使用,
     用于在采购单总额上扣减,不修改 unit_cost(保留原价用于追溯)。
*/
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2);

/*
  3. purchase_order_items.evidence_photos — 凭证截图
     聊天截图 / 破损照片等,JSON 数组存储路径,
     主要用在 broken_discount(折价证明)和 short_discard(少发凭证)场景。
*/
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS evidence_photos JSONB DEFAULT '[]'::jsonb;

/*
  4. work_order_item_parts.purchase_reason — 配件需求来源标签
     当从待收货流程中自动生成新的待采购需求时,标记其来源原因。
     取值:
       broken_resupply 破损补发(原配件破损,需要重新采购同款)
       wrong_exchange  错发换货(供应商发错型号,需要重新采购正确型号)
       short_resupply  少发补货(供应商少发了一部分,需要补齐)
     NULL 表示这是来自工单正常的配件需求,无特殊来源。
*/
ALTER TABLE work_order_item_parts
  ADD COLUMN IF NOT EXISTS purchase_reason TEXT;

/*
  待入库自动流转规则:
    收货弹窗一旦给所有明细都打上 handle_action 后,
    系统将采购单状态置为 'pending_storage',
    用户在「待入库」中点"提交入库",根据各明细 handle_action 自动:
      - 写入库存(broken_exchange / broken_discount / broken_discard / excess_*  / short_*)
      - 创建 supplier_return_records(wrong_discard / broken_exchange / broken_discard / excess_return)
      - 创建新的 work_order_item_parts(broken_exchange / wrong_exchange / short_repurchase)
    最终状态变为 'completed'。
*/
