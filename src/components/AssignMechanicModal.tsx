"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface Profile {
  id: string;
  full_name: string;
}

interface MechanicGroup {
  id: string;
  name: string;
  members: { mechanic_id: string; profiles?: { full_name: string } | null }[];
}

interface ExistingMechanic {
  mechanic_id: string;
  share_pct: number;
  profiles?: { full_name: string } | null;
}

interface Props {
  open: boolean;
  itemId: string;
  profiles: Profile[];
  mechanicGroups: MechanicGroup[];
  existingMechanics: ExistingMechanic[];
  onClose: () => void;
}

export function AssignMechanicModal({ open, itemId, profiles, mechanicGroups, existingMechanics, onClose }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"person" | "group">("person");
  const [selectedPersons, setSelectedPersons] = useState<string[]>(existingMechanics.map((m) => m.mechanic_id));
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [commissionRule, setCommissionRule] = useState<"equal" | "byLevel" | "manual">("equal");
  const [manualRatios, setManualRatios] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showClaimChoice, setShowClaimChoice] = useState(false);
  const [levelPreview, setLevelPreview] = useState<{ id: string; name: string; coeff: number; ratio: number }[]>([]);

  useEffect(() => {
    if (open) {
      setSelectedPersons(existingMechanics.map((m) => m.mechanic_id));
      setSelectedGroup("");
      setShowClaimChoice(false);
      setCommissionRule("equal");
      setManualRatios({});
      setLevelPreview([]);
    }
  }, [open, existingMechanics]);

  const personCount = mode === "group" && selectedGroup
    ? (mechanicGroups.find((g) => g.id === selectedGroup)?.members.length || 0)
    : selectedPersons.length;

  const isMulti = personCount > 1;

  function togglePerson(id: string) {
    setSelectedPersons((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // 按技师等级分配预览
  useEffect(() => {
    async function calcPreview() {
      if (commissionRule !== "byLevel" || !isMulti) {
        setLevelPreview([]);
        return;
      }
      const ids = mode === "group" && selectedGroup
        ? (mechanicGroups.find((g) => g.id === selectedGroup)?.members.map((m) => m.mechanic_id) || [])
        : selectedPersons;
      if (ids.length === 0) return;

      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, mechanic_levels(commission_weight)")
        .in("id", ids);

      const rows = (data || []).map((row: any) => ({
        id: row.id,
        name: row.full_name,
        coeff: row.mechanic_levels?.commission_weight || 1,
      }));
      const totalCoeff = rows.reduce((sum, r) => sum + r.coeff, 0);
      const preview = rows.map((r) => ({
        ...r,
        ratio: Math.round((r.coeff / totalCoeff) * 100 * 100) / 100,
      }));
      // 修正误差
      const sumRatio = preview.reduce((s, p) => s + p.ratio, 0);
      if (sumRatio !== 100 && preview.length > 0) {
        preview[0].ratio = Math.round((preview[0].ratio + (100 - sumRatio)) * 100) / 100;
      }
      setLevelPreview(preview);
    }
    calcPreview();
  }, [commissionRule, isMulti, mode, selectedGroup, selectedPersons, supabase]);

  async function handleSoloClaim() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert("未登录，无法领单");
      setLoading(false);
      return;
    }
    await supabase.from("work_order_item_mechanics").delete().eq("work_order_item_id", itemId);
    const { error } = await supabase.from("work_order_item_mechanics").insert({
      work_order_item_id: itemId,
      mechanic_id: user.id,
      share_pct: 100,
    });
    setLoading(false);
    if (error) {
      alert("领单失败: " + error.message);
      return;
    }
    router.refresh();
    onClose();
  }

  async function handleCollaborateClaim() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert("未登录，无法领单");
      setLoading(false);
      return;
    }
    setMode("person");
    setSelectedPersons((prev) =>
      prev.includes(user.id) ? prev : [...prev, user.id]
    );
    setShowClaimChoice(false);
    setLoading(false);
  }

  async function handleClear() {
    if (!confirm("确定取消施工指派？")) return;
    setLoading(true);
    const { error } = await supabase
      .from("work_order_item_mechanics")
      .delete()
      .eq("work_order_item_id", itemId);
    setLoading(false);
    if (error) {
      alert("取消失败: " + error.message);
      return;
    }
    router.refresh();
    onClose();
  }

  async function handleSave() {
    setLoading(true);

    let mechanicIds: string[] = [];

    if (mode === "group" && selectedGroup) {
      const group = mechanicGroups.find((g) => g.id === selectedGroup);
      mechanicIds = group?.members.map((m) => m.mechanic_id) || [];
    } else {
      mechanicIds = selectedPersons;
    }

    if (mechanicIds.length === 0) {
      alert("请选择施工人");
      setLoading(false);
      return;
    }

    // 计算分成比例
    let ratios: Record<string, number> = {};
    if (commissionRule === "equal") {
      const ratio = 100 / mechanicIds.length;
      mechanicIds.forEach((id) => {
        ratios[id] = Math.round(ratio * 100) / 100;
      });
    } else if (commissionRule === "manual") {
      let total = 0;
      mechanicIds.forEach((id) => {
        const val = parseFloat(manualRatios[id]) || 0;
        ratios[id] = val;
        total += val;
      });
      if (Math.abs(total - 100) > 0.01) {
        alert(`分成比例合计为 ${total.toFixed(2)}%，必须为 100%`);
        setLoading(false);
        return;
      }
    } else {
      // 按技师等级分配：根据 commission_weight 加权
      const { data: levelData } = await supabase
        .from("profiles")
        .select("id, mechanic_levels(commission_weight)")
        .in("id", mechanicIds);
      const coeffMap: Record<string, number> = {};
      let totalCoeff = 0;
      (levelData || []).forEach((row: any) => {
        const c = row.mechanic_levels?.commission_weight || 1;
        coeffMap[row.id] = c;
        totalCoeff += c;
      });
      mechanicIds.forEach((id) => {
        const c = coeffMap[id] || 1;
        ratios[id] = Math.round((c / totalCoeff) * 100 * 100) / 100;
      });
      // 修正四舍五入误差，确保总和为100
      const sum = Object.values(ratios).reduce((a, b) => a + b, 0);
      if (sum !== 100 && mechanicIds.length > 0) {
        const diff = 100 - sum;
        ratios[mechanicIds[0]] = Math.round((ratios[mechanicIds[0]] + diff) * 100) / 100;
      }
    }

    // 删除旧记录
    await supabase.from("work_order_item_mechanics").delete().eq("work_order_item_id", itemId);

    // 插入新记录
    const records = mechanicIds.map((id) => ({
      work_order_item_id: itemId,
      mechanic_id: id,
      share_pct: ratios[id] ?? 100,
    }));

    const { error } = await supabase.from("work_order_item_mechanics").insert(records);
    setLoading(false);

    if (error) {
      alert("保存失败: " + error.message);
      return;
    }

    router.refresh();
    onClose();
  }

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 ${open ? "" : "hidden"}`}>
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">派工</h2>

        {showClaimChoice ? (
          <div className="space-y-6 py-8">
            <p className="text-sm text-gray-500 text-center">请选择领单方式</p>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={handleSoloClaim}
                disabled={loading}
                className="px-4 py-8 text-sm font-medium text-white bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50"
              >
                独立完成
              </button>
              <button
                type="button"
                onClick={handleCollaborateClaim}
                disabled={loading}
                className="px-4 py-8 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50"
              >
                与人合作
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowClaimChoice(false)}
              className="w-full px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              返回
            </button>
          </div>
        ) : (
          <>
            {/* 模式切换 */}
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setMode("person")}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${mode === "person" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
              >
                按人派工
              </button>
              <button
                type="button"
                onClick={() => setMode("group")}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${mode === "group" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
              >
                按组派工
              </button>
            </div>

            {/* 按人派工 */}
            {mode === "person" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">可多选</p>
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                  {profiles.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedPersons.includes(p.id)}
                        onChange={() => togglePerson(p.id)}
                      />
                      <span className="text-sm">{p.full_name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* 按组派工 */}
            {mode === "group" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">单选</p>
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                  {mechanicGroups.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">暂无施工组，请先创建</p>
                  )}
                  {mechanicGroups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="radio"
                        name="group"
                        checked={selectedGroup === g.id}
                        onChange={() => setSelectedGroup(g.id)}
                      />
                      <div>
                        <span className="text-sm font-medium">{g.name}</span>
                        <span className="text-xs text-gray-400 ml-2">
                          ({g.members.map((m) => m.profiles?.full_name || "-").join(", ")})
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* 多人施工时显示分成规则 */}
            {isMulti && (
              <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                <p className="text-sm font-medium text-yellow-800 mb-2">提成分配原则（共 {personCount} 人）</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="commission" checked={commissionRule === "equal"} onChange={() => setCommissionRule("equal")} />
                    <span>平均分配（每人 {Math.round(100 / personCount * 100) / 100}%）</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="commission" checked={commissionRule === "byLevel"} onChange={() => setCommissionRule("byLevel")} />
                    <span>按技师等级分配（系数越高分得越多）</span>
                  </label>
                  {commissionRule === "byLevel" && levelPreview.length > 0 && (
                    <div className="mt-2 ml-6 space-y-1 text-sm text-gray-600">
                      {levelPreview.map((p) => (
                        <div key={p.id} className="flex items-center gap-2">
                          <span className="flex-1">{p.name}</span>
                          <span className="text-xs text-gray-400">系数 {p.coeff}</span>
                          <span className="text-blue-700 font-medium">{p.ratio}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="commission" checked={commissionRule === "manual"} onChange={() => setCommissionRule("manual")} />
                    <span>手动输入分成比例</span>
                  </label>
                </div>
                {commissionRule === "manual" && (
                  <div className="mt-3 space-y-2">
                    {(mode === "group" && selectedGroup
                      ? mechanicGroups.find((g) => g.id === selectedGroup)?.members.map((m) => ({ id: m.mechanic_id, name: m.profiles?.full_name || "-" })) || []
                      : profiles.filter((p) => selectedPersons.includes(p.id)).map((p) => ({ id: p.id, name: p.full_name }))
                    ).map((m) => (
                      <div key={m.id} className="flex items-center gap-2">
                        <span className="text-sm flex-1">{m.name}</span>
                        <input
                          type="number"
                          className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="比例%"
                          value={manualRatios[m.id] || ""}
                          onChange={(e) => setManualRatios((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        />
                        <span className="text-xs text-gray-500">%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 按钮 */}
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">关闭</button>
              <button type="button" onClick={handleClear} disabled={loading} className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
                取消施工
              </button>
              <button type="button" onClick={() => setShowClaimChoice(true)} disabled={loading} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
                {loading ? "处理中..." : "领单"}
              </button>
              <button type="button" onClick={handleSave} disabled={loading} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {loading ? "保存中..." : "确定"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
