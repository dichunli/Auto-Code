-- ============================================================
-- 汽修管家 - 系统初始化数据
-- 执行方式：在 Supabase SQL Editor 中执行
-- ============================================================

-- 1. 技师等级
INSERT INTO mechanic_levels (name, level_code, share_coefficient) VALUES
('初级技师', 'L1', 0.80),
('中级技师', 'L2', 1.00),
('高级技师', 'L3', 1.20),
('大师技师', 'L4', 1.50);

-- 2. 维修项目分类
INSERT INTO service_categories (name, sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value) VALUES
('保养', 'revenue_pct', 3.00, 'revenue_pct', 2.00, 'revenue_pct', 5.00, 'fixed', 10.00),
('机修', 'revenue_pct', 3.00, 'revenue_pct', 3.00, 'revenue_pct', 8.00, 'fixed', 15.00),
('钣金', 'revenue_pct', 3.00, 'revenue_pct', 3.00, 'revenue_pct', 10.00, 'fixed', 15.00),
('喷漆', 'revenue_pct', 3.00, 'revenue_pct', 3.00, 'revenue_pct', 10.00, 'fixed', 15.00),
('轮胎', 'revenue_pct', 2.00, 'revenue_pct', 2.00, 'revenue_pct', 5.00, 'fixed', 10.00),
('美容', 'revenue_pct', 2.00, 'revenue_pct', 2.00, 'revenue_pct', 5.00, 'fixed', 10.00),
('电气', 'revenue_pct', 3.00, 'revenue_pct', 3.00, 'revenue_pct', 8.00, 'fixed', 15.00);

-- 3. 维修项目名称库
INSERT INTO service_names (category_id, name, search_keywords) VALUES
((SELECT id FROM service_categories WHERE name = '保养'), '更换机油', '机油 润滑油 小保养'),
((SELECT id FROM service_categories WHERE name = '保养'), '更换机油滤芯', '机滤 机油滤芯'),
((SELECT id FROM service_categories WHERE name = '保养'), '更换空气滤芯', '空滤 空气格'),
((SELECT id FROM service_categories WHERE name = '保养'), '更换空调滤芯', '空调滤 空调格'),
((SELECT id FROM service_categories WHERE name = '保养'), '更换火花塞', '火花塞 火嘴'),
((SELECT id FROM service_categories WHERE name = '保养'), '更换刹车油', '刹车油 制动液'),
((SELECT id FROM service_categories WHERE name = '保养'), '更换防冻液', '防冻液 冷却液'),
((SELECT id FROM service_categories WHERE name = '保养'), '更换变速箱油', '变速箱油 波箱油'),
((SELECT id FROM service_categories WHERE name = '机修'), '更换刹车片', '刹车片 制动片'),
((SELECT id FROM service_categories WHERE name = '机修'), '更换刹车盘', '刹车盘 制动盘'),
((SELECT id FROM service_categories WHERE name = '机修'), '更换正时皮带', '正时皮带 时规带'),
((SELECT id FROM service_categories WHERE name = '机修'), '更换水泵', '水泵'),
((SELECT id FROM service_categories WHERE name = '机修'), '更换发电机', '发电机 交流发电机'),
((SELECT id FROM service_categories WHERE name = '机修'), '更换启动机', '启动机 起动机'),
((SELECT id FROM service_categories WHERE name = '机修'), '更换蓄电池', '电瓶 蓄电池'),
((SELECT id FROM service_categories WHERE name = '轮胎'), '更换轮胎', '轮胎 换胎'),
((SELECT id FROM service_categories WHERE name = '轮胎'), '轮胎动平衡', '动平衡 轮胎平衡'),
((SELECT id FROM service_categories WHERE name = '轮胎'), '四轮定位', '四轮定位 定位'),
((SELECT id FROM service_categories WHERE name = '轮胎'), '轮胎修补', '补胎 轮胎修补'),
((SELECT id FROM service_categories WHERE name = '钣金'), '钣金修复', '钣金 凹陷修复'),
((SELECT id FROM service_categories WHERE name = '钣金'), '更换保险杠', '保险杠 前杠 后杠'),
((SELECT id FROM service_categories WHERE name = '喷漆'), '喷漆修复', '喷漆 补漆 漆面修复'),
((SELECT id FROM service_categories WHERE name = '喷漆'), '全车喷漆', '全车漆 整车喷漆'),
((SELECT id FROM service_categories WHERE name = '电气'), '检测电路', '电路 线路检测'),
((SELECT id FROM service_categories WHERE name = '电气'), '更换大灯', '大灯 前大灯'),
((SELECT id FROM service_categories WHERE name = '美容'), '精洗', '精洗 深度清洗'),
((SELECT id FROM service_categories WHERE name = '美容'), '打蜡', '打蜡 车蜡');

