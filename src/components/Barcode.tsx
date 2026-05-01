"use client";

import { useEffect, useRef, useState } from "react";

interface BarcodeProps {
  value: string;
  format?: string;
  width?: number;
  height?: number;
  displayValue?: boolean;
  fontSize?: number;
  className?: string;
}

export function Barcode({
  value,
  format = "CODE128",
  width = 2,
  height = 50,
  displayValue = true,
  fontSize = 14,
  className = "",
}: BarcodeProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !svgRef.current || !value) return;
    let cancelled = false;
    import("jsbarcode")
      .then((mod) => {
        if (cancelled) return;
        const JsBarcode = mod.default || mod;
        try {
          JsBarcode(svgRef.current, value, {
            format,
            width,
            height,
            displayValue,
            fontSize,
            margin: 4,
          });
        } catch {
          if (!cancelled) setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, value, format, width, height, displayValue, fontSize]);

  if (!value) return null;

  if (failed) {
    return (
      <div className={`text-xs text-gray-400 bg-gray-50 rounded px-2 py-1 inline-block ${className}`}>
        {value}
      </div>
    );
  }

  return <svg ref={svgRef} className={className} />;
}
