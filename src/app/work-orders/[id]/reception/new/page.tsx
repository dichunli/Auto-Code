"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";
import { VideoUploader } from "@/components/VideoUploader";

export default function NewReceptionPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);

  const [videoPaths, setVideoPaths] = useState<string[]>([]);
  const [exteriorPaths, setExteriorPaths] = useState<string[]>([]);
  const [dashboardPaths, setDashboardPaths] = useState<string[]>([]);
  const [mileage, setMileage] = useState("");
  const [notes, setNotes] = useState("");
  const [inspectorName, setInspectorName] = useState("");

  useEffect(() => {
    params.then((p) => setOrderId(p.id));
  }, [params]);

  // 加载工单当前里程
  useEffect(() => {
    if (!orderId) return;
    supabase
      .from("work_orders")
      .select("mileage_in")
      .eq("id", orderId)
      .single()
      .then(({ data }) => {
        if (data?.mileage_in != null) {
          setMileage(String(data.mileage_in));
        }
      });
  }, [orderId, supabase]);

  // 获取当前用户信息作为检查人
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        supabase
          .from("profiles")
          .select("full_name")
          .eq("id", data.user.id)
          .single()
          .then(({ data: profile }) => {
            if (profile?.full_name) {
              setInspectorName(profile.full_name);
            }
          });
      }
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId) return;
    setLoading(true);

    try {
      /* 统一更新工单里程（唯一的里程数据源） */
      if (mileage) {
        const { error: orderError } = await supabase
          .from("work_orders")
          .update({ mileage_in: parseFloat(mileage) })
          .eq("id", orderId);
        if (orderError) throw orderError;
      }

      const { data: inspection, error: inspectionError } = await supabase
        .from("work_order_inspections")
        .insert({
          work_order_id: orderId,
          inspection_type: "reception",
          notes: notes || null,
        })
        .select("id")
        .single();

      if (inspectionError || !inspection) throw inspectionError || new Error("创建接车检查失败");

      const mediaRecords: any[] = [];
      videoPaths.forEach((path) => {
        mediaRecords.push({
          inspection_id: inspection.id,
          media_type: "reception_video",
          storage_path: path,
        });
      });
      exteriorPaths.forEach((path) => {
        mediaRecords.push({
          inspection_id: inspection.id,
          media_type: "exterior",
          storage_path: path,
        });
      });
      dashboardPaths.forEach((path) => {
        mediaRecords.push({
          inspection_id: inspection.id,
          media_type: "dashboard",
          storage_path: path,
        });
      });

      if (mediaRecords.length > 0) {
        const { error: mediaError } = await supabase.from("work_order_inspection_media").insert(mediaRecords);
        if (mediaError) throw mediaError;
      }

      router.push(`/work-orders/${orderId}`);
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="接车检查" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl space-y-8">
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-4">当前里程</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 w-1/2 sm:w-48">
              <input
                type="text"
                inputMode="numeric"
                value={mileage}
                onChange={(e) => setMileage(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="请输入里程"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500 shrink-0">km</span>
            </div>
            <div className="ml-auto text-sm text-gray-500">
              检查人：<span className="text-gray-900">{inspectorName || "-"}</span>
            </div>
          </div>
        </section>

        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">仪表照片</h2>
          <ImageUploader onUpload={setDashboardPaths} maxImages={3} />
        </section>

        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">外观照片</h2>
          <ImageUploader onUpload={setExteriorPaths} maxImages={8} />
        </section>

        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">环车检查视频</h2>
          <VideoUploader onUpload={setVideoPaths} maxVideos={3} />
        </section>

        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">接车备注</h2>
          <textarea
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            placeholder="如：左前保险杠划痕、车内物品清单..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </section>

        <div className="flex gap-3 justify-end pt-4 border-t border-gray-100">
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
            {loading ? "保存中..." : "保存接车检查"}
          </button>
        </div>
      </form>
    </div>
  );
}
