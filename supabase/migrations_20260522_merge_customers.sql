/* 客户合并功能：将被合并客户的所有关联数据迁移到主客户，然后删除被合并客户 */

CREATE OR REPLACE FUNCTION merge_customers(source_id UUID, target_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  source_exists BOOLEAN;
  target_exists BOOLEAN;
BEGIN
  /* 校验参数 */
  IF source_id = target_id THEN
    RETURN jsonb_build_object('success', false, 'error', '不能合并到同一个客户');
  END IF;

  SELECT EXISTS(SELECT 1 FROM customers WHERE id = source_id) INTO source_exists;
  SELECT EXISTS(SELECT 1 FROM customers WHERE id = target_id) INTO target_exists;

  IF NOT source_exists THEN
    RETURN jsonb_build_object('success', false, 'error', '被合并客户不存在');
  END IF;
  IF NOT target_exists THEN
    RETURN jsonb_build_object('success', false, 'error', '目标主客户不存在');
  END IF;

  /* customer_tags：先删除目标客户的重复标签，避免唯一约束冲突 */
  BEGIN
    DELETE FROM customer_tags
    WHERE customer_id = target_id
      AND tag_id IN (SELECT tag_id FROM customer_tags WHERE customer_id = source_id);
    UPDATE customer_tags SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* customer_invoices */
  BEGIN
    UPDATE customer_invoices SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* vehicles */
  BEGIN
    UPDATE vehicles SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* work_orders */
  BEGIN
    UPDATE work_orders SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* accounts_receivable */
  BEGIN
    UPDATE accounts_receivable SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* members：如果目标已有会员，删除被合并客户的会员；否则迁移 */
  BEGIN
    IF EXISTS (SELECT 1 FROM members WHERE customer_id = target_id) THEN
      DELETE FROM members WHERE customer_id = source_id;
    ELSE
      UPDATE members SET customer_id = target_id WHERE customer_id = source_id;
    END IF;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* maintenance_reminders */
  BEGIN
    UPDATE maintenance_reminders SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* notifications */
  BEGIN
    UPDATE notifications SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* customer_photos */
  BEGIN
    UPDATE customer_photos SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* customer_contacts */
  BEGIN
    UPDATE customer_contacts SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* customer_phones */
  BEGIN
    UPDATE customer_phones SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* service_item_special_prices */
  BEGIN
    UPDATE service_item_special_prices SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* part_special_prices */
  BEGIN
    UPDATE part_special_prices SET customer_id = target_id WHERE customer_id = source_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  /* 删除被合并客户 */
  DELETE FROM customers WHERE id = source_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
