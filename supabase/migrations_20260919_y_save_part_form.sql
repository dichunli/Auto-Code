/* ============================================================
 * 配件新建/编辑表单一个事务（2026-09-19，严谨性整改阶段二 · 任务13）
 *
 * 问题（诊断实锤，阶段二最大隐患）：
 *   submitPart.ts 客户端顺序执行 更新配件 → 删 5 张关联表 → 逐表插入，
 *   中途失败留半账；且编辑保存会把 parts.quantity 用"表单仓位行之和"
 *   直接覆盖——期间任何领料/入库都被静默抹掉，无任何流水。
 *
 * 新函数 save_part_form（全部参数 JSONB，一个事务要么全成要么全败）：
 *   新建：建档案（库存 0 起）→ 仓位行 → 合计>0 建一个期初批次+流水
 *         （批次必建，期初可领；批次成本取表单参考进价）
 *   编辑：档案更新【不含 quantity】；仓位行按【差额】调整——
 *         表单行 vs 现有行逐仓对比，多了加、少了减、删了清，
 *         每笔差额写 adjust 流水（before/after 记仓位数量），
 *         总库存按净差额原子增减（并发领料不会再被覆盖）；
 *         调整后总库存若会变负 → 整单报错回滚
 *   关联表（规格/车型/图片/指定价/车型价）同事务删旧插新，不留半账
 *
 * 权限：admin/boss/warehouse（与 parts 表 INSERT 策略同口径）。
 * 幂等：新函数 CREATE OR REPLACE，可重跑。
 * ============================================================ */

