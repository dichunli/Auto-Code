"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { QRCodeSVG } from "qrcode.react";
import { formatCurrency } from "@/lib/utils";

interface TransactionForm {
  transaction_type: "payment" | "refund" | "credit" | "debit";
  amount: string;
  description: string;
}

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [supplierId, setSupplierId] = useState("");
  const [loading, setLoading] = useState(true);

  const [supplier, setSupplier] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [partNames, setPartNames] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [returnRecords, setReturnRecords] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);

  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [transactionForm, setTransactionForm] = useState<TransactionForm>({
    transaction_type: "payment",
    amount: "",
    description: "",
  });
  const [savingTransaction, setSavingTransaction] = useState(false);

  useEffect(() => {
    async function load() {
      const { id } = await params;
      setSupplierId(id);

      // 供应商基本信息
      const { data: sData } = await supabase.from("suppliers").select("*").eq("id", id).single();
      setSupplier(sData);

      // 联系人
      const { data: cData } = await supabase
        .from("supplier_contacts")
        .select("*")
        .eq("supplier_id", id)
        .order("is_primary", { ascending: false });
      setContacts(cData || []);

      // 关联分类（表可能不存在时忽略错误）
      try {
        const { data: catData } = await supabase
          .from("supplier_part_categories")
          .select("part_categories(name)")
          .eq("supplier_id", id);
        setCategories((catData || []).map((c: any) => c.part_categories?.name).filter(Boolean));
      } catch { setCategories([]); }

      // 关联配件名称
      try {
        const { data: pnData } = await supabase
          .from("supplier_part_names")
          .select("part_names(name)")
          .eq("supplier_id", id);
        setPartNames((pnData || []).map((p: any) => p.part_names?.name).filter(Boolean));
      } catch { setPartNames([]); }

      // 关联品牌
      try {
        const { data: bData } = await supabase
          .from("supplier_part_brands")
          .select("part_brands(name)")
          .eq("supplier_id", id);
        setBrands((bData || []).map((b: any) => b.part_brands?.name).filter(Boolean));
      } catch { setBrands([]); }

      // 关联车型
      try {
        const { data: vData } = await supabase
          .from("supplier_vehicle_models")
          .select("vehicle_models(厂商,品牌,车系)")
          .eq("supplier_id", id);
        setVehicles((vData || []).map((v: any) => {
          const vm = v.vehicle_models;
          const parts = [vm?.厂商, vm?.品牌, vm?.车系].filter(Boolean);
          return parts.join(" ") || "-";
        }));
      } catch { setVehicles([]); }

      // 采购记录
      const { data: poData } = await supabase
        .from("purchase_orders")
        .select("*, purchase_order_items(*)")
        .eq("supplier_id", id)
        .order("created_at", { ascending: false });
      setPurchaseOrders(poData || []);

      // 退货记录（通过 work_order_item_parts 关联到 supplier）
      const { data: rData } = await supabase
        .from("supplier_return_records")
        .select("*, work_order_item_parts(supplier_id)")
        .order("created_at", { ascending: false });
      // 过滤出该供应商的退货记录
      setReturnRecords((rData || []).filter((r: any) => r.work_order_item_parts?.supplier_id === id));

      // 往来款项
      const { data: tData } = await supabase
        .from("supplier_transactions")
        .select("*, profiles(full_name)")
        .eq("supplier_id", id)
        .order("created_at", { ascending: false });
      setTransactions(tData || []);

      setLoading(false);
    }
    load();
  }, [params, supabase]);

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(transactionForm.amount);
    if (!amount || amount <= 0) {
      alert("请输入有效的金额");
      return;
    }
    setSavingTransaction(true);
    const { error } = await supabase.from("supplier_transactions").insert({
      supplier_id: supplierId,
      transaction_type: transactionForm.transaction_type,
      amount,
      description: transactionForm.description.trim() || null,
    });
    setSavingTransaction(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    setTransactionForm({ transaction_type: "payment", amount: "", description: "" });
    setShowTransactionForm(false);
    // 刷新往来款项
    const { data } = await supabase
      .from("supplier_transactions")
      .select("*, profiles(full_name)")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: false });
    setTransactions(data || []);
  }

  const transactionTypeMap: Record<string, string> = {
    payment: "付款",
    refund: "退款",
    credit: "应收",
    debit: "应付",
  };

  const returnReasonMap: Record<string, string> = {
    wrong_ship: "错发",
    excess: "多发",
    damaged: "损坏",
    cancel: "客户悔单",
    quality: "质量问题",
  };

  const statusMap: Record<string, string> = {
    draft: "草稿",
    submitted: "已提交",
    approved: "已审批",
    partial_received: "部分收货",
    fully_received: "全部收货",
    cancelled: "已取消",
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="供应商详情" />
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (!supplier) {
    return (
      <div>
        <PageHeader title="供应商详情" />
        <p className="text-gray-500">未找到供应商</p>
        <Link href="/suppliers" className="text-blue-600 hover:underline">返回列表</Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={supplier.name}
        description="供应商详情"
        action={{ href: `/suppliers/${supplierId}/edit`, label: "编辑" }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：基本信息 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 基本信息卡片 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">基本信息</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">联系人：</span>
                <span className="text-gray-900">{supplier.contact || "-"}</span>
              </div>
              <div>
                <span className="text-gray-500">电话：</span>
                <span className="text-gray-900">{supplier.phone || "-"}</span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500">地址：</span>
                <span className="text-gray-900">{supplier.address || "-"}</span>
              </div>
              <div>
                <span className="text-gray-500">发错件次数：</span>
                <span className="text-red-600 font-medium">{supplier.wrong_shipment_count || 0}</span>
              </div>
              <div>
                <span className="text-gray-500">质量返货次数：</span>
                <span className="text-red-600 font-medium">{supplier.quality_return_count || 0}</span>
              </div>
              <div>
                <span className="text-gray-500">推荐等级：</span>
                <span className="text-amber-500 font-medium">
                  {supplier.recommendation_level > 0 ? "⭐".repeat(supplier.recommendation_level) : "不推荐"}
                </span>
              </div>
              {supplier.notes && (
                <div className="col-span-2">
                  <span className="text-gray-500">备注：</span>
                  <span className="text-gray-900">{supplier.notes}</span>
                </div>
              )}
            </div>
          </div>

          {/* 联系人 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">联系人 ({contacts.length})</h2>
            {contacts.length === 0 ? (
              <p className="text-sm text-gray-400">暂无联系人</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">姓名</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">电话</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">职务</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">备注</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {contacts.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900">
                          {c.name}
                          {c.is_primary && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">主要</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{c.phone || "-"}</td>
                        <td className="px-4 py-3 text-gray-600">{c.title || "-"}</td>
                        <td className="px-4 py-3 text-gray-500">{c.notes || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 关联信息 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">关联信息</h2>
            <div className="space-y-4">
              {categories.length > 0 && (
                <div>
                  <span className="text-sm text-gray-500">配件分类：</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {categories.map((name, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs">{name}</span>
                    ))}
                  </div>
                </div>
              )}
              {partNames.length > 0 && (
                <div>
                  <span className="text-sm text-gray-500">配件名称：</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {partNames.map((name, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-green-50 text-green-700 text-xs">{name}</span>
                    ))}
                  </div>
                </div>
              )}
              {brands.length > 0 && (
                <div>
                  <span className="text-sm text-gray-500">配件品牌：</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {brands.map((name, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-xs">{name}</span>
                    ))}
                  </div>
                </div>
              )}
              {vehicles.length > 0 && (
                <div>
                  <span className="text-sm text-gray-500">关联车型：</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {vehicles.map((name, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 text-xs">{name}</span>
                    ))}
                  </div>
                </div>
              )}
              {categories.length === 0 && partNames.length === 0 && brands.length === 0 && vehicles.length === 0 && (
                <p className="text-sm text-gray-400">暂无关联信息</p>
              )}
            </div>
          </div>

          {/* 采购记录 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">采购记录 ({purchaseOrders.length})</h2>
            {purchaseOrders.length === 0 ? (
              <p className="text-sm text-gray-400">暂无采购记录</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">订单号</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">状态</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">金额</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {purchaseOrders.map((po) => (
                      <tr key={po.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900">{po.order_no || "-"}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">{statusMap[po.status] || po.status}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatCurrency(po.total_amount)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{new Date(po.created_at).toLocaleString("zh-CN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 退货记录 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">退货记录 ({returnRecords.length})</h2>
            {returnRecords.length === 0 ? (
              <p className="text-sm text-gray-400">暂无退货记录</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">原因</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">数量</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">状态</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {returnRecords.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900">{returnReasonMap[r.return_reason] || r.return_reason}</td>
                        <td className="px-4 py-3 text-gray-600">{r.quantity}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs ${r.status === "completed" ? "bg-green-50 text-green-600" : "bg-yellow-50 text-yellow-600"}`}>
                            {r.status === "completed" ? "已完成" : "待处理"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.created_at).toLocaleString("zh-CN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：二维码 + 往来款项 */}
        <div className="space-y-6">
          {/* 微信二维码 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">微信</h2>
            {supplier.wechat_id ? (
              <div className="text-center">
                <QRCodeSVG value={supplier.wechat_id} size={160} className="mx-auto" />
                <p className="text-xs text-gray-400 mt-2">微信号：{supplier.wechat_id}</p>
                <p className="text-xs text-gray-400">扫描添加微信</p>
              </div>
            ) : (
              <p className="text-sm text-gray-400">未设置微信号</p>
            )}
            {supplier.wechat_group_qr && (
              <div className="mt-4 pt-4 border-t border-gray-100 text-center">
                <p className="text-sm text-gray-500 mb-2">微信群二维码</p>
                <img src={supplier.wechat_group_qr} alt="微信群" className="w-40 h-40 object-cover rounded mx-auto" />
              </div>
            )}
          </div>

          {/* 往来款项 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">往来款项 ({transactions.length})</h2>
              <button
                onClick={() => setShowTransactionForm(!showTransactionForm)}
                className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
              >
                {showTransactionForm ? "取消" : "记一笔"}
              </button>
            </div>

            {showTransactionForm && (
              <form onSubmit={handleAddTransaction} className="mb-4 p-3 bg-gray-50 rounded-lg space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">类型</label>
                  <select
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    value={transactionForm.transaction_type}
                    onChange={(e) => setTransactionForm({ ...transactionForm, transaction_type: e.target.value as any })}
                  >
                    <option value="payment">付款</option>
                    <option value="refund">退款</option>
                    <option value="credit">应收</option>
                    <option value="debit">应付</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">金额</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    value={transactionForm.amount}
                    onChange={(e) => setTransactionForm({ ...transactionForm, amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">备注</label>
                  <input
                    type="text"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    value={transactionForm.description}
                    onChange={(e) => setTransactionForm({ ...transactionForm, description: e.target.value })}
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingTransaction}
                  className="w-full px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingTransaction ? "保存中..." : "保存"}
                </button>
              </form>
            )}

            {transactions.length === 0 ? (
              <p className="text-sm text-gray-400">暂无往来款项</p>
            ) : (
              <div className="space-y-2">
                {transactions.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm">
                    <div>
                      <span className="text-gray-500">{transactionTypeMap[t.transaction_type]}</span>
                      {t.description && <span className="text-gray-400 ml-2">{t.description}</span>}
                    </div>
                    <span className={`font-medium ${t.transaction_type === "payment" || t.transaction_type === "debit" ? "text-red-600" : "text-green-600"}`}>
                      {t.transaction_type === "payment" || t.transaction_type === "debit" ? "-" : "+"}
                      {formatCurrency(t.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
