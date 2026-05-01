"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewMemberForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);

  const [cardNo, setCardNo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [initialBalance, setInitialBalance] = useState("");
  const [discountRate, setDiscountRate] = useState("1");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    supabase.from("customers").select("id, name, phone").order("name").then(({ data }) => {
      const list = data || [];
      setCustomers(list);
      // 从URL参数自动填充
      const cid = searchParams.get("customer_id");
      if (cid) {
        const c = list.find((x: any) => x.id === cid);
        if (c) {
          setCustomerId(cid);
          setName(c.name);
          setPhone(c.phone || "");
        }
      }
    });
  }, [supabase, searchParams]);

  function handleCustomerChange(cid: string) {
    setCustomerId(cid);
    const c = customers.find((x) => x.id === cid);
    if (c) {
      if (!name) setName(c.name);
      if (!phone) setPhone(c.phone || "");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cardNo || !name) {
      alert("请填写卡号和姓名");
      return;
    }

    setLoading(true);

    try {
      const balance = parseFloat(initialBalance) || 0;

      // 创建会员
      const { data: member, error: memberErr } = await supabase
        .from("members")
        .insert({
          card_no: cardNo.trim(),
          customer_id: customerId || null,
          name: name.trim(),
          phone: phone.trim() || null,
          balance: balance,
          discount_rate: parseFloat(discountRate) || 1,
          notes: notes || null,
        })
        .select("id")
        .single();

      if (memberErr) throw memberErr;

      // 如果有初始充值，创建交易记录
      if (balance > 0) {
        await supabase.from("member_transactions").insert({
          member_id: member.id,
          type: "recharge",
          amount: balance,
          balance_after: balance,
          payment_method: "cash",
          notes: "开卡初始充值",
        });
      }

      router.push("/members");
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + err.message);
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="新增会员" description="创建会员卡并可选初始充值" />

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">会员卡号 *</label>
            <input
              required
              value={cardNo}
              onChange={(e) => setCardNo(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如: M0001"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">关联客户</label>
            <select
              value={customerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">不关联（散客会员）</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `(${c.phone})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">初始充值金额</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">折扣率</label>
            <select
              value={discountRate}
              onChange={(e) => setDiscountRate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1">无折扣</option>
              <option value="0.95">95折</option>
              <option value="0.9">9折</option>
              <option value="0.85">85折</option>
              <option value="0.8">8折</option>
              <option value="0.7">7折</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? "保存中..." : "保存"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/members")}
            className="px-5 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}