CREATE OR REPLACE FUNCTION public.save_part_form(
  p_part_id UUID,
  p_part JSONB,
  p_specs JSONB,
  p_vehicle_models JSONB,
  p_images JSONB,
  p_stock_locations JSONB,
  p_special_prices JSONB,
  p_vehicle_prices JSONB
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_new BOOLEAN := p_part_id IS NULL;
  v_part_id UUID;
  v_system_code TEXT;
  v_prefix TEXT;
  v_seq INTEGER;
  v_loc JSONB;
  v_warehouse_id UUID;
  v_loc_name TEXT;
  v_new_qty INTEGER;
  v_old_qty INTEGER;
  v_opening_total INTEGER := 0;
  v_total_delta INTEGER := 0;
  v_batch_id UUID;
  v_del_row RECORD;
  v_opening_cost DECIMAL(10,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可保存配件');
  END IF;
  IF p_part IS NULL OR NULLIF(TRIM(COALESCE(p_part->>'name', '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '配件名称不能为空');
  END IF;
  IF NULLIF(TRIM(COALESCE(p_part->>'part_number', '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '配件编码不能为空');
  END IF;

  /* ═══ 一、配件档案 ═══ */
  IF v_is_new THEN
    /* 系统编码：未传或撞号时生成 PJyyyymmddNNN */
    v_system_code := NULLIF(TRIM(COALESCE(p_part->>'system_code', '')), '');
    IF v_system_code IS NULL OR EXISTS (SELECT 1 FROM parts WHERE system_code = v_system_code) THEN
      v_prefix := 'PJ' || TO_CHAR(NOW(), 'YYYYMMDD');
      SELECT COALESCE(MAX(CAST(SUBSTRING(system_code FROM LENGTH(v_prefix) + 1) AS INTEGER)), 0) + 1
      INTO v_seq
      FROM parts
      WHERE system_code LIKE v_prefix || '%'
        AND SUBSTRING(system_code FROM LENGTH(v_prefix) + 1) ~ '^\d+$';
      v_system_code := v_prefix || LPAD(v_seq::TEXT, 3, '0');
    END IF;

    INSERT INTO parts (
      system_code, part_number, barcode, interchange_code, oe_number, vin17_group_id,
      document_name, part_name_id, name, brand_id, category_id, unit, quantity, min_stock,
      purchase_price, reference_purchase_price, unit_price, standard_price, vip_price, wholesale_price,
      supplier_id, notes, auto_link_vehicle_model, auto_match_17vin_models, is_consumable,
      require_scan_check, require_location_check, require_confirm,
      sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value,
      repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value,
      picking_commission_type, picking_commission_value
    ) VALUES (
      v_system_code,
      UPPER(TRIM(p_part->>'part_number')),
      NULLIF(TRIM(COALESCE(p_part->>'barcode', '')), ''),
      UPPER(TRIM(COALESCE(p_part->>'interchange_code', ''))) ,
      UPPER(TRIM(COALESCE(p_part->>'oe_number', ''))),
      NULLIF(TRIM(COALESCE(p_part->>'vin17_group_id', '')), ''),
      NULLIF(TRIM(COALESCE(p_part->>'document_name', '')), ''),
      (p_part->>'part_name_id')::UUID,
      TRIM(p_part->>'name'),
      NULLIF(TRIM(COALESCE(p_part->>'brand_id', '')), '')::UUID,
      NULLIF(TRIM(COALESCE(p_part->>'category_id', '')), '')::UUID,
      COALESCE(NULLIF(TRIM(p_part->>'unit'), ''), '件'),
      0, /* 库存从 0 起，期初走批次化（见第三步） */
      COALESCE((p_part->>'min_stock')::INTEGER, 10),
      NULLIF(TRIM(COALESCE(p_part->>'purchase_price', '')), '')::DECIMAL,
      NULLIF(TRIM(COALESCE(p_part->>'reference_purchase_price', '')), '')::DECIMAL,
      NULLIF(TRIM(COALESCE(p_part->>'unit_price', '')), '')::DECIMAL,
      NULLIF(TRIM(COALESCE(p_part->>'standard_price', '')), '')::DECIMAL,
      NULLIF(TRIM(COALESCE(p_part->>'vip_price', '')), '')::DECIMAL,
      NULLIF(TRIM(COALESCE(p_part->>'wholesale_price', '')), '')::DECIMAL,
      NULLIF(TRIM(COALESCE(p_part->>'supplier_id', '')), '')::UUID,
      NULLIF(TRIM(COALESCE(p_part->>'notes', '')), ''),
      COALESCE((p_part->>'auto_link_vehicle_model')::BOOLEAN, false),
      COALESCE((p_part->>'auto_match_17vin_models')::BOOLEAN, false),
      COALESCE((p_part->>'is_consumable')::BOOLEAN, false),
      COALESCE((p_part->>'require_scan_check')::BOOLEAN, false),
      COALESCE((p_part->>'require_location_check')::BOOLEAN, false),
      COALESCE((p_part->>'require_confirm')::BOOLEAN, false),
      NULLIF(TRIM(COALESCE(p_part->>'sales_commission_type', '')), ''),
      NULLIF(TRIM(COALESCE(p_part->>'sales_commission_value', '')), '')::NUMERIC,
      NULLIF(TRIM(COALESCE(p_part->>'diagnosis_commission_type', '')), ''),
      NULLIF(TRIM(COALESCE(p_part->>'diagnosis_commission_value', '')), '')::NUMERIC,
      NULLIF(TRIM(COALESCE(p_part->>'repair_commission_type', '')), ''),
      NULLIF(TRIM(COALESCE(p_part->>'repair_commission_value', '')), '')::NUMERIC,
      NULLIF(TRIM(COALESCE(p_part->>'qc_commission_type', '')), ''),
      NULLIF(TRIM(COALESCE(p_part->>'qc_commission_value', '')), '')::NUMERIC,
      NULLIF(TRIM(COALESCE(p_part->>'picking_commission_type', '')), ''),
      NULLIF(TRIM(COALESCE(p_part->>'picking_commission_value', '')), '')::NUMERIC
    )
    RETURNING id INTO v_part_id;
  ELSE
    /* 编辑：锁配件（后续仓位差额调整全程持锁，并发领料排队） */
    PERFORM 1 FROM parts WHERE id = p_part_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '配件不存在');
    END IF;
    v_part_id := p_part_id;

    /* 档案更新：绝不包含 quantity / system_code */
    UPDATE parts SET
      part_number = UPPER(TRIM(p_part->>'part_number')),
      barcode = NULLIF(TRIM(COALESCE(p_part->>'barcode', '')), ''),
      interchange_code = UPPER(TRIM(COALESCE(p_part->>'interchange_code', ''))),
      oe_number = UPPER(TRIM(COALESCE(p_part->>'oe_number', ''))),
      vin17_group_id = NULLIF(TRIM(COALESCE(p_part->>'vin17_group_id', '')), ''),
      document_name = NULLIF(TRIM(COALESCE(p_part->>'document_name', '')), ''),
      part_name_id = (p_part->>'part_name_id')::UUID,
      name = TRIM(p_part->>'name'),
      brand_id = NULLIF(TRIM(COALESCE(p_part->>'brand_id', '')), '')::UUID,
      category_id = NULLIF(TRIM(COALESCE(p_part->>'category_id', '')), '')::UUID,
      unit = COALESCE(NULLIF(TRIM(p_part->>'unit'), ''), '件'),
      min_stock = COALESCE((p_part->>'min_stock')::INTEGER, 10),
      purchase_price = NULLIF(TRIM(COALESCE(p_part->>'purchase_price', '')), '')::DECIMAL,
      reference_purchase_price = NULLIF(TRIM(COALESCE(p_part->>'reference_purchase_price', '')), '')::DECIMAL,
      unit_price = NULLIF(TRIM(COALESCE(p_part->>'unit_price', '')), '')::DECIMAL,
      standard_price = NULLIF(TRIM(COALESCE(p_part->>'standard_price', '')), '')::DECIMAL,
      vip_price = NULLIF(TRIM(COALESCE(p_part->>'vip_price', '')), '')::DECIMAL,
      wholesale_price = NULLIF(TRIM(COALESCE(p_part->>'wholesale_price', '')), '')::DECIMAL,
      supplier_id = NULLIF(TRIM(COALESCE(p_part->>'supplier_id', '')), '')::UUID,
      notes = NULLIF(TRIM(COALESCE(p_part->>'notes', '')), ''),
      auto_link_vehicle_model = COALESCE((p_part->>'auto_link_vehicle_model')::BOOLEAN, false),
      auto_match_17vin_models = COALESCE((p_part->>'auto_match_17vin_models')::BOOLEAN, false),
      is_consumable = COALESCE((p_part->>'is_consumable')::BOOLEAN, false),
      require_scan_check = COALESCE((p_part->>'require_scan_check')::BOOLEAN, false),
      require_location_check = COALESCE((p_part->>'require_location_check')::BOOLEAN, false),
      require_confirm = COALESCE((p_part->>'require_confirm')::BOOLEAN, false),
      sales_commission_type = NULLIF(TRIM(COALESCE(p_part->>'sales_commission_type', '')), ''),
      sales_commission_value = NULLIF(TRIM(COALESCE(p_part->>'sales_commission_value', '')), '')::NUMERIC,
      diagnosis_commission_type = NULLIF(TRIM(COALESCE(p_part->>'diagnosis_commission_type', '')), ''),
      diagnosis_commission_value = NULLIF(TRIM(COALESCE(p_part->>'diagnosis_commission_value', '')), '')::NUMERIC,
      repair_commission_type = NULLIF(TRIM(COALESCE(p_part->>'repair_commission_type', '')), ''),
      repair_commission_value = NULLIF(TRIM(COALESCE(p_part->>'repair_commission_value', '')), '')::NUMERIC,
      qc_commission_type = NULLIF(TRIM(COALESCE(p_part->>'qc_commission_type', '')), ''),
      qc_commission_value = NULLIF(TRIM(COALESCE(p_part->>'qc_commission_value', '')), '')::NUMERIC,
      picking_commission_type = NULLIF(TRIM(COALESCE(p_part->>'picking_commission_type', '')), ''),
      picking_commission_value = NULLIF(TRIM(COALESCE(p_part->>'picking_commission_value', '')), '')::NUMERIC,
      updated_at = NOW()
    WHERE id = v_part_id;

    /* 关联表同事务删旧（插新在第二步），不再有"删了没插上"的半账窗口 */
    DELETE FROM parts_specifications WHERE part_id = v_part_id;
    DELETE FROM part_vehicle_models WHERE part_id = v_part_id;
    DELETE FROM part_images WHERE part_id = v_part_id;
    DELETE FROM part_special_prices WHERE part_id = v_part_id;
    DELETE FROM part_vehicle_prices WHERE part_id = v_part_id;
  END IF;

  /* ═══ 二、关联表插入（新建/编辑共用） ═══ */
  IF COALESCE(jsonb_array_length(p_specs), 0) > 0 THEN
    INSERT INTO parts_specifications (part_id, specification_id)
    SELECT v_part_id, value::UUID FROM jsonb_array_elements_text(p_specs);
  END IF;

  IF COALESCE(jsonb_array_length(p_vehicle_models), 0) > 0 THEN
    INSERT INTO part_vehicle_models (part_id, vehicle_model_id, notes, fitment_position, source)
    SELECT v_part_id,
           (m->>'vehicle_model_id')::INTEGER,
           NULLIF(TRIM(COALESCE(m->>'notes', '')), ''),
           NULLIF(TRIM(COALESCE(m->>'fitment_position', '')), ''),
           COALESCE(NULLIF(TRIM(m->>'source'), ''), 'manual')
    FROM jsonb_array_elements(p_vehicle_models) m;
  END IF;

  IF COALESCE(jsonb_array_length(p_images), 0) > 0 THEN
    INSERT INTO part_images (part_id, storage_path, sort_order)
    SELECT v_part_id, value, ord - 1
    FROM jsonb_array_elements_text(p_images) WITH ORDINALITY t(value, ord);
  END IF;

  IF COALESCE(jsonb_array_length(p_special_prices), 0) > 0 THEN
    INSERT INTO part_special_prices (part_id, company_id, customer_id, vehicle_id, price)
    SELECT v_part_id,
           NULLIF(TRIM(COALESCE(s->>'company_id', '')), '')::UUID,
           NULLIF(TRIM(COALESCE(s->>'customer_id', '')), '')::UUID,
           NULLIF(TRIM(COALESCE(s->>'vehicle_id', '')), '')::UUID,
           (s->>'price')::NUMERIC
    FROM jsonb_array_elements(p_special_prices) s;
  END IF;

  IF COALESCE(jsonb_array_length(p_vehicle_prices), 0) > 0 THEN
    INSERT INTO part_vehicle_prices (part_id, vehicle_model_id, sales_price, vip_price, standard_price)
    SELECT v_part_id,
           (s->>'vehicle_model_id')::INTEGER,
           NULLIF(TRIM(COALESCE(s->>'sales_price', '')), '')::NUMERIC,
           NULLIF(TRIM(COALESCE(s->>'vip_price', '')), '')::NUMERIC,
           NULLIF(TRIM(COALESCE(s->>'standard_price', '')), '')::NUMERIC
    FROM jsonb_array_elements(p_vehicle_prices) s;
  END IF;

  /* ═══ 三、仓位与库存 ═══ */
  IF v_is_new THEN
    /* 新建：直接写仓位行；合计>0 建一个期初批次（批次必建，期初可领） */
    FOR v_loc IN SELECT * FROM jsonb_array_elements(COALESCE(p_stock_locations, '[]'::jsonb))
    LOOP
      v_warehouse_id := NULL;
      IF NULLIF(TRIM(COALESCE(v_loc->>'warehouse_name', '')), '') IS NOT NULL THEN
        SELECT id INTO v_warehouse_id FROM warehouses
        WHERE name = TRIM(v_loc->>'warehouse_name') LIMIT 1;
        IF v_warehouse_id IS NULL THEN
          INSERT INTO warehouses (name) VALUES (TRIM(v_loc->>'warehouse_name'))
          RETURNING id INTO v_warehouse_id;
        END IF;
      END IF;
      v_loc_name := COALESCE(NULLIF(TRIM(COALESCE(v_loc->>'location', '')), ''), '');
      v_new_qty := COALESCE((v_loc->>'quantity')::INTEGER, 0);

      INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity, min_stock, max_stock)
      VALUES (v_part_id, v_warehouse_id, NULLIF(v_loc_name, ''), v_new_qty,
              COALESCE((v_loc->>'min_stock')::INTEGER, 0),
              NULLIF(TRIM(COALESCE(v_loc->>'max_stock', '')), '')::INTEGER);

      v_opening_total := v_opening_total + v_new_qty;
    END LOOP;

    IF v_opening_total > 0 THEN
      UPDATE parts SET quantity = v_opening_total WHERE id = v_part_id;

      v_opening_cost := COALESCE(NULLIF(TRIM(COALESCE(p_part->>'purchase_price', '')), '')::DECIMAL, 0);
      INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost, inbound_type)
      VALUES (v_part_id, '期初-' || TO_CHAR(NOW(), 'YYYYMMDD'), v_opening_total, v_opening_total, v_opening_cost, 'opening')
      RETURNING id INTO v_batch_id;

      INSERT INTO inventory_logs (
        part_id, type, change_qty, before_qty, after_qty,
        reference_type, reference_id, operator_id, batch_id, unit_cost, notes
      ) VALUES (
        v_part_id, 'inbound', v_opening_total, 0, v_opening_total,
        'opening_stock', v_batch_id, auth.uid(), v_batch_id, v_opening_cost,
        '新建配件期初库存'
      );
    END IF;
  ELSE
    /* 编辑：按差额调整（绝不覆盖）。
       1) 表单里的行：upsert + 差额记流水 */
    FOR v_loc IN SELECT * FROM jsonb_array_elements(COALESCE(p_stock_locations, '[]'::jsonb))
    LOOP
      v_warehouse_id := NULL;
      IF NULLIF(TRIM(COALESCE(v_loc->>'warehouse_name', '')), '') IS NOT NULL THEN
        SELECT id INTO v_warehouse_id FROM warehouses
        WHERE name = TRIM(v_loc->>'warehouse_name') LIMIT 1;
        IF v_warehouse_id IS NULL THEN
          INSERT INTO warehouses (name) VALUES (TRIM(v_loc->>'warehouse_name'))
          RETURNING id INTO v_warehouse_id;
        END IF;
      END IF;
      v_loc_name := COALESCE(NULLIF(TRIM(COALESCE(v_loc->>'location', '')), ''), '');
      v_new_qty := COALESCE((v_loc->>'quantity')::INTEGER, 0);

      SELECT quantity INTO v_old_qty FROM part_stock_locations
      WHERE part_id = v_part_id
        AND ((warehouse_id IS NULL AND v_warehouse_id IS NULL) OR warehouse_id = v_warehouse_id)
        AND COALESCE(location, '') = v_loc_name
      FOR UPDATE;

      IF FOUND THEN
        UPDATE part_stock_locations
        SET quantity = v_new_qty,
            min_stock = COALESCE((v_loc->>'min_stock')::INTEGER, 0),
            max_stock = NULLIF(TRIM(COALESCE(v_loc->>'max_stock', '')), '')::INTEGER
        WHERE part_id = v_part_id
          AND ((warehouse_id IS NULL AND v_warehouse_id IS NULL) OR warehouse_id = v_warehouse_id)
          AND COALESCE(location, '') = v_loc_name;
        IF v_old_qty IS DISTINCT FROM v_new_qty THEN
          v_total_delta := v_total_delta + (v_new_qty - v_old_qty);
          INSERT INTO inventory_logs (
            part_id, type, change_qty, before_qty, after_qty,
            reference_type, reference_id, operator_id, warehouse_id, location, notes
          ) VALUES (
            v_part_id, 'adjust', v_new_qty - v_old_qty, v_old_qty, v_new_qty,
            'part_edit_adjust', v_part_id, auth.uid(), v_warehouse_id, NULLIF(v_loc_name, ''),
            '编辑配件仓位调整'
          );
        END IF;
      ELSE
        INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity, min_stock, max_stock)
        VALUES (v_part_id, v_warehouse_id, NULLIF(v_loc_name, ''), v_new_qty,
                COALESCE((v_loc->>'min_stock')::INTEGER, 0),
                NULLIF(TRIM(COALESCE(v_loc->>'max_stock', '')), '')::INTEGER);
        IF v_new_qty > 0 THEN
          v_total_delta := v_total_delta + v_new_qty;
          INSERT INTO inventory_logs (
            part_id, type, change_qty, before_qty, after_qty,
            reference_type, reference_id, operator_id, warehouse_id, location, notes
          ) VALUES (
            v_part_id, 'adjust', v_new_qty, 0, v_new_qty,
            'part_edit_adjust', v_part_id, auth.uid(), v_warehouse_id, NULLIF(v_loc_name, ''),
            '编辑配件新增仓位'
          );
        END IF;
      END IF;
    END LOOP;

    /* 2) 库里存在但表单里删掉的仓位行：清零记流水并删除 */
    FOR v_del_row IN
      SELECT psl.id, psl.warehouse_id, psl.location, psl.quantity, w.name AS warehouse_name
      FROM part_stock_locations psl
      LEFT JOIN warehouses w ON w.id = psl.warehouse_id
      WHERE psl.part_id = v_part_id
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(p_stock_locations, '[]'::jsonb)) e
          WHERE COALESCE(NULLIF(TRIM(COALESCE(e->>'warehouse_name', '')), ''), '')
              = COALESCE(w.name, '')
            AND COALESCE(NULLIF(TRIM(COALESCE(e->>'location', '')), ''), '')
              = COALESCE(psl.location, '')
        )
    LOOP
      IF v_del_row.quantity <> 0 THEN
        v_total_delta := v_total_delta - v_del_row.quantity;
        INSERT INTO inventory_logs (
          part_id, type, change_qty, before_qty, after_qty,
          reference_type, reference_id, operator_id, warehouse_id, location, notes
        ) VALUES (
          v_part_id, 'adjust', -v_del_row.quantity, v_del_row.quantity, 0,
          'part_edit_adjust', v_part_id, auth.uid(), v_del_row.warehouse_id, v_del_row.location,
          '编辑配件删除仓位清零'
        );
      END IF;
      DELETE FROM part_stock_locations WHERE id = v_del_row.id;
    END LOOP;

    /* 3) 总库存按净差额原子增减（并发领料不再被表单覆盖；变负整单回滚） */
    IF v_total_delta <> 0 THEN
      UPDATE parts SET quantity = quantity + v_total_delta
      WHERE id = v_part_id AND quantity + v_total_delta >= 0;
      IF NOT FOUND THEN
        RAISE EXCEPTION '按差额调整后总库存将为负（当前库存已被其他出入库占用），请核对仓位数量';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'part_id', v_part_id, 'system_code', v_system_code);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.save_part_form(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_part_form(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_y_save_part_form.sql') ON CONFLICT DO NOTHING;
