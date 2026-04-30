"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";
import { ImageAnnotator } from "@/components/ImageAnnotator";

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const LIGHT_ITEMS = [
  { key: "left_headlight", label: "左前大灯" },
  { key: "right_headlight", label: "右前大灯" },
  { key: "left_tail_light", label: "左后尾灯" },
  { key: "right_tail_light", label: "右后尾灯" },
  { key: "left_turn_front", label: "左前转向灯" },
  { key: "right_turn_front", label: "右前转向灯" },
  { key: "left_turn_rear", label: "左后转向灯" },
  { key: "right_turn_rear", label: "右后转向灯" },
  { key: "brake_light", label: "刹车灯" },
  { key: "reverse_light", label: "倒车灯" },
  { key: "fog_light", label: "雾灯" },
  { key: "license_plate_light", label: "牌照灯" },
  { key: "interior_light", label: "室内灯" },
];

const FAULT_LIGHT_ITEMS = [
  { key: "engine", label: "发动机故障灯" },
  { key: "abs", label: "ABS灯" },
  { key: "airbag", label: "气囊灯" },
  { key: "oil_pressure", label: "机油压力灯" },
  { key: "battery", label: "电池灯" },
  { key: "coolant", label: "水温报警灯" },
  { key: "tire", label: "胎压报警灯" },
  { key: "emission", label: "排放故障灯" },
  { key: "brake_system", label: "刹车系统灯" },
  { key: "seatbelt", label: "安全带提示灯" },
  { key: "maintenance", label: "保养提示灯" },
  { key: "esp", label: "ESP/防滑灯" },
];

