/* 领料单/退料单 + 库存出库修复迁移 */
/* 创建日期: 2026-07-31 */
/* 内容:
   一、part_batches 补齐缺失列(入库方式/来源单据/备注/入库时间)
   二、inventory_logs 统一为新口径(type/change_qty/reference_*)
   三、领料/退料触发器重写:同步扣总库存、负库存校验、自动写流水
   四、领料单 picking_orders / picking_order_items
   五、退料单 material_return_orders / material_return_order_items
   六、原子开单数据库函数 create_picking_order / create_material_return_order
*/

/* ============================================================
   一、part_batches 补齐缺失列
   说明: 统一口径 quantity=批次初始数量(不变), remaining=当前剩余
   ============================================================ */
ALTER TABLE part_batches
  ADD COLUMN IF NOT EXISTS inbound_type TEXT DEFAULT 'purchase',
  ADD COLUMN IF NOT EXISTS reference_id UUID,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS inbound_at TIMESTAMPTZ;

/* 历史批次的入库时间用创建时间补齐 */
UPDATE part_batches SET inbound_at = created_at WHERE inbound_at IS NULL;
ALTER TABLE part_batches ALTER COLUMN inbound_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_part_batches_part_remaining ON part_batches(part_id) WHERE remaining > 0;
CREATE INDEX IF NOT EXISTS idx_part_batches_reference ON part_batches(reference_id);

/* ============================================================
   二、inventory_logs 统一新口径
   说明: 表内无历史数据,直接改名改造
   type: inbound 入库 / outbound 领料出库 / return_in 退料回库 / return_out 退货出库 / adjust 盘点调整
   ============================================================ */
ALTER TABLE inventory_logs DROP CONSTRAINT IF EXISTS inventory_logs_change_type_check;
ALTER TABLE inventory_logs RENAME COLUMN change_type TO type;
ALTER TABLE inventory_logs RENAME COLUMN quantity TO change_qty;
ALTER TABLE inventory_logs
  ADD COLUMN IF NOT EXISTS reference_type TEXT,
  ADD COLUMN IF NOT EXISTS reference_id UUID;
ALTER TABLE inventory_logs DROP CONSTRAINT IF EXISTS inventory_logs_type_check;
ALTER TABLE inventory_logs ADD CONSTRAINT inventory_logs_type_check
  CHECK (type IN ('inbound','outbound','return_in','return_out','adjust'));

CREATE INDEX IF NOT EXISTS idx_inventory_logs_reference ON inventory_logs(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_part ON inventory_logs(part_id);

/* ============================================================
   三、领料/退料触发器重写
   说明: 旧版只扣批次剩余,总库存不动;新版同步扣减并禁止负库存
   ============================================================ */
CREATE OR REPLACE FUNCTION fn_deduct_batch_on_picking()
RETURNS TRIGGER AS $$
DECLARE
  v_part_id UUID;
  v_remaining INTEGER;
  v_after INTEGER;
  v_work_order_id UUID;
BEGIN
  /* 锁定批次行,校验剩余量 */
  SELECT part_id, remaining INTO v_part_id, v_remaining
  FROM part_batches WHERE id = NEW.batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '库存批次不存在';
  END IF;
  IF v_remaining < NEW.quantity THEN
    RAISE EXCEPTION '批次剩余库存不足:剩余 % 件,本次要领 % 件', v_remaining, NEW.quantity;
  END IF;

  /* 扣批次剩余 */
  UPDATE part_batches SET remaining = remaining - NEW.quantity WHERE id = NEW.batch_id;

  /* 扣配件总库存,不足则报错整单回滚 */
  UPDATE parts SET quantity = quantity - NEW.quantity
  WHERE id = v_part_id AND quantity >= NEW.quantity
  RETURNING quantity INTO v_after;
  IF NOT FOUND THEN
    RAISE EXCEPTION '配件总库存不足,无法出库';
  END IF;

  /* 查关联工单用于流水追溯 */
  SELECT woi.work_order_id INTO v_work_order_id
  FROM work_order_item_parts p
  JOIN work_order_items woi ON woi.id = p.work_order_item_id
  WHERE p.id = NEW.work_order_item_part_id;

  /* 写库存流水 */
  INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, notes)
  VALUES (v_part_id, 'outbound', -NEW.quantity, v_after + NEW.quantity, v_after, v_work_order_id, 'picking_record', NEW.id, '工单领料出库');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_restore_batch_on_return()
