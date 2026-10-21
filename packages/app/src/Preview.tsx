import { resolveSpec } from "@linden/core";
import { Minus, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PreviewOverlay } from "./PreviewOverlay";
import { SHORTCUTS } from "./shortcuts";
import { useStore } from "./store";
import { Button, cn, IconButton, Tooltip } from "./ui";
import { clampZoom, useView } from "./view";
import { Welcome } from "./Welcome";

const PX_PER_MM = 96 / 25.4; // CSS reference pixel
const PAD = 48;
const PAD_BOTTOM = 72; // room for the floating zoom toolbar

/** Zoom controls floating over the canvas. */
function ZoomToolbar() {
  const { zoom, scale, setZoom, zoomBy } = useView();
  const preset = (z: "fit" | 1 | 2, label: string, shortcut: string) => (
    <Tooltip content={z === "fit" ? "Fit page to window" : `Zoom to ${label}`} shortcut={shortcut} side="top">
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={zoom === z}
        onClick={() => setZoom(z)}
        className={cn("tabular-nums", zoom === z && "bg-accent-subtle text-accent-text hover:bg-accent-subtle hover:text-accent-text")}
      >
        {label}
      </Button>
    </Tooltip>
  );
  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-surface-raised p-1 shadow-overlay">
      <IconButton label="Zoom out" shortcut={SHORTCUTS.zoomOut} icon={<Minus />} size="sm" tooltipSide="top" onClick={() => zoomBy(-1)} />
      <span className="w-12 text-center text-xs text-fg-secondary tabular-nums" aria-live="polite">
        {Math.round(scale * 100)}%
      </span>
      <IconButton label="Zoom in" shortcut={SHORTCUTS.zoomIn} icon={<Plus />} size="sm" tooltipSide="top" onClick={() => zoomBy(1)} />
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      {preset("fit", "Fit", SHORTCUTS.zoomFit)}
      {preset(1, "100%", SHORTCUTS.zoom100)}
      {preset(2, "200%", SHORTCUTS.zoom200)}
    </div>
  );
}

/** Workspace: the figure as a white page at true size (100% = physical mm on a 96 dpi screen). */
export function Preview() {
  const { svg, spec, presets } = useStore();
  const hasData = useStore((s) => s.datasets.length > 0);
  const { zoom, setZoom, setScale } = useView();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const pageEl = useRef<HTMLDivElement>(null);
  /** Page point under the cursor during Ctrl+scroll, kept in place after the zoom. */
  const anchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const page = useMemo(() => resolveSpec(spec, presets).spec.page, [spec, presets]);
  /** While dragging in the overlay the figure is dimmed under the outlines (no re-render until release). */
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

  const pageW = page.width * PX_PER_MM;
  const pageH = page.height * PX_PER_MM;
  const scale = zoom === "fit" ? Math.max(0.05, Math.min((box.w - 2 * PAD) / pageW, (box.h - PAD - PAD_BOTTOM) / pageH)) : zoom;
  useEffect(() => setScale(scale), [scale, setScale]);

  // Ctrl/Cmd + wheel (and trackpad pinch, which arrives as Ctrl + wheel) zooms around the cursor.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !pageEl.current) return;
      e.preventDefault();
      const current = useView.getState().scale;
      const delta = Math.max(-50, Math.min(50, e.deltaY));
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      anchor.current = {
        fx: (el.scrollLeft + cx - pageEl.current.offsetLeft) / current,
        fy: (el.scrollTop + cy - pageEl.current.offsetTop) / current,
        cx,
        cy,
      };
      setZoom(clampZoom(current * Math.exp(-delta * 0.006)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasData, setZoom]);

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scroller.current;
    if (!a || !el || !pageEl.current) return;
    anchor.current = null;
    el.scrollLeft = a.fx * scale + pageEl.current.offsetLeft - a.cx;
    el.scrollTop = a.fy * scale + pageEl.current.offsetTop - a.cy;
  }, [scale]);

  // Core output is escaped XML; drop the prolog before inlining it into HTML.
  const markup = useMemo(() => svg.replace(/^<\?xml[^>]*\?>\s*/, ""), [svg]);

  if (!hasData) {
    return (
      <div className="canvas-dots h-full overflow-auto">
        <Welcome />
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div ref={scroller} className="canvas-dots relative h-full overflow-auto" aria-label="Diagram preview" role="region">
        <div className="flex min-h-full w-max min-w-full items-center justify-center" style={{ padding: `${PAD}px ${PAD}px ${PAD_BOTTOM}px` }}>
          <div ref={pageEl} className="figure-page relative shrink-0 shadow-page" style={{ width: pageW * scale, height: pageH * scale }}>
            <div className={cn("h-full w-full transition-opacity", dragging && "opacity-35")} dangerouslySetInnerHTML={{ __html: markup }} />
            <PreviewOverlay pxPerMm={PX_PER_MM * scale} onDragChange={setDragging} />
          </div>
        </div>
      </div>
      <ZoomToolbar />
    </div>
  );
}
