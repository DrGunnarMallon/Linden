// Direct manipulation over the preview page (SPEC §11): click a panel to select it, drag its right edge
// to resize, drag manual zone lines. Hit-testing uses core's layout metadata (page mm), never the SVG.
// While dragging only outlines are drawn; the spec changes once, on release (one undo step).

import { parseSpec, resolveSpec } from "@linden/core";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  applyResize,
  applyZoneDepth,
  depthAtY,
  hitPanel,
  hitZone,
  resizeLabel,
  resizeTarget,
  resizeTo,
  snapDepth,
  yOfDepth,
  type ResizeResult,
  type ResizeTarget,
  type ZoneRef,
} from "./manipulate";
import { useStore } from "./store";
import { cn, TooltipLabel } from "./ui";
import { useView } from "./view";

/** Pointer distance (px) to a zone line that still grabs it. */
const ZONE_GRAB_PX = 4;
/** Movement (px) before a press counts as a drag. */
const DRAG_THRESHOLD_PX = 2;

type Drag =
  | { kind: "resize"; target: ResizeTarget; startX: number; startRight: number; result: ResizeResult; moved: boolean }
  | { kind: "zone"; zone: ZoneRef; startY: number; startLineY: number; depth: number; moved: boolean };

function isEditable(el: Element | null): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
}

/** Commits a spec produced by a drag if it validates (it always should: values stay positive). */
function commit(next: unknown): void {
  const parsed = parseSpec(next);
  if (parsed.ok) useStore.getState().editSpec(parsed.value);
}

