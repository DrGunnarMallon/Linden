import { resolveSpec } from "@linden/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { matchPagePreset, PAGE_PRESETS } from "./specEdit";
import { useStore } from "./store";

type Zoom = "fit" | 1 | 2;
const PX_PER_MM = 96 / 25.4; // CSS reference pixel
const PAD = 24;

/** Size in mm; commits on Enter or blur, so typing makes one undo step. */
function MmInput({ value, label, onCommit }: { value: number; label: string; onCommit(v: number): void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v > 0 && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <input
      className="mm"
      type="number"
      min={1}
      step={0.5}
      aria-label={label}
      title={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

export function Preview() {
  const { svg, spec, presets } = useStore();
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [box, setBox] = useState({ w: 0, h: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const page = useMemo(() => resolveSpec(spec, presets).spec.page, [spec, presets]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageW = page.width * PX_PER_MM;
  const pageH = page.height * PX_PER_MM;
  const scale = zoom === "fit" ? Math.max(0.05, Math.min((box.w - 2 * PAD) / pageW, (box.h - 2 * PAD) / pageH)) : zoom;
  // Core output is escaped XML; drop the prolog before inlining it into HTML.
  const markup = useMemo(() => svg.replace(/^<\?xml[^>]*\?>\s*/, ""), [svg]);

  return (
    <div className="preview">
      <div className="toolbar">
        Page
        <select
          value={matchPagePreset(page)}
          onChange={(e) => e.target.value !== "custom" && useStore.getState().applyPagePreset(e.target.value)}
        >
          {PAGE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        <MmInput label="Page width (mm)" value={page.width} onCommit={(width) => useStore.getState().setPageSize({ width })} />×
        <MmInput label="Page height (mm)" value={page.height} onCommit={(height) => useStore.getState().setPageSize({ height })} />
        mm
        <span className="sep" />
        Zoom
        {(["fit", 1, 2] as const).map((z) => (
          <button key={z} className={zoom === z ? "active" : ""} onClick={() => setZoom(z)}>
            {z === "fit" ? "Fit" : `${z * 100}%`}
          </button>
        ))}
        <span className="muted">{Math.round(scale * 100)}%</span>
      </div>
      <div className="scroller" ref={scroller}>
        <div className="page" style={{ width: pageW * scale, height: pageH * scale }} dangerouslySetInnerHTML={{ __html: markup }} />
      </div>
    </div>
  );
}
