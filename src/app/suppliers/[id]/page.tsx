import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import SupplierDetailClient from "./SupplierDetailClient";
import type {
  Supplier,
  SupplierContact,
  PurchaseOrder,
  ReturnRecord,
  InboundOrder,
  ReturnOrder,
  Transaction,
} from "./SupplierDetailClient";

/* 关联查询返回的嵌套结构 */
interface 车型关联 {
  vehicle_models: { 厂商: string | null; 品牌: string | null; 车系: string | null } | null;
}
interface 分类关联 {
  part_categories: { name: string } | null;
}
interface 名称关联 {
  part_names: { name: string } | null;
}
interface 品牌关联 {
  part_brands: { name: string } | null;
}

/* 供应商详情页：首屏数据全部在服务端并行查询，客户端组件只负责渲染和交互 */
export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  /* 10 项数据互不依赖，全部并行查询（原来客户端串行要十几趟网络往返） */
  const [
    供应商结果,
    联系人结果,
    分类结果,
    名称结果,
    品牌结果,
    车型结果,
    采购结果,
    退货结果,
    入库结果,
    采退结果,
    往来结果,
  ] = await Promise.all([
    supabase.from("suppliers").select("*").eq("id", id).single(),
    supabase
      .from("supplier_contacts")
      .select("*")
      .eq("supplier_id", id)
      .order("is_primary", { ascending: false }),
    supabase
      .from("supplier_part_categories")
      .select("part_categories(name)")
      .eq("supplier_id", id),
    supabase.from("supplier_part_names").select("part_names(name)").eq("supplier_id", id),
    supabase.from("supplier_part_brands").select("part_brands(name)").eq("supplier_id", id),
    supabase
      .from("supplier_vehicle_models")
      .select("vehicle_models(厂商,品牌,车系)")
      .eq("supplier_id", id),
    supabase
      .from("purchase_orders")
      .select("*, purchase_order_items(*)")
      .eq("supplier_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("supplier_return_records")
      .select("*, work_order_item_parts(supplier_id)")
      .order("created_at", { ascending: false }),
    supabase
      .from("inbound_orders")
      .select("id, inbound_no, total_quantity, total_amount, freight_amount, status, created_at")
      .eq("supplier_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("purchase_return_orders")
      .select(
        "id, return_no, total_quantity, status, logistics_company, tracking_no, return_shipping_fee, shipping_fee_payer, created_at"
      )
      .eq("supplier_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("supplier_transactions")
      .select("*, profiles(full_name)")
      .eq("supplier_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const supplier = 供应商结果.data as Supplier | null;

  if (!supplier) {
    return (
      <div>
        <PageHeader title="供应商详情" />
        <p className="text-gray-500">未找到供应商</p>
        <Link href="/suppliers" className="text-blue-600 hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  const contacts = (联系人结果.data as SupplierContact[] | null) || [];

  const categories = ((分类结果.data as unknown as 分类关联[] | null) || [])
    .map((c) => c.part_categories?.name)
    .filter(Boolean) as string[];

  const partNames = ((名称结果.data as unknown as 名称关联[] | null) || [])
    .map((p) => p.part_names?.name)
    .filter(Boolean) as string[];

  const brands = ((品牌结果.data as unknown as 品牌关联[] | null) || [])
    .map((b) => b.part_brands?.name)
    .filter(Boolean) as string[];

  const vehicles = ((车型结果.data as unknown as 车型关联[] | null) || []).map((v) => {
    const vm = v.vehicle_models;
    const parts = [vm?.厂商, vm?.品牌, vm?.车系].filter(Boolean);
    return parts.join(" ") || "-";
  });

  const purchaseOrders = (采购结果.data as PurchaseOrder[] | null) || [];

  /* 退货记录：通过 work_order_item_parts 过滤出该供应商的记录 */
  const returnRecords = ((退货结果.data as ReturnRecord[] | null) || []).filter(
    (r) => r.work_order_item_parts?.supplier_id === id
  );

  const inboundOrders = (入库结果.data as InboundOrder[] | null) || [];
  const returnOrders = (采退结果.data as ReturnOrder[] | null) || [];
  const transactions = (往来结果.data as Transaction[] | null) || [];

  return (
    <SupplierDetailClient
      supplierId={id}
      supplier={supplier}
      initialContacts={contacts}
      categories={categories}
      partNames={partNames}
      brands={brands}
      vehicles={vehicles}
      purchaseOrders={purchaseOrders}
      returnRecords={returnRecords}
      inboundOrders={inboundOrders}
      returnOrders={returnOrders}
      initialTransactions={transactions}
    />
  );
}
