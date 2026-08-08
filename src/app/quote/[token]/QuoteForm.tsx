"use client";

import { useEffect, useRef, useState, Fragment } from "react";
import { 按编码查配件, 按编码搜配件, 提交报价, 更新报价图片, 添加供应商分支, 删除供应商分支, type 询价单公开信息 } from "../actions";
import { 压缩图片 } from "@/lib/imageCompress";
import { useDebounce } from "@/lib/useDebounce";

/* 供应商报价表单（桌面表格样式，与采购管理"待询价"列表同格式）
 * 所有行一直保持可编辑，供应商填完直接提交；"+分支"给同一配件加备选报价（多品牌/多价格），
 * 同配件的分支底色相同；只能删除自己加的分支，我们提供的行不可删。
 * 采购员采用后整单锁死只读 */

interface 行状态 {
  itemId: string;
  partName: string;
  quantity: number | null;
  unit: string;
  vehicleModel: string;
  plate: string;
  vin: string;
  partNumber: string;
  brand: string;
  spec: string;
  price: string;
  notes: string;
  images: string[];
  /* 供应商自己加的备选分支（可删除；我们提供的行不可删） */
  isSupplierAdded: boolean;
  /* 编码匹配反馈：matched=系统有这个编码 / none=没有 / ""=还没查；matchDoc=匹配到的采购单名称 */
  matchHint: "" | "matched" | "none";
  matchDoc: string;
}

/* 编码联想候选（模糊搜索配件库的结果） */
interface 配件候选 {
  partId: string;
  name: string;
  partNumber: string;
  brand: string;
  spec: string;
  unit: string;
  documentName: string;
}

interface Props {
  token: string;
  初始数据: 询价单公开信息;
}

