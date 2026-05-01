"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";

export default function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [memberId, setMemberId] = useState("");

  const [member, setMember] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 充值弹窗
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [rechargeAmount, setRechargeAmount] = useState("");
  const [rechargeMethod, setRechargeMethod] = useState("cash");
  const [rechargeNotes, setRechargeNotes] = useState("");
  const [rechargeLoading, setRechargeLoading] = useState(false);

  // 编辑
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});

  useEffect(() => {
    params.then((p) => setMemberId(p.id));
  }, [params]);

  const loadData = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    const [{ data: m }, { data: txs }] = await Promise.all([
      supabase.from("members").select("*, customers(name, phone)").eq("id", memberId).single(),
      supabase
        .from("member_transactions")
        .select("*, work_orders(order_no)")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false }),
    ]);
    setMember(m);
    setTransactions(txs || []);
    setEditForm(m || {});
    setLoading(false);
  }, [memberId, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRecharge() {
    const amount = parseFloat(rechargeAmount);
    if (!amount || amount <= 0) {
      alert("请输入有效金额");
      return;
    }
    setRechargeLoading(true);

    try {
      const { data: result, error: rpcErr } = await supabase.rpc("recharge_member", {
        p_member_id: memberId,
        p_amount: amount,
        p_payment_method: rechargeMethod,
        p_notes: rechargeNotes || null,
      });

      if (rpcErr) throw new Error(rpcErr.message);

      const rpcResult = result as { success: boolean; error?: string; new_balance?: number };
      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error || "充值失败");
      }

      setRechargeOpen(false);
      setRechargeAmount("");
      setRechargeNotes("");
      loadData();
    } catch (err: any) {
      alert("充值失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRechargeLoading(false);
    }
  }

  async function handleSaveEdit() {
    const { error } = await supabase
      .from("members")
      .update({
        name: editForm.name,
        phone: editForm.phone || null,
        discount_rate: parseFloat(editForm.discount_rate) || 1,
        status: editForm.status,
        notes: editForm.notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", memberId);

    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    setEditing(false);
    loadData();
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title="会员详情" />
        <div className="text-center text-gray-400 py-12">加载中...</div>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title="会员详情" />
        <div className="text-center text-gray-400 py-12">会员不存在</div>
      </div>
    );
  }

  const statusMap: Record<string, string> = {
    active: "正常",
    frozen: "冻结",
    expired: "过期",
  };

  const statusColor: Record<string, string> = {
    active: "bg-green-50 text-green-700",
    frozen: "bg-orange-50 text-orange-700",
    expired: "bg-gray-50 text-gray-500",
  };

  const typeMap: Record<string, string> = {
    recharge: "充值",
    consume: "消费",
    refund: "退款",
  };

  const typeColor: Record<string, string> = {
    recharge: "text-green-600",
    consume: "text-red-600",
    refund: "text-orange-600",
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader title={`会员: ${member.name}`} description={`卡号: ${member.card_no}`} />

      {/* 基本信息 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">基本信息</h2>
          <div className="flex gap-2">
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-sm px-3 py-1.5 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100"
              >
                编辑
              </button>
            )}
            <button
              onClick={() => setRechargeOpen(true)}
              className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              充值
            </button>
          </div>
        </div>

        {!editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">卡号:</span> <span className="font-medium">{member.card_no}</span></div>
            <div><span className="text-gray-500">姓名:</span> <span className="font-medium">{member.name}</span></div>
            <div><span className="text-gray-500">手机号:</span> {member.phone || "-"}</div>
            <div>
              <span className="text-gray-500">状态:</span>{" "}
              <span className={`text-xs px-2 py-0.5 rounded ${statusColor[member.status]}`}>
                {statusMap[member.status]}
              </span>
            </div>
            <div>
              <span className="text-gray-500">余额:</span>{" "}
              <span className="font-bold text-lg text-blue-600">{formatCurrency(member.balance)}</span>
            </div>
            <div>
              <span className="text-gray-500">折扣:</span>{" "}
              {member.discount_rate < 1 ? `${(member.discount_rate * 100).toFixed(0)}折` : "无折扣"}
            </div>
            {member.customers && (
              <div className="sm:col-span-2">
                <span className="text-gray-500">关联客户:</span>{" "}
                <Link href={`/customers/${member.customer_id}`} className="text-blue-600 hover:text-blue-700">
                  {member.customers.name} {member.customers.phone ? `(${member.customers.phone})` : ""}
                </Link>
              </div>
            )}
            {member.notes && (
              <div className="sm:col-span-2">
                <span className="text-gray-500">备注:</span> {member.notes}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">姓名</label>
                <input
                  value={editForm.name || ""}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">手机号</label>
                <input
                  value={editForm.phone || ""}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">折扣率</label>
                <select
                  value={editForm.discount_rate || "1"}
                  onChange={(e) => setEditForm({ ...editForm, discount_rate: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="1">无折扣</option>
                  <option value="0.95">95折</option>
                  <option value="0.9">9折</option>
                  <option value="0.85">85折</option>
                  <option value="0.8">8折</option>
                  <option value="0.7">7折</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">状态</label>
                <select
                  value={editForm.status || "active"}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="active">正常</option>
                  <option value="frozen">冻结</option>
                  <option value="expired">过期</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">备注</label>
              <textarea
                value={editForm.notes || ""}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={2}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveEdit} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">保存</button>
              <button onClick={() => setEditing(false)} className="px-4 py-2 bg-white text-gray-700 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            </div>
          </div>
        )}
      </div>

      {/* 交易记录 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">交易记录</h2>
        {transactions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">时间</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">类型</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">金额</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">余额</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">关联工单</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600">{formatDate(tx.created_at)}</td>
                    <td className="px-4 py-2">
                      <span className={`font-medium ${typeColor[tx.type]}`}>{typeMap[tx.type]}</span>
                    </td>
                    <td className="px-4 py-2 font-medium">
                      <span className={tx.type === "recharge" ? "text-green-600" : tx.type === "consume" ? "text-red-600" : ""}>
                        {tx.type === "recharge" ? "+" : tx.type === "consume" ? "-" : ""}
                        {formatCurrency(Math.abs(tx.amount))}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{formatCurrency(tx.balance_after)}</td>
                    <td className="px-4 py-2">
                      {tx.work_orders ? (
                        <Link href={`/work-orders/${tx.work_order_id}`} className="text-blue-600 hover:text-blue-700">
                          {tx.work_orders.order_no}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{tx.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-8">暂无交易记录</p>
        )}
      </div>

      {/* 充值弹窗 */}
      {rechargeOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-bold">会员充值</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">充值金额</label>
              <input
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={rechargeAmount}
                onChange={(e) => setRechargeAmount(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">支付方式</label>
              <select
                value={rechargeMethod}
                onChange={(e) => setRechargeMethod(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="cash">现金</option>
                <option value="wechat">微信</option>
                <option value="alipay">支付宝</option>
                <option value="bank_transfer">银行转账</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
              <input
                value={rechargeNotes}
                onChange={(e) => setRechargeNotes(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="可选"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleRecharge}
                disabled={rechargeLoading}
                className="flex-1 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {rechargeLoading ? "处理中..." : "确认充值"}
              </button>
              <button
                onClick={() => setRechargeOpen(false)}
                className="px-4 py-2 bg-white text-gray-700 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