export default function NewInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);

  // 机油油位
  const [oilBeforePath, setOilBeforePath] = useState("");
  const [oilBeforeAnnotations, setOilBeforeAnnotations] = useState<Line[]>([]);
  const [oilAfterPath, setOilAfterPath] = useState("");
  const [oilAfterAnnotations, setOilAfterAnnotations] = useState<Line[]>([]);

  // 其它油液
  const [fluidPaths, setFluidPaths] = useState<string[]>([]);

  // 灯光检查
  const [lightChecks, setLightChecks] = useState<Record<string, "normal" | "fault">>({});

  // 刹车片
  const [frontBrakePad, setFrontBrakePad] = useState("");
  const [rearBrakePad, setRearBrakePad] = useState("");

  // 尾气
  const [exhaust, setExhaust] = useState({ hc: "", co: "", no: "", co2: "", o2: "" });

  // 仪表照片
  const [dashboardPaths, setDashboardPaths] = useState<string[]>([]);
  const [dashboardFuelLevel, setDashboardFuelLevel] = useState("");
  const [faultLights, setFaultLights] = useState<string[]>([]);

  // 外检照片
  const [exteriorPaths, setExteriorPaths] = useState<string[]>([]);

  // 备注
  const [notes, setNotes] = useState("");

  useEffect(() => {
    params.then((p) => setOrderId(p.id));
    // 初始化灯光检查为全部正常
    const init: Record<string, "normal" | "fault"> = {};
    LIGHT_ITEMS.forEach((item) => (init[item.key] = "normal"));
    setLightChecks(init);
  }, [params]);

  function toggleLight(key: string) {
    setLightChecks((prev) => ({ ...prev, [key]: prev[key] === "normal" ? "fault" : "normal" }));
  }

  function toggleFaultLight(key: string) {
    setFaultLights((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId) return;
    setLoading(true);

    try {
      // 1. 创建检查主记录
      const { data: inspection, error: inspectionError } = await supabase
        .from("work_order_inspections")
        .insert({
          work_order_id: orderId,
          inspection_type: "inspection",
          front_brake_pad_thickness: frontBrakePad ? parseFloat(frontBrakePad) : null,
          rear_brake_pad_thickness: rearBrakePad ? parseFloat(rearBrakePad) : null,
          exhaust_hc: exhaust.hc ? parseFloat(exhaust.hc) : null,
          exhaust_co: exhaust.co ? parseFloat(exhaust.co) : null,
          exhaust_no: exhaust.no ? parseFloat(exhaust.no) : null,
          exhaust_co2: exhaust.co2 ? parseFloat(exhaust.co2) : null,
          exhaust_o2: exhaust.o2 ? parseFloat(exhaust.o2) : null,
          light_checks: lightChecks,
          dashboard_fuel_level: dashboardFuelLevel ? parseFloat(dashboardFuelLevel) : null,
          dashboard_fault_lights: faultLights,
          notes: notes || null,
        })
        .select("id")
        .single();

      if (inspectionError || !inspection) throw inspectionError || new Error("创建检查记录失败");

      // 2. 保存媒体
      const mediaRecords: any[] = [];

      if (oilBeforePath) {
        mediaRecords.push({
          inspection_id: inspection.id,
          media_type: "engine_oil_before",
          storage_path: oilBeforePath,
          annotations: oilBeforeAnnotations,
        });
      }
      if (oilAfterPath) {
        mediaRecords.push({
          inspection_id: inspection.id,
          media_type: "engine_oil_after",
          storage_path: oilAfterPath,
          annotations: oilAfterAnnotations,
        });
      }
      fluidPaths.forEach((path) => {
        mediaRecords.push({
          inspection_id: inspection.id,
          media_type: "fluid",
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
      <PageHeader title="车况检查" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-4xl space-y-8">
        {/* 机油油位 */}
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-4">机油油位</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs text-gray-500 mb-2">施工前</label>
              {!oilBeforePath ? (
                <ImageUploader onUpload={(paths) => setOilBeforePath(paths[0] || "")} maxImages={1} />
              ) : (
                <div>
                  <ImageAnnotator
                    imageUrl={oilBeforePath}
                    annotations={oilBeforeAnnotations}
                    onChange={setOilBeforeAnnotations}
                  />
                  <button
                    type="button"
                    onClick={() => { setOilBeforePath(""); setOilBeforeAnnotations([]); }}
                    className="mt-2 text-xs text-red-600 hover:text-red-700"
                  >
                    重新上传
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-2">施工后</label>
              {!oilAfterPath ? (
                <ImageUploader onUpload={(paths) => setOilAfterPath(paths[0] || "")} maxImages={1} />
              ) : (
                <div>
                  <ImageAnnotator
                    imageUrl={oilAfterPath}
                    annotations={oilAfterAnnotations}
                    onChange={setOilAfterAnnotations}
                  />
                  <button
                    type="button"
                    onClick={() => { setOilAfterPath(""); setOilAfterAnnotations([]); }}
                    className="mt-2 text-xs text-red-600 hover:text-red-700"
                  >
                    重新上传
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 仪表检查 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">仪表检查</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-2">仪表照片</label>
              <ImageUploader onUpload={setDashboardPaths} maxImages={3} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">燃油存量 (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="如: 45"
                  value={dashboardFuelLevel}
                  onChange={(e) => setDashboardFuelLevel(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-2">故障灯（多选）</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {FAULT_LIGHT_ITEMS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleFaultLight(item.key)}
                    className={`px-3 py-2 rounded border text-sm transition-colors ${
                      faultLights.includes(item.key)
                        ? "bg-red-50 border-red-200 text-red-700"
                        : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 其它油液 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">其它油液液位</h2>
          <ImageUploader onUpload={setFluidPaths} maxImages={5} />
        </section>

        {/* 灯光检查 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">灯光检查</h2>
          <p className="text-xs text-gray-400 mb-3">点击切换状态，绿色为正常，红色为故障</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {LIGHT_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleLight(item.key)}
                className={`flex items-center justify-between px-3 py-2 rounded border text-sm transition-colors ${
                  lightChecks[item.key] === "normal"
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-red-50 border-red-200 text-red-700"
                }`}
              >
                <span>{item.label}</span>
                <span className="text-xs font-medium">
                  {lightChecks[item.key] === "normal" ? "正常" : "故障"}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 刹车片厚度 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">刹车片厚度</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">前刹车片厚度 (mm)</label>
              <input
                type="number"
                step="0.1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="如: 5.5"
                value={frontBrakePad}
                onChange={(e) => setFrontBrakePad(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">后刹车片厚度 (mm)</label>
              <input
                type="number"
                step="0.1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="如: 6.0"
                value={rearBrakePad}
                onChange={(e) => setRearBrakePad(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* 尾气数据 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">尾气数据</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {[
              { key: "hc", label: "HC" },
              { key: "co", label: "CO" },
              { key: "no", label: "NO" },
              { key: "co2", label: "CO₂" },
              { key: "o2", label: "O₂" },
            ].map((item) => (
              <div key={item.key}>
                <label className="block text-xs text-gray-500 mb-1">{item.label}</label>
                <input
                  type="number"
                  step="0.0001"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  value={(exhaust as any)[item.key]}
                  onChange={(e) => setExhaust({ ...exhaust, [item.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </section>

        {/* 外检照片 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">外检照片</h2>
          <ImageUploader onUpload={setExteriorPaths} maxImages={8} />
        </section>

        {/* 备注 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">检查备注</h2>
          <textarea
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            placeholder="补充说明..."
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
            {loading ? "保存中..." : "保存检查记录"}
          </button>
        </div>
      </form>
    </div>
  );
}
