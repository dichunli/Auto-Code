"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";
import { ImageAnnotator } from "@/components/ImageAnnotator";
import OilLevelGauge from "@/components/OilLevelGauge";
import FaultLightIcon from "@/components/FaultLightIcon";

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

const INSPECTOR_OPTIONS = [
  { key: "oil", label: "机油油位" },
  { key: "dashboard", label: "仪表检查" },
  { key: "fluid_level", label: "其它油液" },
  { key: "belt", label: "传动皮带" },
  { key: "fluid", label: "油液检测" },
  { key: "battery", label: "蓄电池" },
  { key: "light", label: "灯光检查" },
  { key: "brake", label: "刹车片" },
  { key: "exhaust", label: "尾气数据" },
  { key: "tire", label: "轮胎检查" },
  { key: "exterior", label: "外检" },
];

/* ========== 自动判定辅助函数 ========== */

function getCoolantPhStatus(ph: number | null) {
  if (ph == null) return null;
  if (ph >= 7.5 && ph <= 11.0) return { text: "正常", class: "text-green-600 bg-green-50" };
  if (ph < 7.5) return { text: "酸性偏重，建议更换", class: "text-red-600 bg-red-50" };
  return { text: "碱性过强，建议检查", class: "text-amber-600 bg-amber-50" };
}

function getBrakeFluidStatus(water: number | null) {
  if (water == null) return null;
  if (water <= 1.0) return { text: "良好", class: "text-green-600 bg-green-50" };
  if (water <= 2.0) return { text: "一般，建议关注", class: "text-amber-600 bg-amber-50" };
  return { text: "含水量过高，需更换", class: "text-red-600 bg-red-50" };
}

function getBatteryVoltageStatus(v: number | null) {
  if (v == null) return null;
  if (v >= 12.4 && v <= 12.9) return { text: "电压正常", class: "text-green-600 bg-green-50" };
  if (v < 12.4) return { text: "电压偏低，建议充电", class: "text-red-600 bg-red-50" };
  return { text: "电压偏高，可能刚充完", class: "text-amber-600 bg-amber-50" };
}

function getBatteryHealthStatus(h: number | null) {
  if (h == null) return null;
  if (h >= 80) return { text: "寿命良好", class: "text-green-600 bg-green-50" };
  if (h >= 50) return { text: "寿命一般，建议关注", class: "text-amber-600 bg-amber-50" };
  return { text: "寿命不足，建议更换", class: "text-red-600 bg-red-50" };
}

const EXHAUST_ITEMS = [
  { key: "hc", label: "HC", unit: "ppm", standard: "≤100", step: "0.0001" },
  { key: "co", label: "CO", unit: "%", standard: "≤0.5", step: "0.0001" },
  { key: "no", label: "NO", unit: "ppm", standard: "≤500", step: "0.0001" },
  { key: "co2", label: "CO₂", unit: "%", standard: "14~16", step: "0.0001" },
  { key: "o2", label: "O₂", unit: "%", standard: "0.5~2", step: "0.0001" },
] as const;