RETURNS TRIGGER AS $$
DECLARE
  v_batch_id UUID;
  v_part_id UUID;
  v_picked INTEGER;
  v_returned INTEGER;
  v_after INTEGER;
  v_work_order_id UUID;
BEGIN
  /* 校验退料数量不超过该领料记录的净领量 */
  IF NEW.picking_record_id IS NOT NULL THEN
    SELECT batch_id, quantity INTO v_batch_id, v_picked
    FROM part_picking_records WHERE id = NEW.picking_record_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '领料记录不存在';
    END IF;
    SELECT COALESCE(SUM(quantity), 0) INTO v_returned
    FROM part_return_records
    WHERE picking_record_id = NEW.picking_record_id AND id <> NEW.id;
    IF v_returned + NEW.quantity > v_picked THEN
      RAISE EXCEPTION '退料数量超出可退数量:已领 % 件,已退 % 件,本次要退 % 件', v_picked, v_returned, NEW.quantity;
    END IF;
  END IF;

  /* 加回批次剩余和总库存 */
  IF v_batch_id IS NOT NULL THEN
    UPDATE part_batches SET remaining = remaining + NEW.quantity WHERE id = v_batch_id
    RETURNING part_id INTO v_part_id;
  END IF;
  IF v_part_id IS NULL THEN
    SELECT part_id INTO v_part_id FROM work_order_item_parts WHERE id = NEW.work_order_item_part_id;
  END IF;

  IF v_part_id IS NOT NULL THEN
    UPDATE parts SET quantity = quantity + NEW.quantity WHERE id = v_part_id
    RETURNING quantity INTO v_after;

    SELECT woi.work_order_id INTO v_work_order_id
    FROM work_order_item_parts p
    JOIN work_order_items woi ON woi.id = p.work_order_item_id
    WHERE p.id = NEW.work_order_item_part_id;

    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, notes)
    VALUES (v_part_id, 'return_in', NEW.quantity, v_after - NEW.quantity, v_after, v_work_order_id, 'return_record', NEW.id, '工单退料回库');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   四、领料单
   ============================================================ */
CREATE TABLE IF NOT EXISTS picking_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_no TEXT NOT NULL,
  work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  total_quantity INTEGER NOT NULL DEFAULT 0,
  receiver_name TEXT,
  notes TEXT,
  operator_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_picking_orders_work_order ON picking_orders(work_order_id);
CREATE INDEX IF NOT EXISTS idx_picking_orders_created ON picking_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_picking_orders_no ON picking_orders(picking_no);

CREATE OR REPLACE FUNCTION generate_picking_no()
RETURNS TRIGGER AS $$
DECLARE
  seq_num INTEGER;
  today TEXT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(picking_no, '^LL-' || today || '-', ''), '')), '0')::INTEGER + 1
  INTO seq_num FROM picking_orders WHERE picking_no LIKE 'LL-' || today || '-%';
  NEW.picking_no := 'LL-' || today || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_picking_no ON picking_orders;
CREATE TRIGGER set_picking_no BEFORE INSERT ON picking_orders
  FOR EACH ROW WHEN (NEW.picking_no IS NULL) EXECUTE FUNCTION generate_picking_no();

