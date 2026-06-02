/* 修复 service_item_prices 表 vehicle_model_id 列类型 */
/* vehicle_models.id 是 INTEGER，但关联表中该字段仍被定义为 UUID */

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'service_item_prices'
    AND column_name = 'vehicle_model_id'
    AND data_type = 'uuid'
  ) THEN
    /* 删除外键约束（如果存在） */
    ALTER TABLE service_item_prices DROP CONSTRAINT IF EXISTS service_item_prices_vehicle_model_id_fkey;

    /* 修改列类型为 INTEGER */
    ALTER TABLE service_item_prices ALTER COLUMN vehicle_model_id TYPE INTEGER USING (vehicle_model_id::text::integer);

    /* 重新添加外键约束 */
    ALTER TABLE service_item_prices ADD CONSTRAINT service_item_prices_vehicle_model_id_fkey
      FOREIGN KEY (vehicle_model_id) REFERENCES vehicle_models(id) ON DELETE CASCADE;
  END IF;
END $$;
