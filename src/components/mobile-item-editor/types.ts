/* ==================== MobileItemEditor 类型定义 ====================
 * 从 MobileItemEditor.tsx 原样搬出，仅做类型归集，无任何改动 */

export interface Profile {
  id: string;
  full_name: string;
}

export interface MechanicGroup {
  id: string;
  name: string;
  members: { mechanic_id: string; profiles?: { full_name?: string } | null }[];
}

export interface ExistingMechanic {
  mechanic_id: string;
  share_pct?: number;
  profiles?: { full_name?: string } | null;
}

export interface ConstructionLog {
  id: string;
  action: "start" | "pause" | "resume" | "complete";
  created_at: string;
  mechanic_id: string | null;
}

export interface OutsourceOrderItem {
  id: string;
  service_name?: string;
  amount?: number;
}

export interface ItemData {
  id: string;
  name: string;
  alias_name?: string | null;
  item_type: string;
  quantity?: number | null;
  unit_price?: number | null;
  total_price?: number | null;
  description?: string | null;
  customer_opinion?: string | null;
  is_outsourced?: boolean | null;
  is_customer_part?: boolean | null;
  status?: string | null;
  require_qc?: boolean | null;
  qc_status?: string | null;
  mechanic_id?: string | null;
  submitter_id?: string | null;
  inspector_id?: string | null;
  service_item_id?: string | null;
  service_items?: { id?: string | null } | null;
  outsourced_supplier?: { name?: string } | null;
  outsource_order_items?: OutsourceOrderItem[] | null;
}

export interface ItemPart {
  id: string;
  name: string;
  /* 编码/品牌/规格在数据库中可空（未填即 null），原声明必填过严 */
  part_number: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit: string;
  brand: string | null;
  specification: string | null;
  unit_cost?: number | null;
  /* 以下 4 个字段由实时同步广播推送，本组件仅透传合并 */
  cost_price?: number | null;
  supplier_name?: string | null;
  is_purchased?: boolean | null;
  is_arrived?: boolean | null;
  customer_opinion?: string | null;
  notes?: string | null;
  part_id?: string | null;
  part_name_id?: string | null;
  branch_group_id?: string | null;
  category?: string | null;
  is_selected?: boolean | null;
  document_name?: string | null;
  pickedQty?: number;
}

export interface PartImageRecord {
  storage_path?: string;
  media_type?: string;
}

export interface PartNameResult {
  id: string;
  name: string;
  unit: string | null;
  default_quantity: number | null;
}

export interface SelectedPartName {
  part_name_id: string;
  name: string;
  unit: string;
  quantity: number | null;
}

export interface SelectedRealPart {
  part_id: string;
  part_name_id: string | null;
  name: string;
  part_number: string;
  unit: string;
  brand: string;
  specification: string;
  unit_cost: number | null;
  unit_price: number | null;
  quantity: number | null;
}

export interface PresetPart {
  part_name_id: string;
  name: string;
  unit: string;
  quantity: number | null;
}

export interface ExistingOrder {
  id: string;
  order_no: string;
  supplier_id: string;
  total_amount: number;
  is_paid: boolean;
  payment_method?: string | null;
  notes?: string | null;
  created_at?: string | null;
  suppliers?: { name: string } | null;
  outsource_order_items?: Array<{
    id: string;
    work_order_item_id: string;
    service_item_id: string;
    service_name: string;
    amount: number;
  }>;
}

export interface ExistingItem {
  id: string;
  service_item_id: string;
  service_name: string;
  amount: number;
}

export interface PickerPart {
  id: string;
  part_name_id: string | null;
  name: string;
  part_number: string | null;
  unit: string | null;
  part_brands: { name: string } | { name: string }[] | null;
  specification_text: string | null;
  part_specifications: { name: string } | null;
  unit_cost: number | null;
  unit_price: number | null;
  selectedQuantity?: number | null;
}

/* 编码/扫码/搜索命中的库存配件（带回分支用） */
export interface 编码命中配件 {
  id: string;
  part_number: string | null;
  part_name_id: string | null;
  name: string;
  brand: string;
  specification: string;
  unit_cost: number | null;
  unit_price: number | null;
  document_name: string | null;
}

/* parts 表带关联名称的查询行 */
export interface 配件库行 {
  id: string;
  part_number: string | null;
  part_name_id: string | null;
  unit_cost: number | null;
  unit_price: number | null;
  document_name: string | null;
  part_names: { name: string } | { name: string }[] | null;
  part_brands: { name: string } | { name: string }[] | null;
  part_specifications: { name: string } | { name: string }[] | null;
}

/* 配件库选择 */
export interface InventoryPart {
  id: string;
  part_number: string | null;
  name: string;
  quantity: number;
  unit_price: number | null;
  part_name_id: string | null;
}

/* 配件申领：该分支待出库申领列表行（面板展开时拉取） */
export interface 申领行 {
  id: string;
  quantity: number;
  notes: string | null;
  created_at: string;
}

export interface Props {
  item: ItemData;
  orderId: string;
  profiles: Profile[];
  mechanicGroups: MechanicGroup[];
  existingMechanics: ExistingMechanic[];
  images: string[];
  knowledgeUrl?: string;
  isLocked: boolean;
  parts: ItemPart[];
  vehicleModelId?: number | null;
  existingOrder?: ExistingOrder | null;
  existingItem?: ExistingItem | null;
  partInventory?: Record<string, number>;
  partImages?: Record<string, PartImageRecord[]>;
  /* 配件工作流（领料/退库/退货/采购/到货）需要的数据 */
  suppliers?: { id: string; name: string; region?: string | null }[];
  logisticsCompanies?: { id: string; name: string; scopes?: string[] | null }[];
  returnByPart?: Record<string, number>;
  pendingSupplierReturnByPart?: Record<string, boolean>;
  /* 待出库申领数（按分支）：详情抽屉显示"已申领"角标 + 申领入口 */
  申领ByPart?: Record<string, number>;
}
