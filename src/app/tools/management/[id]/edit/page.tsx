"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { ImageUploader } from "@/components/ImageUploader";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { 更新工具 } from "@/app/tools/actions";

const BlockNoteEditor = dynamic(
  () => import("@/components/BlockNoteEditor").then((mod) => mod.BlockNoteEditor),
  { ssr: false }
);

interface 工具 {
  id: string;
  code: string;
  location: string | null;
}

export default function EditToolPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = useMemo(() => createClient(), []);
  const [加载中, set加载中] = useState(true);
  const [保存中, set保存中] = useState(false);
  const [图片地址, set图片地址] = useState<string[]>([]);

  const [表单, set表单] = useState({
    code: "",
    name: "",
    instructions: "",
    location: "",
    status: "available",
    require_return_photos: false,
    require_location_scan: false,
  });
  const [位置列表, set位置列表] = useState<工具[]>([]);
  const [使用新位置, set使用新位置] = useState(false);
  const [新位置, set新位置] = useState("");

  /* 加载 */
  useEffect(() => {
    async function 加载() {
      try {
        const [toolRes, locsRes] = await Promise.all([
          supabase.from("tools").select("*").eq("id", id).single(),
          supabase.from("tools").select("id, code, location").not("location", "is", null),
        ]);

        const { data: tool } = toolRes;
        if (!tool) { alert("工具不存在"); router.push("/tools/management"); return; }

        set表单({
          code: tool.code || "",
          name: tool.name || "",
          instructions: tool.instructions || "",
          location: tool.location || "",
          status: tool.status || "available",
          require_return_photos: tool.require_return_photos || false,
          require_location_scan: tool.require_location_scan || false,
        });
        set图片地址(tool.image_url ? tool.image_url.split(",").filter(Boolean) : []);

        const 去重 = new Map<string, 工具>();
        for (const row of locsRes.data || []) {
          if (row.location && !去重.has(row.location) && row.location !== tool.location) {
            去重.set(row.location, row);
          }
        }
        set位置列表(Array.from(去重.values()));
      } finally {
        set加载中(false);
      }
    }
    加载();
  }, [id, supabase, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = 表单.code.trim();
    const name = 表单.name.trim();
    if (!code || !name) { alert("请填写工具编码和名称"); return; }

    set保存中(true);
    const finalLocation = 使用新位置 ? 新位置.trim() : 表单.location.trim();

    try {
      /* 保存走 Server Action：编码唯一性服务端兜底（排除自己） */
      const result = await 更新工具(id, {
        code,
        name,
        imageUrl: 图片地址.length > 0 ? 图片地址.join(",") : null,
        instructions: 表单.instructions,
        location: finalLocation,
        status: 表单.status,
        requireReturnPhotos: 表单.require_return_photos,
        requireLocationScan: 表单.require_location_scan,
      });

      if (!result.success) {
        alert("保存失败: " + (result.error || "未知错误"));
        set保存中(false);
        return;
      }
      router.push(`/tools/management/${id}`);
      router.refresh();
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
      set保存中(false);
    }
  }

  return (
    <div>
      <PageHeader title="编辑工具" />
      {加载中 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">加载中...</div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl">
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">工具编码 *</label>
                <input required className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" value={表单.code} onChange={(e) => set表单({ ...表单, code: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">工具名称 *</label>
                <input required className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" value={表单.name} onChange={(e) => set表单({ ...表单, name: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">状态</label>
              <select className="w-full sm:w-auto px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" value={表单.status} onChange={(e) => set表单({ ...表单, status: e.target.value })}>
                <option value="available">可用</option>
                <option value="in_use">使用中</option>
                <option value="maintenance">维护中</option>
              </select>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">归还验收设置</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={表单.require_return_photos}
                  onChange={(e) => set表单({ ...表单, require_return_photos: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">归还时需拍照验收（确认齐全及摆放规范）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={表单.require_location_scan}
                  onChange={(e) => set表单({ ...表单, require_location_scan: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">归还需扫描仓位码（10秒内完成）</span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">存放位置</label>
              {位置列表.length > 0 && !使用新位置 ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <select className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" value={表单.location} onChange={(e) => set表单({ ...表单, location: e.target.value })}>
                    <option value="">不选</option>
                    {位置列表.map((t) => (
                      <option key={t.code} value={t.location || ""}>{t.location}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => { set使用新位置(true); set新位置(""); }} className="px-4 py-2.5 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">新位置</button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" placeholder="输入新位置" value={使用新位置 ? 新位置 : 表单.location} onChange={(e) => 使用新位置 ? set新位置(e.target.value) : set表单({ ...表单, location: e.target.value })} />
                  {位置列表.length > 0 && (
                    <button type="button" onClick={() => { set使用新位置(false); set新位置(""); }} className="px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">选已有位置</button>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">工具图片</label>
              <ImageUploader
                onUpload={(paths) => set图片地址(paths)}
                onDelete={(path) => set图片地址((prev) => prev.filter((p) => p !== path))}
                existingImages={图片地址}
                maxImages={10}
                disableCamera
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">工具说明</label>
              <BlockNoteEditor
                initialValue={表单.instructions}
                onChange={(json) => set表单({ ...表单, instructions: json })}
              />
            </div>
          </div>

          <div className="mt-8 flex gap-3 justify-end">
            <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            <button type="submit" disabled={保存中} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{保存中 ? "保存中..." : "保存"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
