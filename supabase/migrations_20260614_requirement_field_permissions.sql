/*
 * 客户需求字段级权限控制
 * 为 work_order_requirements 表增加 diagnosis 和 remarks 的提交人字段，
 * 用于记录最后一次填写人，并控制修改权限。
 */

ALTER TABLE work_order_requirements
ADD COLUMN IF NOT EXISTS diagnosis_submitter_id UUID REFERENCES profiles(id);

ALTER TABLE work_order_requirements
ADD COLUMN IF NOT EXISTS remarks_submitter_id UUID REFERENCES profiles(id);