export function PreviewOverlay({ pxPerMm, onDragChange }: { pxPerMm: number; onDragChange(dragging: boolean): void }) {
  const layout = useStore((s) => s.layout);
  const spec = useStore((s) => s.spec);
  const presets = useStore((s) => s.presets);
  const selection = useView((s) => s.selection);
  const el = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ panel: number | null; zone: boolean }>({ panel: null, zone: false });
  /** Last pointer position, to re-apply a drag when Alt is pressed or released without moving. */
  const pointer = useRef({ x: 0, y: 0 });

  const resolved = useMemo(() => {
    try {
      return resolveSpec(spec, presets).spec;
    } catch {
      return undefined;
    }
  }, [spec, presets]);
  const selected = selection && layout && selection.panel < layout.panels.length ? selection.panel : null;
  // The resize handle sits on the hovered panel (so it can be found without clicking first), else on the selected one.
  const handlePanel = drag?.kind === "resize" ? drag.target.panel : (hover.panel ?? selected);
  const target = handlePanel !== null && resolved && layout ? resizeTarget(resolved, layout, handlePanel) : null;

  // A selection that no longer exists (panel removed, undo) is dropped.
  useEffect(() => {
    if (selection && layout && selection.panel >= layout.panels.length) useView.getState().selectPanel(null);
  }, [selection, layout]);

  const dragging = drag !== null;
  useEffect(() => onDragChange(dragging), [dragging, onDragChange]);

  const toMm = (clientX: number, clientY: number) => {
    const r = el.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / pxPerMm, y: (clientY - r.top) / pxPerMm };
  };

  /** The drag at a pointer position; `snap` = Alt not held. */
  const dragAt = (d: Drag, clientX: number, clientY: number, snap: boolean): Drag => {
    if (!layout) return d;
    if (d.kind === "resize") {
      const moved = d.moved || Math.abs(clientX - d.startX) > DRAG_THRESHOLD_PX;
      const right = d.startRight + (clientX - d.startX) / pxPerMm;
      return { ...d, moved, result: resizeTo(layout, d.target, right, snap) };
    }
    const moved = d.moved || Math.abs(clientY - d.startY) > DRAG_THRESHOLD_PX;
    const y = d.startLineY + (clientY - d.startY) / pxPerMm;
    return { ...d, moved, depth: snapDepth(layout, depthAtY(layout, y), snap) };
  };

  // Esc cancels a drag, else clears the selection; Alt toggles snapping mid-drag.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        setDrag((d) => (d ? dragAt(d, pointer.current.x, pointer.current.y, e.type === "keyup") : d));
        return;
      }
      if (e.type !== "keydown" || e.key !== "Escape" || isEditable(document.activeElement)) return;
      if (drag) setDrag(null);
      else if (useView.getState().selection) useView.getState().selectPanel(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  });

  if (!layout) return null;
  const px = (mm: number) => mm * pxPerMm;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const { x, y } = toMm(e.clientX, e.clientY);
    pointer.current = { x: e.clientX, y: e.clientY };
    const zone = hitZone(layout, spec, x, y, ZONE_GRAB_PX / pxPerMm);
    if (zone) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: "zone", zone, startY: e.clientY, startLineY: yOfDepth(layout, zone.depth), depth: zone.depth, moved: false });
      return;
    }
    const hit = hitPanel(layout, x, y);
    useView.getState().selectPanel(hit);
    if (hit !== null && useStore.getState().specErrors.length === 0) useView.getState().showInspector("form");
  };

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !target) return;
    e.stopPropagation();
    // Grabbing a hovered panel's handle selects it, too.
    if (selected !== target.panel) {
      useView.getState().selectPanel(target.panel);
      if (useStore.getState().specErrors.length === 0) useView.getState().showInspector("form");
    }
    el.current!.setPointerCapture(e.pointerId);
    pointer.current = { x: e.clientX, y: e.clientY };
    const box = layout.panels[target.panel]!.box;
    const startRight = box.x + box.width;
    setDrag({ kind: "resize", target, startX: e.clientX, startRight, result: resizeTo(layout, target, startRight, !e.altKey), moved: false });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    if (drag) {
      setDrag(dragAt(drag, e.clientX, e.clientY, !e.altKey));
      return;
    }
    // On the handle (which reaches past the panel's edge): keep the hovered panel.
    if (e.target instanceof Element && e.target.closest("[role=separator]")) return;
    const { x, y } = toMm(e.clientX, e.clientY);
    const zone = hitZone(layout, spec, x, y, ZONE_GRAB_PX / pxPerMm) !== null;
    const panel = zone ? null : hitPanel(layout, x, y);
    if (panel !== hover.panel || zone !== hover.zone) setHover({ panel, zone });
  };

  const onPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    if (!drag.moved) return;
    const current = useStore.getState().spec;
    if (drag.kind === "resize") commit(applyResize(current, drag.target, drag.result.value));
    else if (drag.depth !== drag.zone.depth) commit(applyZoneDepth(current, drag.zone, drag.depth));
  };

  const { plot } = layout;
  const box = selected !== null ? layout.panels[selected]!.box : null;
  const resizing = drag?.kind === "resize" ? drag : null;
  const handleBox = handlePanel !== null ? layout.panels[handlePanel]!.box : null;
  // The handle follows the dragged edge.
  const handleRight = resizing ? resizing.result.panels[resizing.target.panel]! : handleBox ? { x: handleBox.x, width: handleBox.width } : null;
  const handleX = handleRight ? handleRight.x + handleRight.width : 0;
  const zoneDrag = drag?.kind === "zone" ? drag : null;

  return (
    <div
      ref={el}
      className="absolute inset-0 select-none"
      style={{ cursor: drag?.kind === "resize" ? "ew-resize" : zoneDrag || hover.zone ? "ns-resize" : hover.panel !== null ? "pointer" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => !drag && setHover({ panel: null, zone: false })}
    >
      {!drag && hover.panel !== null && hover.panel !== selected && (
        <Outline box={layout.panels[hover.panel]!.box} px={px} className="border-accent/35" />
      )}
      {box && !resizing && <Outline box={box} px={px} className="border-accent" />}

      {resizing &&
        resizing.result.panels.map((p, i) => (
          <div key={i}>
            <Outline box={{ ...layout.panels[i]!.box, x: p.x, width: p.width }} px={px} className="border-dashed border-accent" />
            {p.columns.map((c, j) => (
              <div key={j} className="pointer-events-none absolute bg-accent/15" style={{ left: px(c.x), width: Math.max(1, px(c.width)), top: px(plot.y), height: px(plot.height) }} />
            ))}
          </div>
        ))}

      {target && handleRight && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          className="group absolute flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center"
          style={{ left: px(handleX), top: px(plot.y), height: px(plot.height) }}
          onPointerDown={onHandleDown}
        >
          <div className="h-full w-px bg-accent/50 group-hover:bg-accent" />
          <div className="absolute h-8 w-1.5 rounded-full bg-accent ring-2 ring-white" />
        </div>
      )}

      {resizing && (
        <TooltipLabel
          className="flex-col items-start gap-0.5 tabular-nums"
          // Right of the handle; left of it near the page's right edge, so the canvas never clips it.
          style={{
            left: px(handleX) + (handleX > layout.page.width * 0.6 ? -10 : 10),
            top: px(plot.y + plot.height / 2),
            transform: handleX > layout.page.width * 0.6 ? "translate(-100%, -50%)" : "translateY(-50%)",
          }}
        >
          <span>{resizeLabel(resizing.target.kind, resizing.result.value)}</span>
          {resizing.result.limit && <span className="text-warning-text">{resizing.result.limit}</span>}
        </TooltipLabel>
      )}

      {zoneDrag && (
        <>
          <div className="pointer-events-none absolute h-px bg-accent" style={{ left: px(plot.x), width: px(plot.width), top: px(yOfDepth(layout, zoneDrag.depth)) }} />
          <TooltipLabel className="tabular-nums" style={{ left: px(plot.x + plot.width) + 10, top: px(yOfDepth(layout, zoneDrag.depth)), transform: "translateY(-50%)" }}>
            Depth {zoneDrag.depth}
          </TooltipLabel>
        </>
      )}
    </div>
  );
}

function Outline({ box, px, className }: { box: { x: number; y: number; width: number; height: number }; px(mm: number): number; className: string }) {
  return <div className={cn("pointer-events-none absolute border", className)} style={{ left: px(box.x), top: px(box.y), width: px(box.width), height: px(box.height) }} />;
}