CREATE TABLE IF NOT EXISTS picking_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_order_id UUID NOT NULL REFERENCES picking_orders(id) ON DELETE CASCADE,
  picking_record_id UUID REFERENCES part_picking_records(id) ON DELETE SET NULL,
  work_order_item_part_id UUID REFERENCES work_order_item_parts(id) ON DELETE SET NULL,
  part_id UUID REFERENCES parts(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES part_batches(id) ON DELETE SET NULL,
  part_number TEXT,
  name TEXT,
  brand TEXT,
  specification TEXT,
  unit TEXT,
  batch_no TEXT,
  unit_cost DECIMAL(10,2),
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_picking_order_items_order ON picking_order_items(picking_order_id);
CREATE INDEX IF NOT EXISTS idx_picking_order_items_part ON picking_order_items(part_id);

/* 领料记录关联领料单 */
ALTER TABLE part_picking_records
  ADD COLUMN IF NOT EXISTS picking_order_id UUID REFERENCES picking_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_part_picking_records_order ON part_picking_records(picking_order_id);

/* ============================================================
   五、退料单
   ============================================================ */
CREATE TABLE IF NOT EXISTS material_return_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no TEXT NOT NULL,
  work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  picking_order_id UUID REFERENCES picking_orders(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  total_quantity INTEGER NOT NULL DEFAULT 0,
  return_type TEXT,
  reason TEXT,
  notes TEXT,
  operator_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_return_orders_work_order ON material_return_orders(work_order_id);
CREATE INDEX IF NOT EXISTS idx_material_return_orders_created ON material_return_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_return_orders_no ON material_return_orders(return_no);

CREATE OR REPLACE FUNCTION generate_material_return_no()
RETURNS TRIGGER AS $$
DECLARE
  seq_num INTEGER;
  today TEXT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(return_no, '^TL-' || today || '-', ''), '')), '0')::INTEGER + 1
  INTO seq_num FROM material_return_orders WHERE return_no LIKE 'TL-' || today || '-%';
  NEW.return_no := 'TL-' || today || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_material_return_no ON material_return_orders;
CREATE TRIGGER set_material_return_no BEFORE INSERT ON material_return_orders
  FOR EACH ROW WHEN (NEW.return_no IS NULL) EXECUTE FUNCTION generate_material_return_no();

