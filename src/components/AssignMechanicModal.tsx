"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "./ConfirmDialog";

interface Profile {
  id: string;
  full_name: string;
  is_mechanic?: boolean;
  group_name?: string | null;
  level_sort?: number; // 技师等级 sort_order，越大等级越高，无等级为 -1
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
  /* 保存成功后回调，传回新的施工人列表，由父组件更新显示，避免刷新整页（性能优化） */
  onSaved?: (mechanics: ExistingMechanic[]) => void;
}

export function AssignMechanicModal({ open, itemId, profiles, mechanicGroups, existingMechanics, onClose, onSaved }: Props) {
  const supabase = createClient();
  const [mode, setMode] = useState<"person" | "group">("person");
  const [selectedPersons, setSelectedPersons] = useState<string[]>(existingMechanics.map((m) => m.mechanic_id));
  const [personSearch, setPersonSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [commissionRule, setCommissionRule] = useState<"equal" | "byLevel" | "manual">("equal");
  const [manualRatios, setManualRatios] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [showClaimChoice, setShowClaimChoice] = useState(false);
  const [levelPreview, setLevelPreview] = useState<{ id: string; name: string; coeff: number; ratio: number }[]>([]);
  /* 并发保护：记录弹窗打开时的名单指纹，保存前再比对——
   * 防止两人同时派工，后保存的 delete+insert 无声覆盖先保存的 */
  const [打开时指纹, set打开时指纹] = useState("");

  /* 名单指纹：mechanic_id+分成 排序拼串，变任何一人或比例都会变 */
  function 名单指纹(list: { mechanic_id: string; share_pct?: number | null }[]): string {
    return list.map((m) => `${m.mechanic_id}:${m.share_pct ?? ""}`).sort().join("|");
  }

  /* 用一份名单初始化选中人和分成回显（打开时/冲突刷新时共用） */
  function 初始化选中与分成(名单: { mechanic_id: string; share_pct?: number | null }[]) {
    setSelectedPersons(名单.map((m) => m.mechanic_id));
    if (名单.length > 1) {
      const 均值 = 100 / 名单.length;
      const 是平均 = 名单.every((m) => Math.abs((m.share_pct ?? 0) - 均值) <= 0.5);
      if (是平均) {
        setCommissionRule("equal");
        setManualRatios({});
      } else {
        // 非平均分配：以手动模式回显已存具体比例（等级分配已落成数字，难以精确反推规则）
        setCommissionRule("manual");
        const ratios: Record<string, string> = {};
        名单.forEach((m) => {
          ratios[m.mechanic_id] = String(m.share_pct ?? 0);
        });
        setManualRatios(ratios);
      }
    } else {
      setCommissionRule("equal");
      setManualRatios({});
    }
  }

  useEffect(() => {
    if (!open) return;
    setSelectedGroup("");
    setShowClaimChoice(false);
    setLevelPreview([]);
    setPersonSearch("");
    /* 打开时实时读最新名单（不用 prop 快照——弹窗可能在别处已打开过一段时间） */
    supabase
      .from("work_order_item_mechanics")
      .select("mechanic_id, share_pct")
      .eq("work_order_item_id", itemId)
      .then(({ data }) => {
        const 最新 = (data || []) as { mechanic_id: string; share_pct: number | null }[];
        set打开时指纹(名单指纹(最新));
        /* 查询失败/为空时退回 prop 快照初始化 */
        初始化选中与分成(最新.length > 0 || data !== null ? 最新 : existingMechanics);
      });
  }, [open, itemId, supabase]);

  /* 保存前冲突校验：名单在弹窗打开期间被别人改过 → 拒绝保存并刷新为最新名单 */
  async function 校验名单未变(): Promise<boolean> {
    const { data } = await supabase
      .from("work_order_item_mechanics")
      .select("mechanic_id, share_pct")
      .eq("work_order_item_id", itemId);
    const 最新 = (data || []) as { mechanic_id: string; share_pct: number | null }[];
    if (名单指纹(最新) === 打开时指纹) return true;
    alert("施工名单刚被其他人修改，已为你刷新为最新名单，请确认后再保存");
    初始化选中与分成(最新);
    set打开时指纹(名单指纹(最新));
    return false;
  }

  const personCount = mode === "group" && selectedGroup
    ? (mechanicGroups.find((g) => g.id === selectedGroup)?.members.length || 0)
    : selectedPersons.length;

  const isMulti = personCount > 1;

  // 手动分成的成员列表（有序）：组模式取组员，人模式取所选人。顺序固定，
  // "最后一人"据此确定，用于自动补足与实时校验。
  const 分成成员 = useMemo(() => {
    if (mode === "group" && selectedGroup) {
      return (
        mechanicGroups.find((g) => g.id === selectedGroup)?.members.map((m) => ({
          id: m.mechanic_id,
          name: m.profiles?.full_name || "-",
        })) || []
      );
    }
    return profiles
      .filter((p) => selectedPersons.includes(p.id))
      .map((p) => ({ id: p.id, name: p.full_name }));
  }, [mode, selectedGroup, mechanicGroups, profiles, selectedPersons]);

  // "按人派工"列表排序优先级（从高到低）：
  //  1) 已选置顶  2) 有技师权限优先  3) 组优先：机修 > 钣金 > 喷漆 > 其它
  //  4) 技师等级高优先(sort_order 大在前)  5) 姓名拼音
  function 组优先级(name?: string | null): number {
    const n = name || "";
    if (n.includes("机修")) return 0;
    if (n.includes("钣金")) return 1;
    if (n.includes("喷漆")) return 2;
    return 3;
  }
  const 显示人员 = useMemo(() => {
    const kw = personSearch.trim().toLowerCase();
    const 过滤后 = kw
      ? profiles.filter((p) => (p.full_name || "").toLowerCase().includes(kw))
      : profiles;
    return [...过滤后].sort((a, b) => {
      const aSel = selectedPersons.includes(a.id) ? 0 : 1;
      const bSel = selectedPersons.includes(b.id) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel; // 已选置顶
      const aTech = a.is_mechanic ? 0 : 1;
      const bTech = b.is_mechanic ? 0 : 1;
      if (aTech !== bTech) return aTech - bTech; // 技师优先
      const ag = 组优先级(a.group_name);
      const bg = 组优先级(b.group_name);
      if (ag !== bg) return ag - bg; // 组优先：机修>钣金>喷漆>其它
      const al = a.level_sort ?? -1;
      const bl = b.level_sort ?? -1;
      if (al !== bl) return bl - al; // 技师等级高优先（sort_order 大在前）
      return (a.full_name || "").localeCompare(b.full_name || "", "zh-CN"); // 姓名拼音
    });
  }, [profiles, personSearch, selectedPersons]);

  // 手动分成：前面各人已填之和，及"最后一人"自动补足的剩余比例。
  const 手动前几人之和 = useMemo(() => {
    if (分成成员.length === 0) return 0;
    return 分成成员
      .slice(0, -1)
      .reduce((sum, m) => sum + (parseFloat(manualRatios[m.id]) || 0), 0);
  }, [分成成员, manualRatios]);

  // 前面几人是否已开始填写（有任一非空值）。没填时最后一人也留空等待，不预填 100。
  const 前面已开始填 = useMemo(
    () => 分成成员.slice(0, -1).some((m) => (manualRatios[m.id] ?? "").trim() !== ""),
    [分成成员, manualRatios]
  );

  // 最后一人自动补足值 = 100 - 前面之和（四舍五入到两位）
  const 最后一人补足 = Math.round((100 - 手动前几人之和) * 100) / 100;
  // 实时校验：前面之和超过 100（导致最后一人为负）即为非法
  const 手动比例超限 = 手动前几人之和 > 100 + 0.01;

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

      const rows = ((data || []) as unknown as { id: string; full_name: string; mechanic_levels?: { commission_weight: number } | null }[]).map((row) => ({
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
    /* 并发保护：领单前校验名单没被别人改过 */
    if (!(await 校验名单未变())) {
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
    // 写库成功后才通知父组件更新显示
    const fullName = profiles.find((p) => p.id === user.id)?.full_name || "-";
    onSaved?.([{ mechanic_id: user.id, share_pct: 100, profiles: { full_name: fullName } }]);
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
    if (!(await 请求确认("确定取消施工指派？"))) return;
    setLoading(true);
    /* 并发保护：取消前校验名单没被别人改过（别把别人刚派的也删了） */
    if (!(await 校验名单未变())) {
      setLoading(false);
      return;
    }
    const { error } = await supabase
      .from("work_order_item_mechanics")
      .delete()
      .eq("work_order_item_id", itemId);
    setLoading(false);
    if (error) {
      alert("取消失败: " + error.message);
      return;
    }
    onSaved?.([]);
    onClose();
  }

  async function handleSave() {
    setLoading(true);

    /* 并发保护：保存前校验名单没被别人改过（防后保存覆盖先保存） */
    if (!(await 校验名单未变())) {
      setLoading(false);
      return;
    }

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
    const ratios: Record<string, number> = {};
    if (commissionRule === "equal") {
      const ratio = 100 / mechanicIds.length;
      mechanicIds.forEach((id) => {
        ratios[id] = Math.round(ratio * 100) / 100;
      });
    } else if (commissionRule === "manual") {
      // 前面各人用输入值，最后一人自动补足剩余，保证合计恰为 100。
      // 顺序以 分成成员 为准（与界面显示一致）。
      const 有序 = 分成成员.map((m) => m.id).filter((id) => mechanicIds.includes(id));
      const 前几人之和 = 有序
        .slice(0, -1)
        .reduce((sum, id) => sum + (parseFloat(manualRatios[id]) || 0), 0);
      if (前几人之和 > 100 + 0.01) {
        alert(`前几人分成合计已达 ${前几人之和.toFixed(2)}%，超过 100%，请调整`);
        setLoading(false);
        return;
      }
      有序.forEach((id, idx) => {
        if (idx === 有序.length - 1) {
          // 最后一人 = 剩余
          ratios[id] = Math.round((100 - 前几人之和) * 100) / 100;
        } else {
          ratios[id] = parseFloat(manualRatios[id]) || 0;
        }
      });
    } else {
      // 按技师等级分配：根据 commission_weight 加权
      const { data: levelData } = await supabase
        .from("profiles")
        .select("id, mechanic_levels(commission_weight)")
        .in("id", mechanicIds);
      const coeffMap: Record<string, number> = {};
      let totalCoeff = 0;
      ((levelData || []) as unknown as { id: string; mechanic_levels?: { commission_weight: number } | null }[]).forEach((row) => {
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

    // 写库成功后才通知父组件更新显示
    onSaved?.(
      mechanicIds.map((id) => ({
        mechanic_id: id,
        share_pct: ratios[id] ?? 100,
        profiles: { full_name: profiles.find((p) => p.id === id)?.full_name || "-" },
      }))
    );
    onClose();
  }

  return (
    /* 根元素必须阻断点击冒泡：本弹窗在工单卡片（整卡可点击跳转详情页）内复用时，
     * 弹窗内的任何点击都会冒泡到卡片 onClick 导致误跳转详情页 */
    <div
      onClick={(e) => e.stopPropagation()}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 ${open ? "" : "hidden"}`}
    >
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
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">可多选（已选 {selectedPersons.length} 人）</p>
                </div>
                <input
                  type="text"
                  value={personSearch}
                  onChange={(e) => setPersonSearch(e.target.value)}
                  placeholder="搜索姓名"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                />
                <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                  {显示人员.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">没有匹配的人员</p>
                  )}
                  {显示人员.map((p) => (
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
                    <p className="text-xs text-gray-500">只需填前面几人，最后一人自动补足剩余</p>
                    {分成成员.map((m, idx) => {
                      const 是最后一人 = idx === 分成成员.length - 1;
                      return (
                        <div key={m.id} className="flex items-center gap-2">
                          <span className="text-sm flex-1">{m.name}</span>
                          {是最后一人 ? (
                            <input
                              type="number"
                              readOnly
                              disabled
                              className="w-16 px-1.5 py-1 border border-gray-200 bg-white rounded text-xs text-right text-gray-600 placeholder:text-xs"
                              placeholder="自动"
                              value={!前面已开始填 || 手动比例超限 ? "" : 最后一人补足}
                              title="最后一人自动补足剩余比例"
                            />
                          ) : (
                            <input
                              type="number"
                              className="w-16 px-1.5 py-1 border border-gray-300 rounded text-xs text-right bg-white placeholder:text-xs"
                              placeholder="输入比例"
                              value={manualRatios[m.id] || ""}
                              onChange={(e) => setManualRatios((prev) => ({ ...prev, [m.id]: e.target.value }))}
                            />
                          )}
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                      );
                    })}
                    {手动比例超限 ? (
                      <p className="text-xs text-red-600">前面几人合计已达 {手动前几人之和.toFixed(2)}%，超过 100%，请调小</p>
                    ) : 前面已开始填 ? (
                      <p className="text-xs text-gray-500">
                        前面合计 {手动前几人之和.toFixed(2)}%，最后一人 {最后一人补足.toFixed(2)}%
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400">从上往下填写前面几人的比例，最后一人自动补足</p>
                    )}
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
              <button type="button" onClick={handleSave} disabled={loading || (isMulti && commissionRule === "manual" && 手动比例超限)} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {loading ? "保存中..." : "确定"}
              </button>
            </div>
          </>
        )}
        {确认弹窗}
      </div>
    </div>
  );
}