/* 复制 VIN 到剪贴板（clipboard API 失败时回退 execCommand） */
async function 复制文本(文本: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(文本);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = 文本;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function QuoteForm({ token, 初始数据 }: Props) {
  const 只读 = 初始数据.status === "adopted";
  const [行列表, set行列表] = useState<行状态[]>(
    初始数据.items.map((i) => ({
      itemId: i.itemId,
      partName: i.partName,
      quantity: i.quantity,
      unit: i.unit,
      vehicleModel: i.vehicleModel,
      plate: i.plate,
      vin: i.vin,
      partNumber: i.quotedPartNumber,
      brand: i.quotedBrand,
      spec: i.quotedSpec,
      price: i.quotedPrice,
      notes: i.quotedNotes,
      images: i.quotedImages,
      isSupplierAdded: i.isSupplierAdded,
      matchHint: "",
      matchDoc: "",
    }))
  );
  const [提交中, set提交中] = useState(false);
  const [提交成功, set提交成功] = useState(初始数据.status === "submitted");
  const [上传中, set上传中] = useState<string | null>(null); // 正在上传图片的 itemId
  const [预览图, set预览图] = useState<string | null>(null);
  const [复制成功, set复制成功] = useState<string | null>(null); // 刚复制过的 VIN
  const 文件输入Refs = useRef<Record<string, HTMLInputElement | null>>({});
  /* 编码联想：当前聚焦编码框的行 + 候选列表（输入防抖后模糊搜配件库） */
  const [联想行, set联想行] = useState<string | null>(null);
  const [候选, set候选] = useState<配件候选[]>([]);
  const 联想词 = useDebounce(联想行 ? (行列表.find((r) => r.itemId === 联想行)?.partNumber || "") : "", 300);

  /* 联想词稳定后查候选；带竞态取消（输入快时旧响应直接丢弃） */
  useEffect(() => {
    const 词 = 联想词.trim();
    if (!联想行 || 词.length < 2) {
      set候选([]);
      return;
    }
    let 已取消 = false;
    按编码搜配件(token, 词)
      .then((res) => {
        if (已取消) return;
        if (res.success && res.data) set候选(res.data);
        else set候选([]);
      })
      .catch(() => {
        if (!已取消) set候选([]);
      });
    return () => {
      已取消 = true;
    };
  }, [联想词, 联想行, token]);

  /* +分支：供应商给同一配件加备选报价（服务端建行后本地追加，继承源行车牌/VIN 分组） */
  async function 加分支(源行: 行状态) {
    const r = await 添加供应商分支(token, 源行.itemId);
    if (!r.success || !r.item) {
      alert("添加分支失败: " + (r.error || "未知错误"));
      return;
    }
    const 新行: 行状态 = {
      itemId: r.item.itemId,
      partName: r.item.partName,
      quantity: r.item.quantity,
      unit: r.item.unit,
      vehicleModel: r.item.vehicleModel,
      plate: 源行.plate,
      vin: 源行.vin,
      partNumber: "",
      brand: "",
      spec: "",
      price: "",
      notes: "",
      images: [],
      isSupplierAdded: true,
      matchHint: "",
      matchDoc: "",
    };
    set行列表((prev) => [...prev, 新行]);
  }

  /* 删除供应商自己加的分支 */
  async function 删分支(itemId: string) {
    if (!confirm("确定删除这条备选报价吗？")) return;
    const r = await 删除供应商分支(token, itemId);
    if (!r.success) {
      alert("删除失败: " + (r.error || "未知错误"));
      return;
    }
    set行列表((prev) => prev.filter((x) => x.itemId !== itemId));
  }

  function 改行(itemId: string, 字段: "partNumber" | "brand" | "spec" | "price" | "notes", 值: string) {
    set行列表((prev) =>
      prev.map((r) => (r.itemId === itemId ? { ...r, [字段]: 值, ...(字段 === "partNumber" ? { matchHint: "" as const } : {}) } : r))
    );
  }

  async function 复制VIN(vin: string) {
    if (await 复制文本(vin)) {
      set复制成功(vin);
      setTimeout(() => set复制成功(null), 1500);
    } else {
      alert("复制失败，请手动长按复制：" + vin);
    }
  }

  /* 点选联想候选：编码/品牌/规格一次填好，收起浮层 */
  function 选中候选(itemId: string, c: 配件候选) {
    set行列表((prev) =>
      prev.map((r) =>
        r.itemId === itemId
          ? {
              ...r,
              partNumber: c.partNumber || r.partNumber,
              brand: c.brand || r.brand,
              spec: c.spec || r.spec,
              matchHint: "matched" as const,
              matchDoc: c.documentName,
            }
          : r
      )
    );
    set候选([]);
    set联想行(null);
  }

  /* 编码失焦：查系统配件库，带出品牌/规格/单据名（不带价格，价格供应商自己填） */
  async function 编码失焦(itemId: string) {
    const 行 = 行列表.find((r) => r.itemId === itemId);
    if (!行 || !行.partNumber.trim()) return;
    try {
      const 结果 = await 按编码查配件(token, 行.partNumber);
      set行列表((prev) =>
        prev.map((r) => {
          if (r.itemId !== itemId) return r;
          if (结果.success && 结果.data) {
            return {
              ...r,
              partNumber: 结果.data.partNumber || r.partNumber,
              brand: r.brand || 结果.data.brand,
              spec: r.spec || 结果.data.spec,
              matchHint: "matched" as const,
              matchDoc: 结果.data.documentName || "",
            };
          }
          return { ...r, matchHint: "none" as const, matchDoc: "" };
        })
      );
    } catch {
      /* 查询失败不打扰填价 */
    }
  }

  /* 上传图片：压缩 → 凭 token 走 /api/upload（存 quote/ 目录）→ 立即保存到明细 */
  async function 上传图片(itemId: string, file: File) {
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件");
      return;
    }
    set上传中(itemId);
    try {
      const compressed = await 压缩图片(file);
      const formData = new FormData();
      formData.append("file", compressed, file.name);
      const res = await fetch(`/api/upload?quote_token=${encodeURIComponent(token)}`, {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "上传失败");
      const 新路径 = result.path as string;

      const 行 = 行列表.find((r) => r.itemId === itemId);
      const 新图片 = [...(行?.images || []), 新路径];
      set行列表((prev) => prev.map((r) => (r.itemId === itemId ? { ...r, images: 新图片 } : r)));
      const 保存 = await 更新报价图片(token, itemId, 新图片);
      if (!保存.success) alert("图片保存失败: " + (保存.error || "未知错误"));
    } catch (err: unknown) {
      alert("图片上传失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      set上传中(null);
    }
  }

  /* 删除图片：立即从明细移除 */
  async function 删除图片(itemId: string, idx: number) {
    const 行 = 行列表.find((r) => r.itemId === itemId);
    if (!行) return;
    const 新图片 = 行.images.filter((_, i) => i !== idx);
    set行列表((prev) => prev.map((r) => (r.itemId === itemId ? { ...r, images: 新图片 } : r)));
    const 保存 = await 更新报价图片(token, itemId, 新图片);
    if (!保存.success) alert("删除失败: " + (保存.error || "未知错误"));
  }

  async function 提交() {
    /* 前端先校验：每行都要填采购价 */
    for (const r of 行列表) {
      const 价 = Number(r.price);
      if (!r.price.trim() || !Number.isFinite(价) || 价 <= 0) {
        alert(`「${r.partName}」还没填采购价，每行都要填`);
        return;
      }
    }
    set提交中(true);
    try {
      const 结果 = await 提交报价(
        token,
        行列表.map((r) => ({
          itemId: r.itemId,
          partNumber: r.partNumber,
          brand: r.brand,
          spec: r.spec,
          price: r.price,
          notes: r.notes,
        }))
      );
      set提交中(false);
      if (!结果.success) {
        alert("提交失败: " + (结果.error || "未知错误"));
        return;
      }
      set提交成功(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: unknown) {
      set提交中(false);
      alert("提交失败: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  const 截止时间 = new Date(初始数据.expiresAt).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  /* 按车牌分组（同车配件归一组，组头显示醒目 VIN + 复制按钮）；组内按配件名排序让同配件分支相邻 */
  const 分组: { key: string; plate: string; vin: string; rows: 行状态[] }[] = [];
  for (const r of 行列表) {
    const key = r.plate || r.vin || "未识别车辆";
    const g = 分组.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else 分组.push({ key, plate: r.plate, vin: r.vin, rows: [r] });
  }
  for (const g of 分组) {
    g.rows.sort((a, b) => a.partName.localeCompare(b.partName, "zh-CN") || (a.isSupplierAdded ? 1 : 0) - (b.isSupplierAdded ? 1 : 0));
  }

  /* 同配件的分支行底色相同（按配件名轮换浅色，避开黄色——黄色是草稿占用色） */
  const 分支底色 = ["bg-blue-50/40", "bg-green-50/40", "bg-purple-50/40", "bg-gray-50"];

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-6xl mx-auto">
        {/* 头部：供应商称呼醒目大字 */}
        <div className="bg-blue-600 text-white px-5 py-6">
          <div className="text-xl font-bold">{初始数据.supplierName} 您好！</div>
          <div className="text-blue-100 text-sm mt-1">
            请为以下 {行列表.length} 个配件报价（配件报价单）
          </div>
        </div>

        {/* 状态横幅 */}
        {只读 && (
          <div className="mx-4 mt-4 rounded-xl bg-gray-100 border border-gray-200 px-4 py-3 text-sm text-gray-600 text-center">
            该报价已被采购员采用，不能再修改。感谢您的配合！
          </div>
        )}
        {提交成功 && !只读 && (
          <div className="mx-4 mt-4 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 text-center">
            ✅ 报价已提交。如需修改，直接改完重新提交即可
          </div>
        )}
        {!只读 && (
          <div className="mx-4 mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-700 text-center">
            请于 {截止时间} 前提交，过期链接将失效
          </div>
        )}

        {/* 表格（桌面端格式，与采购管理"待询价"一致；手机上可左右滑动） */}
        <div className="mx-4 mt-4 bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-xs min-w-[1000px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50">编码</th>
                <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50">配件</th>
                <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50">品牌</th>
                <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50">规格</th>
                <th className="px-2 py-2 text-right font-bold text-gray-700 sticky top-0 bg-gray-50">数量</th>
                {/* 对供应商来说这是他们的销售价（我们系统里记为采购价） */}
                <th className="px-2 py-2 text-right font-bold text-gray-700 sticky top-0 bg-gray-50">销售价</th>
                <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50">备注</th>
                <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50">图片</th>
                <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {分组.map((g) => {
                let 色序 = -1;
                return (
                <Fragment key={`grp-${g.key}`}>
                  {/* 组头：隐藏车牌，VIN 放大加粗 + 复制按钮（无 VIN 时兜底显示车牌） */}
                  <tr key={`grp-${g.key}`} className="bg-gray-200">
                    <td colSpan={9} className="px-3 py-2">
                      {g.vin ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-sm font-bold text-gray-900 font-mono">VIN:{g.vin}</span>
                          <button
                            type="button"
                            onClick={() => 复制VIN(g.vin)}
                            className="px-1.5 py-0.5 text-[11px] rounded border border-blue-300 text-blue-600 bg-white hover:bg-blue-50"
                          >
                            {复制成功 === g.vin ? "✓ 已复制" : "复制"}
                          </button>
                        </span>
                      ) : (
                        <span className="text-sm font-bold text-gray-900">{g.plate || "未识别车辆"}</span>
                      )}
                    </td>
                  </tr>
                  {g.rows.map((r, 行idx) => {
                    /* 同配件（含供应商备选分支）用同一底色 */
                    if (行idx === 0 || g.rows[行idx - 1].partName !== r.partName) 色序++;
                    const 行底色 = 分支底色[色序 % 分支底色.length];
                    /* 所有行一直可编辑；采购员采用后整单锁死只读 */
                    const 行只读 = 只读;
                    return (
                    <tr key={r.itemId} className={`${行底色} hover:bg-gray-50`}>
                      {/* 编码（输入联想候选，点选带出品牌规格；失焦精确查兜底） */}
                      <td className="px-2 py-2">
                        <div className="relative">
                          <input
                            type="text"
                            disabled={行只读}
                            value={r.partNumber}
                            onChange={(e) => 改行(r.itemId, "partNumber", e.target.value)}
                            onFocus={() => {
                              if (!行只读) set联想行(r.itemId);
                            }}
                            onBlur={() => {
                              编码失焦(r.itemId);
                              /* 延迟收起：让点选候选的点击先完成 */
                              setTimeout(() => {
                                set联想行((cur) => (cur === r.itemId ? null : cur));
                                set候选([]);
                              }, 200);
                            }}
                            placeholder="编码/条码"
                            className="w-28 px-2 py-1 text-xs rounded border border-gray-300 bg-white placeholder:text-gray-400 hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:bg-transparent disabled:text-gray-700"
                          />
                          {联想行 === r.itemId && 候选.length > 0 && (
                            <div className="absolute left-0 top-full mt-1 z-20 w-64 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                              {候选.map((c) => (
                                <button
                                  key={c.partId}
                                  type="button"
                                  onClick={() => 选中候选(r.itemId, c)}
                                  className="w-full text-left px-2 py-1.5 hover:bg-blue-50 border-b border-gray-50 last:border-b-0"
                                >
                                  <span className="font-mono font-semibold text-gray-900">{c.partNumber}</span>
                                  <span className="ml-1.5 text-gray-500">{c.name}</span>
                                  {(c.brand || c.spec) && (
                                    <span className="block text-[10px] text-gray-400">
                                      {[c.brand, c.spec].filter(Boolean).join(" / ")}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {r.matchHint === "matched" && (
                          <div className="text-[10px] text-green-600 mt-0.5">✓ 已匹配系统配件{r.matchDoc && `（单据名：${r.matchDoc}）`}</div>
                        )}
                        {r.matchHint === "none" && (
                          <div className="text-[10px] text-gray-400 mt-0.5">编码不在配件库，按填写保存</div>
                        )}
                      </td>
                      {/* 配件名（不显示车型——供应商只需要知道配件叫什么） */}
                      <td className="px-2 py-2 text-gray-900 font-medium">
                        {r.partName}
                        {r.isSupplierAdded && (
                          <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700">备选</span>
                        )}
                      </td>
                      {/* 品牌 */}
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          disabled={行只读}
                          value={r.brand}
                          onChange={(e) => 改行(r.itemId, "brand", e.target.value)}
                          placeholder="品牌（选填）"
                          className="w-24 px-2 py-1 text-xs rounded border border-gray-300 bg-white placeholder:text-gray-400 hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:bg-transparent disabled:text-gray-700"
                        />
                      </td>
                      {/* 规格 */}
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          disabled={行只读}
                          value={r.spec}
                          onChange={(e) => 改行(r.itemId, "spec", e.target.value)}
                          placeholder="规格（选填）"
                          className="w-24 px-2 py-1 text-xs rounded border border-gray-300 bg-white placeholder:text-gray-400 hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:bg-transparent disabled:text-gray-700"
                        />
                      </td>
                      {/* 数量（只读快照，未填显示—） */}
                      <td className="px-2 py-2 text-right text-gray-700">
                        {r.quantity ?? "—"} {r.unit}
                      </td>
                      {/* 销售价（对供应商而言；必填，空时红框提示） */}
                      <td className="px-2 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-gray-400">¥</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            disabled={行只读}
                            value={r.price}
                            onChange={(e) => 改行(r.itemId, "price", e.target.value)}
                            placeholder="必填"
                            className={`w-20 px-2 py-1 text-right text-xs rounded border placeholder:text-gray-400 hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:bg-transparent disabled:text-gray-700 ${
                              !r.price.trim() && !行只读 ? "border-red-400 bg-red-50" : "border-gray-300 bg-white"
                            }`}
                          />
                          <span className="text-gray-400">/{r.unit}</span>
                        </div>
                      </td>
                      {/* 备注 */}
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          disabled={行只读}
                          value={r.notes}
                          onChange={(e) => 改行(r.itemId, "notes", e.target.value)}
                          placeholder="备注（选填，如货期、替代品牌）"
                          className="w-44 px-2 py-1 text-xs rounded border border-gray-300 bg-white placeholder:text-gray-400 hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:bg-transparent disabled:text-gray-700"
                        />
                      </td>
                      {/* 图片（点开看大图、可加可删） */}
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          {r.images.map((p, idx) => (
                            <div key={p} className="relative w-10 h-10 rounded border border-gray-100 overflow-hidden">
                              <img
                                src={p}
                                alt=""
                                className="w-full h-full object-cover cursor-pointer"
                                loading="lazy"
                                onClick={() => set预览图(p)}
                              />
                              {!只读 && (
                                <button
                                  type="button"
                                  title="删除此图"
                                  onClick={() => 删除图片(r.itemId, idx)}
                                  className="absolute top-0 right-0 w-3.5 h-3.5 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                          {!只读 && (
                            <>
                              <button
                                type="button"
                                title="添加图片"
                                disabled={上传中 === r.itemId}
                                onClick={() => 文件输入Refs.current[r.itemId]?.click()}
                                className="w-10 h-10 rounded border border-dashed border-gray-300 text-gray-400 flex items-center justify-center text-sm hover:border-blue-400 hover:text-blue-500 disabled:opacity-50"
                              >
                                {上传中 === r.itemId ? "…" : "+"}
                              </button>
                              <input
                                ref={(el) => { 文件输入Refs.current[r.itemId] = el; }}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) void 上传图片(r.itemId, f);
                                  e.target.value = "";
                                }}
                              />
                            </>
                          )}
                        </div>
                      </td>
                      {/* 操作：+分支报备选 / 删除（仅自己加的分支可删） */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        {!只读 && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => 加分支(r)}
                              className="text-xs text-green-600 hover:text-green-700"
                            >
                              +分支
                            </button>
                            {r.isSupplierAdded && (
                              <button
                                type="button"
                                onClick={() => 删分支(r.itemId)}
                                className="text-xs text-red-500 hover:text-red-600"
                              >
                                删除
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 提交按钮（吸底） */}
        {!只读 && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4">
            <div className="max-w-6xl mx-auto">
              <button
                type="button"
                onClick={提交}
                disabled={提交中}
                className="w-full py-3.5 text-lg font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {提交中 ? "提交中..." : 提交成功 ? "重新提交报价" : "提交报价"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 图片大图预览（点任意处关闭） */}
      {预览图 && (
        <div
          className="fixed inset-0 z-[130] bg-black/80 flex items-center justify-center p-4"
          onClick={() => set预览图(null)}
        >
          <img src={预览图} alt="" className="max-w-full max-h-full object-contain rounded" />
        </div>
      )}
    </div>
  );
}