CREATE TABLE IF NOT EXISTS material_return_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_order_id UUID NOT NULL REFERENCES material_return_orders(id) ON DELETE CASCADE,
  return_record_id UUID REFERENCES part_return_records(id) ON DELETE SET NULL,
  picking_record_id UUID REFERENCES part_picking_records(id) ON DELETE SET NULL,
  work_order_item_part_id UUID REFERENCES work_order_item_parts(id) ON DELETE SET NULL,
  part_id UUID REFERENCES parts(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES part_batches(id) ON DELETE SET NULL,
  part_number TEXT,
  name TEXT,
  brand TEXT,
  specification TEXT,
  unit TEXT,
  batch_no TEXT,
  unit_cost DECIMAL(10,2),
  quantity INTEGER NOT NULL,
  return_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_return_order_items_order ON material_return_order_items(return_order_id);
CREATE INDEX IF NOT EXISTS idx_material_return_order_items_part ON material_return_order_items(part_id);

/* 退料记录关联退料单 */
ALTER TABLE part_return_records
  ADD COLUMN IF NOT EXISTS material_return_order_id UUID REFERENCES material_return_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_part_return_records_order ON part_return_records(material_return_order_id);

/* ============================================================
   六、原子开单函数(一个事务完成:建单+扣库存+写明细)
   ============================================================ */
CREATE OR REPLACE FUNCTION create_picking_order(
  p_work_order_id UUID,
  p_items JSONB,
  p_receiver_name TEXT,
  p_notes TEXT,
  p_operator_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_order_id UUID;
  v_picking_no TEXT;
  v_item JSONB;
  v_record_id UUID;
  v_total INTEGER := 0;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '领料明细不能为空');
  END IF;

  /* 未传工单时从第一条明细的配件分支反查工单 */
  IF p_work_order_id IS NULL THEN
    SELECT woi.work_order_id INTO p_work_order_id
    FROM work_order_item_parts p
    JOIN work_order_items woi ON woi.id = p.work_order_item_id
    WHERE p.id = (p_items->0->>'work_order_item_part_id')::UUID;
  END IF;

  /* 1. 建领料单主表(单号由触发器生成) */
  INSERT INTO picking_orders (work_order_id, receiver_name, notes, operator_id)
  VALUES (p_work_order_id, NULLIF(TRIM(COALESCE(p_receiver_name, '')), ''), NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_operator_id)
  RETURNING id, picking_no INTO v_order_id, v_picking_no;

  /* 2. 逐条插领料记录(触发器扣库存,不足则整体回滚) */
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO part_picking_records (work_order_item_part_id, batch_id, quantity, picked_by, picking_order_id)
    VALUES (
      (v_item->>'work_order_item_part_id')::UUID,
      (v_item->>'batch_id')::UUID,
      (v_item->>'quantity')::INTEGER,
      p_operator_id,
      v_order_id
    )
    RETURNING id INTO v_record_id;

    INSERT INTO picking_order_items (
      picking_order_id, picking_record_id, work_order_item_part_id, part_id, batch_id,
      part_number, name, brand, specification, unit, batch_no, unit_cost, quantity
    ) VALUES (
      v_order_id, v_record_id,
      (v_item->>'work_order_item_part_id')::UUID,
      NULLIF(v_item->>'part_id', '')::UUID,
      (v_item->>'batch_id')::UUID,
      v_item->>'part_number', v_item->>'name', v_item->>'brand',
      v_item->>'specification', v_item->>'unit', v_item->>'batch_no',
      NULLIF(v_item->>'unit_cost', '')::DECIMAL,
      (v_item->>'quantity')::INTEGER
    );

    v_total := v_total + (v_item->>'quantity')::INTEGER;
  END LOOP;

  UPDATE picking_orders SET total_quantity = v_total WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'picking_order_id', v_order_id, 'picking_no', v_picking_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_material_return_order(
  p_work_order_id UUID,
  p_picking_order_id UUID,
  p_items JSONB,
  p_return_type TEXT,
  p_reason TEXT,
  p_notes TEXT,
  p_operator_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_order_id UUID;
  v_return_no TEXT;
  v_item JSONB;
  v_record_id UUID;
  v_total INTEGER := 0;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '退料明细不能为空');
  END IF;

  /* 未传工单时从第一条明细的配件分支反查工单 */
  IF p_work_order_id IS NULL THEN
    SELECT woi.work_order_id INTO p_work_order_id
    FROM work_order_item_parts p
    JOIN work_order_items woi ON woi.id = p.work_order_item_id
    WHERE p.id = (p_items->0->>'work_order_item_part_id')::UUID;
  END IF;

  INSERT INTO material_return_orders (work_order_id, picking_order_id, return_type, reason, notes, operator_id)
  VALUES (
    p_work_order_id, p_picking_order_id,
    NULLIF(TRIM(COALESCE(p_return_type, '')), ''),
    NULLIF(TRIM(COALESCE(p_reason, '')), ''),
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    p_operator_id
  )
  RETURNING id, return_no INTO v_order_id, v_return_no;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    /* 触发器会校验可退数量并把库存加回 */
    INSERT INTO part_return_records (work_order_item_part_id, picking_record_id, return_type, quantity, returned_by, notes, material_return_order_id)
    VALUES (
      (v_item->>'work_order_item_part_id')::UUID,
      (v_item->>'picking_record_id')::UUID,
      COALESCE(NULLIF(TRIM(COALESCE(p_return_type, '')), ''), v_item->>'return_type'),
      (v_item->>'quantity')::INTEGER,
      p_operator_id,
      NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      v_order_id
    )
    RETURNING id INTO v_record_id;

    INSERT INTO material_return_order_items (
      return_order_id, return_record_id, picking_record_id, work_order_item_part_id, part_id, batch_id,
      part_number, name, brand, specification, unit, batch_no, unit_cost, quantity, return_type
    ) VALUES (
      v_order_id, v_record_id,
      (v_item->>'picking_record_id')::UUID,
      (v_item->>'work_order_item_part_id')::UUID,
      NULLIF(v_item->>'part_id', '')::UUID,
      NULLIF(v_item->>'batch_id', '')::UUID,
      v_item->>'part_number', v_item->>'name', v_item->>'brand',
      v_item->>'specification', v_item->>'unit', v_item->>'batch_no',
      NULLIF(v_item->>'unit_cost', '')::DECIMAL,
      (v_item->>'quantity')::INTEGER,
      COALESCE(NULLIF(TRIM(COALESCE(p_return_type, '')), ''), v_item->>'return_type')
    );

    v_total := v_total + (v_item->>'quantity')::INTEGER;
  END LOOP;

  UPDATE material_return_orders SET total_quantity = v_total WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'return_order_id', v_order_id, 'return_no', v_return_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   七、RLS 策略(与入库单一致:登录用户可读,登录用户可写)
   ============================================================ */
ALTER TABLE picking_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE picking_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_return_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_return_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY picking_orders_auth_all ON picking_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY picking_order_items_auth_all ON picking_order_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY material_return_orders_auth_all ON material_return_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY material_return_order_items_auth_all ON material_return_order_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
