"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function InventoryInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [parts, setParts] = useState<any[]>([]);
  const [partNames, setPartNames] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [specifications, setSpecifications] = useState<any[]>([]);
  const [newPartMode, setNewPartMode] = useState(false);

  const [selectedPartId, setSelectedPartId] = useState("");
  const [branchId, setBranchId] = useState("");

  const [form, setForm] = useState({
    part_number: "",
    part_name_id: "",
    brand_id: "",
    specification_id: "",
    specification_text: "",
    quantity: "",
    unit_cost: "",
    supplier: "",
    batch_no: "",
    notes: "",
  });

  useEffect(() => {
    supabase.from("parts").select("*, part_names(name)").order("name").then(({ data }) => setParts(data || []));
    supabase.from("part_names").select("*, part_categories(name)").order("name").then(({ data }) => setPartNames(data || []));
    supabase.from("part_brands").select("*").order("name").then(({ data }) => setBrands(data || []));
    supabase.from("part_specifications").select("*").order("name").then(({ data }) => setSpecifications(data || []));
  }, [supabase]);

  // 自动填写：来自工单空分支的入库登记
  useEffect(() => {
    const autoFill = searchParams.get("auto_fill");
    const branch_id = searchParams.get("branch_id");
    if (autoFill !== "1" || !branch_id) return;

    setBranchId(branch_id);
    setNewPartMode(true);

    const next: any = {
      part_number: searchParams.get("part_number") || "",
      supplier: searchParams.get("supplier") || "",
      unit_cost: searchParams.get("unit_cost") || "",
      specification_text: searchParams.get("specification") || "",
    };

    // 尝试匹配配件名称
    const name = searchParams.get("name");
    if (name && partNames.length > 0) {
      const matched = partNames.find((n) => n.name === name);
      if (matched) {
        next.part_name_id = matched.id;
        next.specification_text = next.specification_text || "";
      }
    }

    // 尝试匹配品牌
    const brand = searchParams.get("brand");
    if (brand && brands.length > 0) {
      const matched = brands.find((b) => b.name === brand);
      if (matched) next.brand_id = matched.id;
    }

    setForm((prev) => ({ ...prev, ...next }));
  }, [searchParams, partNames, brands]);

  async function handleCreateBrand() {
    const brandName = prompt("请输入新品牌名称:");
    if (!brandName) return;
    const { data, error } = await supabase.from("part_brands").insert({ name: brandName }).select("id").single();
    if (error) {
      alert("创建失败: " + error.message);
      return;
    }
    setBrands((prev) => [...prev, { id: data.id, name: brandName }]);
    setForm((f) => ({ ...f, brand_id: data.id }));
  }

  async function handleCreateSpec() {
    const specName = prompt("请输入新规格名称:");
    if (!specName) return;
    const { data, error } = await supabase.from("part_specifications").insert({ name: specName }).select("id").single();
    if (error) {
      alert("创建失败: " + error.message);
      return;
    }
    setSpecifications((prev) => [...prev, { id: data.id, name: specName }]);
    setForm((f) => ({ ...f, specification_id: data.id, specification_text: "" }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const qty = parseInt(form.quantity) || 0;
      if (qty <= 0) throw new Error("入库数量必须大于0");

      if (newPartMode) {
        // 新增配件并入库
        if (!form.part_name_id) throw new Error("请选择配件名称");

        const { data: part, error: partError } = await supabase
          .from("parts")
          .insert({
            part_number: form.part_number,
            part_name_id: form.part_name_id,
            brand_id: form.brand_id || null,
            specification_id: form.specification_id || null,
            specification_text: form.specification_text || null,
            quantity: qty,
            unit_cost: parseFloat(form.unit_cost) || 0,
          })
          .select("id")
          .single();

        if (partError || !part) throw partError || new Error("新增配件失败");

        // 如果有批次号，创建批次记录
        if (form.batch_no) {
          await supabase.from("part_batches").insert({
            part_id: part.id,
            batch_no: form.batch_no,
            quantity: qty,
            remaining: qty,
            unit_cost: parseFloat(form.unit_cost) || 0,
          });
        }

        await supabase.from("inventory_logs").insert({
          part_id: part.id,
          change_type: "in",
          quantity: qty,
          before_qty: 0,
          after_qty: qty,
          notes: `采购入库: ${form.supplier || "未知供应商"}${form.batch_no ? ` (批次: ${form.batch_no})` : ""}`,
        });

        // 如果来自工单空分支，自动关联
        if (branchId) {
          await supabase.from("work_order_item_parts").update({ part_id: part.id }).eq("id", branchId);
        }
      } else {
        // 现有配件入库
        if (!selectedPartId) throw new Error("请选择配件");
        const selected = parts.find((p) => p.id === selectedPartId);
        if (!selected) throw new Error("配件不存在");

        const beforeQty = selected.quantity || 0;
        const afterQty = beforeQty + qty;

        const { error: updateError } = await supabase
          .from("parts")
          .update({ quantity: afterQty })
          .eq("id", selectedPartId);

        if (updateError) throw updateError;

        if (form.batch_no) {
          await supabase.from("part_batches").insert({
            part_id: selectedPartId,
            batch_no: form.batch_no,
            quantity: qty,
            remaining: qty,
            unit_cost: parseFloat(form.unit_cost) || 0,
          });
        }

        await supabase.from("inventory_logs").insert({
          part_id: selectedPartId,
          change_type: "in",
          quantity: qty,
          before_qty: beforeQty,
          after_qty: afterQty,
          notes: `采购入库: ${form.supplier || "未知供应商"}${form.batch_no ? ` (批次: ${form.batch_no})` : ""}`,
        });

        // 如果来自工单空分支，自动关联
        if (branchId) {
          await supabase.from("work_order_item_parts").update({ part_id: selectedPartId }).eq("id", branchId);
        }
      }

      router.push("/inventory");
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="入库登记" description="新增配件或给现有配件补货" />

      {branchId && (
        <div className="mb-4 max-w-3xl bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-orange-500" />
          当前为工单空分支入库登记，保存后将自动关联到对应配件分支。
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl">
        <div className="space-y-6">
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => setNewPartMode(false)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${!newPartMode ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}
            >
              现有配件入库
            </button>
            <button
              type="button"
              onClick={() => setNewPartMode(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${newPartMode ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}
            >
              新增配件入库
            </button>
          </div>

          {!newPartMode && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">选择配件</label>
              <select
                required={!newPartMode}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={selectedPartId}
                onChange={(e) => setSelectedPartId(e.target.value)}
              >
                <option value="">请选择</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.part_number} - {p.name} (库存: {p.quantity})
                  </option>
                ))}
              </select>
            </div>
          )}

          {newPartMode && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">配件名称 *</label>
                <select
                  required={newPartMode}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  value={form.part_name_id}
                  onChange={(e) => setForm({ ...form, part_name_id: e.target.value })}
                >
                  <option value="">请选择</option>
                  {partNames.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.part_categories?.name})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  没有需要的名称？请先前往{" "}
                  <a href="/part-names/new" className="text-blue-600 hover:underline" target="_blank">
                    名称库
                  </a>{" "}
                  新建
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">配件编号 *</label>
                  <input
                    required={newPartMode}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={form.part_number}
                    onChange={(e) => setForm({ ...form, part_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">品牌</label>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                      value={form.brand_id}
                      onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                    >
                      <option value="">请选择</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleCreateBrand}
                      className="px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
                    >
                      + 新建
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">规格</label>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                      value={form.specification_id}
                      onChange={(e) => setForm({ ...form, specification_id: e.target.value, specification_text: "" })}
                    >
                      <option value="">从库选择</option>
                      {specifications.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleCreateSpec}
                      className="px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
                    >
                      + 新建
                    </button>
                  </div>
                  {!form.specification_id && (
                    <input
                      className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="或直接输入规格"
                      value={form.specification_text}
                      onChange={(e) => setForm({ ...form, specification_text: e.target.value })}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">入库数量 *</label>
              <input
                required
                type="number"
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">成本单价</label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.unit_cost}
                onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">供应商</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.supplier}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">批次号</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="可选，填写后自动创建批次记录"
              value={form.batch_no}
              onChange={(e) => setForm({ ...form, batch_no: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "保存中..." : "确认入库"}
          </button>
        </div>
      </form>
    </div>
  );
}
