/* profiles 表增加身份证正反面照片字段
   背景：员工档案需要保存身份证号（id_card 已存在）和正反面照片
   新增：
     - id_card_front_url  身份证正面照片 URL
     - id_card_back_url   身份证反面照片 URL
   照片本身上传到 work-order-media bucket，这里只保存 publicUrl */

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS id_card_front_url TEXT,
  ADD COLUMN IF NOT EXISTS id_card_back_url TEXT;