-- 4. 配件分类
INSERT INTO part_categories (name, auto_link_vehicle_model, is_consumable, sales_commission_type, sales_commission_value, picking_commission_type, picking_commission_value) VALUES
('机油', true, true, 'revenue_pct', 2.00, 'fixed', 2.00),
('滤芯', true, true, 'revenue_pct', 2.00, 'fixed', 1.00),
('刹车系统', true, false, 'revenue_pct', 3.00, 'fixed', 2.00),
('轮胎', true, false, 'revenue_pct', 2.00, 'fixed', 3.00),
('蓄电池', false, false, 'revenue_pct', 3.00, 'fixed', 2.00),
('皮带/链条', true, false, 'revenue_pct', 3.00, 'fixed', 2.00),
('火花塞', true, true, 'revenue_pct', 2.00, 'fixed', 1.00),
('防冻液', false, true, 'revenue_pct', 2.00, 'fixed', 1.00),
('刹车油', false, true, 'revenue_pct', 2.00, 'fixed', 1.00),
('变速箱油', false, true, 'revenue_pct', 2.00, 'fixed', 1.00),
('大灯/灯泡', false, false, 'revenue_pct', 3.00, 'fixed', 1.00),
('雨刷', false, true, 'revenue_pct', 2.00, 'fixed', 1.00);

-- 5. 配件名称库
INSERT INTO part_names (category_id, name, unit, search_keywords) VALUES
((SELECT id FROM part_categories WHERE name = '机油'), '发动机机油', '升', '机油 润滑油 发动机油'),
((SELECT id FROM part_categories WHERE name = '滤芯'), '机油滤芯', '个', '机滤 机油格'),
((SELECT id FROM part_categories WHERE name = '滤芯'), '空气滤芯', '个', '空滤 空气格'),
((SELECT id FROM part_categories WHERE name = '滤芯'), '空调滤芯', '个', '空调滤 空调格'),
((SELECT id FROM part_categories WHERE name = '滤芯'), '汽油滤芯', '个', '汽滤 汽油格'),
((SELECT id FROM part_categories WHERE name = '刹车系统'), '前刹车片', '副', '刹车片 制动片 前片'),
((SELECT id FROM part_categories WHERE name = '刹车系统'), '后刹车片', '副', '刹车片 制动片 后片'),
((SELECT id FROM part_categories WHERE name = '刹车系统'), '前刹车盘', '个', '刹车盘 制动盘 前盘'),
((SELECT id FROM part_categories WHERE name = '刹车系统'), '后刹车盘', '个', '刹车盘 制动盘 后盘'),
((SELECT id FROM part_categories WHERE name = '轮胎'), '轿车轮胎', '条', '轮胎 车胎'),
((SELECT id FROM part_categories WHERE name = '轮胎'), 'SUV轮胎', '条', '轮胎 SUV胎'),
((SELECT id FROM part_categories WHERE name = '蓄电池'), '汽车蓄电池', '个', '电瓶 蓄电池'),
((SELECT id FROM part_categories WHERE name = '皮带/链条'), '正时皮带', '条', '正时皮带 时规带'),
((SELECT id FROM part_categories WHERE name = '皮带/链条'), '发电机皮带', '条', '发电机皮带 附件皮带'),
((SELECT id FROM part_categories WHERE name = '火花塞'), '镍合金火花塞', '个', '火花塞 火嘴'),
((SELECT id FROM part_categories WHERE name = '火花塞'), '铱金火花塞', '个', '火花塞 铱金'),
((SELECT id FROM part_categories WHERE name = '防冻液'), '长效防冻液', '升', '防冻液 冷却液'),
((SELECT id FROM part_categories WHERE name = '刹车油'), 'DOT4刹车油', '升', '刹车油 制动液'),
((SELECT id FROM part_categories WHERE name = '变速箱油'), '自动变速箱油', '升', '变速箱油 ATF'),
((SELECT id FROM part_categories WHERE name = '变速箱油'), '手动变速箱油', '升', '变速箱油 齿轮油'),
((SELECT id FROM part_categories WHERE name = '大灯/灯泡'), 'LED大灯', '个', '大灯 LED'),
((SELECT id FROM part_categories WHERE name = '大灯/灯泡'), '卤素灯泡', '个', '灯泡 大灯灯泡'),
((SELECT id FROM part_categories WHERE name = '雨刷'), '前雨刷', '副', '雨刷 雨刮器'),
((SELECT id FROM part_categories WHERE name = '雨刷'), '后雨刷', '副', '后雨刷 后雨刮');

