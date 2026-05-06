-- 修复 vehicle_model_id 列类型不匹配的问题
-- vehicle_models.id 是 INTEGER，但关联表中的 vehicle_model_id 被错误地定义为 UUID

-- 1. 修复 part_vehicle_models 表
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'part_vehicle_models'
    AND column_name = 'vehicle_model_id'
    AND data_type = 'uuid'
  ) THEN
    -- 删除外键约束（如果存在）
    ALTER TABLE part_vehicle_models DROP CONSTRAINT IF EXISTS part_vehicle_models_vehicle_model_id_fkey;

    -- 修改列类型为 INTEGER
    ALTER TABLE part_vehicle_models ALTER COLUMN vehicle_model_id TYPE INTEGER USING (vehicle_model_id::text::integer);

    -- 重新添加外键约束
    ALTER TABLE part_vehicle_models ADD CONSTRAINT part_vehicle_models_vehicle_model_id_fkey
      FOREIGN KEY (vehicle_model_id) REFERENCES vehicle_models(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. 修复 part_vehicle_prices 表
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'part_vehicle_prices'
    AND column_name = 'vehicle_model_id'
    AND data_type = 'uuid'
  ) THEN
    ALTER TABLE part_vehicle_prices DROP CONSTRAINT IF EXISTS part_vehicle_prices_vehicle_model_id_fkey;
    ALTER TABLE part_vehicle_prices ALTER COLUMN vehicle_model_id TYPE INTEGER USING (vehicle_model_id::text::integer);
    ALTER TABLE part_vehicle_prices ADD CONSTRAINT part_vehicle_prices_vehicle_model_id_fkey
      FOREIGN KEY (vehicle_model_id) REFERENCES vehicle_models(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. 修复 vehicles 表
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles'
    AND column_name = 'vehicle_model_id'
    AND data_type = 'uuid'
  ) THEN
    ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_vehicle_model_id_fkey;
    ALTER TABLE vehicles ALTER COLUMN vehicle_model_id TYPE INTEGER USING (vehicle_model_id::text::integer);
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_vehicle_model_id_fkey
      FOREIGN KEY (vehicle_model_id) REFERENCES vehicle_models(id);
  END IF;
END $$;
