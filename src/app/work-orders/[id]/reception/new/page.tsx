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
  const [notes, setNotes] = useState("");

  useEffect(() => {
    params.then((p) => setOrderId(p.id));
  }, [params]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId) return;
    setLoading(true);

    try {
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
          <h2 className="text-base font-semibold text-gray-900 mb-4">环车检查视频</h2>
          <VideoUploader onUpload={setVideoPaths} maxVideos={3} />
        </section>

        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">外观照片</h2>
          <ImageUploader onUpload={setExteriorPaths} maxImages={8} />
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