-- 6. 配件品牌
INSERT INTO part_brands (name, usage_count) VALUES
('博世 (BOSCH)', 0),
('壳牌 (Shell)', 0),
('曼牌 (MANN)', 0),
('马勒 (MAHLE)', 0),
('米其林 (Michelin)', 0),
('普利司通 (Bridgestone)', 0),
('固特异 (Goodyear)', 0),
('瓦尔塔 (VARTA)', 0),
('骆驼 (CAMEL)', 0),
('NGK', 0),
('电装 (DENSO)', 0),
('美孚 (Mobil)', 0),
('嘉实多 (Castrol)', 0),
('道达尔 (Total)', 0),
('菲罗多 (FERODO)', 0),
('TRW', 0),
('法雷奥 (Valeo)', 0),
('飞利浦 (Philips)', 0),
('欧司朗 (OSRAM)', 0),
('3M', 0);

-- 7. 配件规格
INSERT INTO part_specifications (name, usage_count) VALUES
('5W-30 1L', 0),
('5W-30 4L', 0),
('5W-40 1L', 0),
('5W-40 4L', 0),
('0W-20 4L', 0),
('205/55 R16', 0),
('215/60 R16', 0),
('225/45 R17', 0),
('235/55 R18', 0),
('D1109', 0),
('C24005', 0),
('C37153', 0),
('LIFAM1A2', 0),
('ILZFR6K11', 0),
('ILTR5A13G', 0),
('LFR6A', 0),
('12V 60Ah', 0),
('12V 70Ah', 0),
('12V 80Ah', 0),
('H7 55W', 0),
('H4 60/55W', 0),
('HB3 60W', 0),
('26/16寸', 0),
('24/18寸', 0);

-- 8. 知识库分类
INSERT INTO knowledge_categories (name, sort_order) VALUES
('维修指导', 1),
('视频教程', 2),
('常见问题', 3),
('车型专项', 4),
('工具使用', 5);

-- 9. 知识库示例文章（更换机油指导）
INSERT INTO knowledge_articles (title, type, category_id, content) VALUES
('标准更换机油流程', 'article', (SELECT id FROM knowledge_categories WHERE name = '维修指导'), '<h3>准备工作</h3><p>1. 确认车辆处于水平地面<br>2. 发动机预热至正常工作温度<br>3. 准备接油盆、新机油、机滤</p><h3>操作步骤</h3><p>1. 升起车辆或进入地沟<br>2. 拧开放油螺栓，放出旧机油<br>3. 更换机油滤芯<br>4. 拧紧放油螺栓（扭矩：25-30Nm）<br>5. 加注新机油至标准刻度<br>6. 启动发动机检查泄漏</p>'),
('刹车片更换注意事项', 'article', (SELECT id FROM knowledge_categories WHERE name = '维修指导'), '<h3>安全警告</h3><p>更换刹车片前必须释放制动液压力，避免制动液喷射伤人。</p><h3>标准流程</h3><p>1. 拆卸轮胎<br>2. 松开制动卡钳固定螺栓<br>3. 取出旧刹车片<br>4. 清洁卡钳导轨<br>5. 安装新刹车片<br>6. 复位活塞<br>7. 装回卡钳并紧固</p>');

-- 10. 客户标签
INSERT INTO tags (name, color) VALUES
('VIP客户', '#f59e0b'),
('企业客户', '#3b82f6'),
('老客户', '#10b981'),
('新客户', '#6b7280'),
('挑剔客户', '#ef4444'),
('爽快客户', '#8b5cf6');

-- 11. 供应商
INSERT INTO suppliers (name, contact, phone, address) VALUES
('博世汽配总代理', '张经理', '13800138001', '北京市朝阳区汽配城A区101'),
('壳牌润滑油经销', '李经理', '13800138002', '上海市闵行区润滑油市场B区205'),
('米其林轮胎专营', '王经理', '13800138003', '广州市白云区轮胎批发市场C区88'),
('瓦尔塔电瓶批发', '赵经理', '13800138004', '深圳市宝安区电瓶城D区12');

-- 12. 物流公司
INSERT INTO logistics_companies (name, contact, phone, tracking_url) VALUES
('顺丰速运', '客服', '95338', 'https://www.sf-express.com'),
('德邦物流', '客服', '95353', 'https://www.deppon.com'),
('中通快运', '客服', '95311', 'https://www.zto.com'),
('京东物流', '客服', '950616', 'https://www.jdl.com');
