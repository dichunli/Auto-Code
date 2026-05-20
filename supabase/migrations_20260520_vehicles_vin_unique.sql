/* ============================================================ */
/* 车辆表 VIN 字段添加唯一约束                                    */
/* ============================================================ */

/* 1. 先把空字符串转为 NULL，避免唯一约束冲突 */
UPDATE vehicles SET vin = NULL WHERE vin = '';

/* 2. 添加唯一约束 */
ALTER TABLE vehicles ADD CONSTRAINT vehicles_vin_unique UNIQUE (vin);