export default function NewInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);

  /* ===== 顶部信息 ===== */
  const [inspectionTime] = useState(() => new Date().toLocaleString("zh-CN"));
  const [inspectionMileage, setInspectionMileage] = useState("");
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(null);
  const [profiles, setProfiles] = useState<{ id: string; full_name: string }[]>([]);
  const [inspectors, setInspectors] = useState<Record<string, string>>({});

  // 机油油位
  const [oilBeforePath, setOilBeforePath] = useState("");
  const [oilBeforeAnnotations, setOilBeforeAnnotations] = useState<Line[]>([]);
  const [oilBeforeLevel, setOilBeforeLevel] = useState(50);
  const [oilAfterPath, setOilAfterPath] = useState("");
  const [oilAfterAnnotations, setOilAfterAnnotations] = useState<Line[]>([]);
  const [oilAfterLevel, setOilAfterLevel] = useState(80);

  // 其它油液
  const [fluidPaths, setFluidPaths] = useState<string[]>([]);

  // 灯光检查
  const [lightChecks, setLightChecks] = useState<Record<string, "normal" | "fault">>({});

  // 刹车片
  const [frontBrakePad, setFrontBrakePad] = useState("");
  const [rearBrakePad, setRearBrakePad] = useState("");

  // 尾气
  const [exhaust, setExhaust] = useState({ hc: "", co: "", no: "", co2: "", o2: "" });

  // 防冻液
  const [coolantPh, setCoolantPh] = useState("");

  // 刹车油
  const [brakeFluidWater, setBrakeFluidWater] = useState("");

  // 蓄电池
  const [batteryHealth, setBatteryHealth] = useState("");
  const [batteryVoltage, setBatteryVoltage] = useState("");

  // 仪表照片
  const [dashboardPaths, setDashboardPaths] = useState<string[]>([]);
  const [dashboardFuelLevel, setDashboardFuelLevel] = useState("");
  const [faultLights, setFaultLights] = useState<string[]>([]);

  // 传动皮带
  const [driveBeltPaths, setDriveBeltPaths] = useState<string[]>([]);
  const [driveBeltStatus, setDriveBeltStatus] = useState<"" | "good" | "fair" | "replace">("");

  // 轮胎检查
  const [tirePaths, setTirePaths] = useState<string[]>([]);
  const [tireChecks, setTireChecks] = useState<Record<string, "" | "good" | "fair" | "replace">>({
    fl: "", fr: "", rl: "", rr: "",
  });

  // 外检照片
  const [exteriorPaths, setExteriorPaths] = useState<string[]>([]);

  // 备注
  const [notes, setNotes] = useState("");

  useEffect(() => {
    params.then((p) => setOrderId(p.id));
    const init: Record<string, "normal" | "fault"> = {};
    LIGHT_ITEMS.forEach((item) => (init[item.key] = "normal"));
    setLightChecks(init);

    /* 获取当前用户和员工列表 */
    async function initUserAndProfiles() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("id", user.id)
          .single();
        if (profile) {
          setCurrentUser({ id: profile.id, name: profile.full_name });
        }
      }
      const { data: plist } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name");
      setProfiles(plist || []);
    }
    initUserAndProfiles();
  }, [params, supabase]);

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
          engine_oil_before_level: oilBeforeLevel,
          engine_oil_after_level: oilAfterLevel,
          coolant_ph: coolantPh ? parseFloat(coolantPh) : null,
          brake_fluid_water: brakeFluidWater ? parseFloat(brakeFluidWater) : null,
          battery_health: batteryHealth ? parseInt(batteryHealth, 10) : null,
          battery_voltage: batteryVoltage ? parseFloat(batteryVoltage) : null,
          drive_belt_status: driveBeltStatus || null,
          tire_checks: tireChecks,
          inspection_mileage: inspectionMileage ? parseFloat(inspectionMileage) : null,
          submitter_id: currentUser?.id || null,
          inspectors: inspectors,
          notes: notes || null,
        })
        .select("id")
        .single();

      if (inspectionError || !inspection) throw inspectionError || new Error("创建检查记录失败");

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
      driveBeltPaths.forEach((path) => {
        mediaRecords.push({
          inspection_id: inspection.id,
          media_type: "drive_belt",
          storage_path: path,
        });
      });
      tirePaths.forEach((path) => {
        mediaRecords.push({
          inspection_id: inspection.id,
          media_type: "tire",
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
        {/* 顶部基本信息 */}
        <section className="bg-gray-50 rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">检查基本信息</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">检查时间</label>
              <div className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700">{inspectionTime}</div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">检查里程 (km)</label>
              <input
                type="number"
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="如: 52000"
                value={inspectionMileage}
                onChange={(e) => setInspectionMileage(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">总提交人</label>
              <div className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700">
                {currentUser?.name || "加载中..."}
              </div>
            </div>
          </div>
          {/* 各部分检查人 */}
          <div className="border-t border-gray-200 pt-3">
            <label className="block text-xs text-gray-500 mb-2">各项目检查人（可选，默认与总提交人相同）</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {INSPECTOR_OPTIONS.map((opt) => (
                <div key={opt.key}>
                  <span className="text-[10px] text-gray-400">{opt.label}</span>
                  <select
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
                    value={inspectors[opt.key] || ""}
                    onChange={(e) => setInspectors((prev) => ({ ...prev, [opt.key]: e.target.value }))}
                  >
                    <option value="">同总提交人</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 机油油位 */}
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-4">机油油位</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs text-gray-500 mb-2">施工前</label>
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <OilLevelGauge value={oilBeforeLevel} onChange={setOilBeforeLevel} label="油位刻度" />
                <div className="flex-1 w-full">
                  {!oilBeforePath ? (
                    <ImageUploader onUpload={(paths) => setOilBeforePath(paths[0] || "")} maxImages={1} />
                  ) : (
                    <div>
                      <ImageAnnotator imageUrl={oilBeforePath} annotations={oilBeforeAnnotations} onChange={setOilBeforeAnnotations} />
                      <button type="button" onClick={() => { setOilBeforePath(""); setOilBeforeAnnotations([]); }} className="mt-2 text-xs text-red-600 hover:text-red-700">重新上传</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-2">施工后</label>
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <OilLevelGauge value={oilAfterLevel} onChange={setOilAfterLevel} label="油位刻度" />
                <div className="flex-1 w-full">
                  {!oilAfterPath ? (
                    <ImageUploader onUpload={(paths) => setOilAfterPath(paths[0] || "")} maxImages={1} />
                  ) : (
                    <div>
                      <ImageAnnotator imageUrl={oilAfterPath} annotations={oilAfterAnnotations} onChange={setOilAfterAnnotations} />
                      <button type="button" onClick={() => { setOilAfterPath(""); setOilAfterAnnotations([]); }} className="mt-2 text-xs text-red-600 hover:text-red-700">重新上传</button>
                    </div>
                  )}
                </div>
              </div>
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
                <input type="number" min="0" max="100" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="如: 45" value={dashboardFuelLevel} onChange={(e) => setDashboardFuelLevel(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-2">故障灯（多选）</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {FAULT_LIGHT_ITEMS.map((item) => (
                  <button key={item.key} type="button" onClick={() => toggleFaultLight(item.key)} className={`flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors ${faultLights.includes(item.key) ? "bg-red-50 border-red-200 text-red-700" : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"}`}>
                    <FaultLightIcon type={item.key} className="w-4 h-4 shrink-0" />
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

        {/* 传动皮带 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">传动皮带</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-2">皮带照片</label>
              <ImageUploader onUpload={setDriveBeltPaths} maxImages={3} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-2">皮带状态</label>
              <div className="flex gap-2">
                {[
                  { key: "good", label: "良好", class: "bg-green-50 border-green-200 text-green-700 hover:bg-green-100" },
                  { key: "fair", label: "一般", class: "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100" },
                  { key: "replace", label: "需更换", class: "bg-red-50 border-red-200 text-red-700 hover:bg-red-100" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setDriveBeltStatus(item.key as typeof driveBeltStatus)}
                    className={`px-4 py-2 rounded border text-sm transition-colors ${
                      driveBeltStatus === item.key ? item.class + " ring-2 ring-offset-1 ring-current" : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 防冻液 + 刹车油 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">油液检测</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-xs text-gray-500 mb-1">防冻液 PH 值</label>
              <div className="flex items-center gap-3">
                <input type="number" step="0.1" min="0" max="14" className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="如: 8.5" value={coolantPh} onChange={(e) => setCoolantPh(e.target.value)} />
                <span className="text-xs text-gray-400">标准值: 7.5 ~ 11.0</span>
              </div>
              {(() => {
                const status = getCoolantPhStatus(coolantPh ? parseFloat(coolantPh) : null);
                return status ? (
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${status.class}`}>{status.text}</span>
                ) : null;
              })()}
            </div>
            <div className="space-y-2">
              <label className="block text-xs text-gray-500 mb-1">刹车油含水量 (%)</label>
              <div className="flex items-center gap-3">
                <input type="number" step="0.1" min="0" max="100" className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="如: 1.5" value={brakeFluidWater} onChange={(e) => setBrakeFluidWater(e.target.value)} />
                <span className="text-xs text-gray-400">标准值: ≤1% 良好，&gt;2% 需更换</span>
              </div>
              {(() => {
                const status = getBrakeFluidStatus(brakeFluidWater ? parseFloat(brakeFluidWater) : null);
                return status ? (
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${status.class}`}>{status.text}</span>
                ) : null;
              })()}
            </div>
          </div>
        </section>

        {/* 蓄电池 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">蓄电池检测</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="block text-xs text-gray-500 mb-1">寿命 (%)</label>
              <input type="number" min="0" max="100" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="如: 85" value={batteryHealth} onChange={(e) => setBatteryHealth(e.target.value)} />
              {(() => {
                const status = getBatteryHealthStatus(batteryHealth ? parseInt(batteryHealth, 10) : null);
                return status ? (
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${status.class}`}>{status.text}</span>
                ) : null;
              })()}
            </div>
            <div className="space-y-2">
              <label className="block text-xs text-gray-500 mb-1">电压 (V)</label>
              <div className="flex items-center gap-3">
                <input type="number" step="0.1" min="0" max="20" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="如: 12.6" value={batteryVoltage} onChange={(e) => setBatteryVoltage(e.target.value)} />
                <span className="text-xs text-gray-400 shrink-0">标准: 12.4~12.9V</span>
              </div>
              {(() => {
                const status = getBatteryVoltageStatus(batteryVoltage ? parseFloat(batteryVoltage) : null);
                return status ? (
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${status.class}`}>{status.text}</span>
                ) : null;
              })()}
            </div>
          </div>
        </section>

        {/* 灯光检查 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">灯光检查</h2>
          <p className="text-xs text-gray-400 mb-3">点击切换状态，绿色为正常，红色为故障</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {LIGHT_ITEMS.map((item) => (
              <button key={item.key} type="button" onClick={() => toggleLight(item.key)} className={`flex items-center justify-between px-3 py-2 rounded border text-sm transition-colors ${lightChecks[item.key] === "normal" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"}`}>
                <span>{item.label}</span>
                <span className="text-xs font-medium">{lightChecks[item.key] === "normal" ? "正常" : "故障"}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 刹车片厚度 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">刹车片厚度</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs text-gray-500 mb-1">前刹车片厚度 (mm)</label>
              <input type="number" step="0.1" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="如: 5.5" value={frontBrakePad} onChange={(e) => setFrontBrakePad(e.target.value)} />
              {(() => {
                const v = parseFloat(frontBrakePad);
                if (isNaN(v)) return null;
                if (v <= 3.0) return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium text-red-600 bg-red-50">≤3mm 极限，建议更换</span>;
                if (v <= 4.0) return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium text-amber-600 bg-amber-50">接近极限，建议关注</span>;
                return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium text-green-600 bg-green-50">厚度正常</span>;
              })()}
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-gray-500 mb-1">后刹车片厚度 (mm)</label>
              <input type="number" step="0.1" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="如: 6.0" value={rearBrakePad} onChange={(e) => setRearBrakePad(e.target.value)} />
              {(() => {
                const v = parseFloat(rearBrakePad);
                if (isNaN(v)) return null;
                if (v <= 2.0) return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium text-red-600 bg-red-50">≤2mm 极限，建议更换</span>;
                if (v <= 3.0) return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium text-amber-600 bg-amber-50">接近极限，建议关注</span>;
                return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium text-green-600 bg-green-50">厚度正常</span>;
              })()}
            </div>
          </div>
        </section>

        {/* 尾气数据 — 竖排 + 标准值 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">尾气数据</h2>
          <div className="space-y-3 max-w-md">
            {EXHAUST_ITEMS.map((item) => (
              <div key={item.key} className="flex items-center gap-3">
                <div className="w-16 shrink-0">
                  <label className="text-sm font-medium text-gray-700">{item.label}</label>
                </div>
                <input
                  type="number"
                  step={item.step}
                  className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  value={(exhaust as any)[item.key]}
                  onChange={(e) => setExhaust({ ...exhaust, [item.key]: e.target.value })}
                />
                <span className="text-xs text-gray-400 w-10">{item.unit}</span>
                <span className="text-xs text-gray-400">标准: {item.standard}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 轮胎检查 */}
        <section className="border-t border-gray-100 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">轮胎检查</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-2">轮胎照片</label>
              <ImageUploader onUpload={setTirePaths} maxImages={4} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { key: "fl", label: "左前轮" },
                { key: "fr", label: "右前轮" },
                { key: "rl", label: "左后轮" },
                { key: "rr", label: "右后轮" },
              ].map((tire) => (
                <div key={tire.key}>
                  <label className="block text-xs text-gray-500 mb-2">{tire.label}</label>
                  <div className="flex flex-col gap-1.5">
                    {[
                      { key: "good", label: "良好", class: "bg-green-50 border-green-200 text-green-700" },
                      { key: "fair", label: "一般", class: "bg-amber-50 border-amber-200 text-amber-700" },
                      { key: "replace", label: "需更换", class: "bg-red-50 border-red-200 text-red-700" },
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setTireChecks((prev) => ({ ...prev, [tire.key]: item.key as any }))}
                        className={`px-2 py-1.5 rounded border text-xs transition-colors ${
                          tireChecks[tire.key] === item.key ? item.class + " ring-1 ring-offset-1 ring-current" : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
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
          <textarea rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="补充说明..." value={notes} onChange={(e) => setNotes(e.target.value)} />
        </section>

        <div className="flex gap-3 justify-end pt-4 border-t border-gray-100">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{loading ? "保存中..." : "保存检查记录"}</button>
        </div>
      </form>
    </div>
  );
}
