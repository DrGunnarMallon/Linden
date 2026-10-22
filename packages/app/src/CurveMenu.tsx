// Right-click menu on curves and group headers, in the preview and the variable list (SPEC §11 quick
// actions). It acts on the whole curve selection if the clicked curve is part of it, else on the clicked
// curve (or group) alone, which becomes the selection. Every action is one store edit (one undo step).

import { BookmarkPlus, ClipboardPaste, Copy, EyeOff, PanelRight, RotateCcw, Spline, Stamp } from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
import { copyStyle, pasteStyle, saveStyleAs } from "./actions";
import { availableApplyTo, copyCurveStyle, curveTargets, curveView, defaultApplyTo, isCurveSelected, isCurveType, MIXED, type ApplyTo, type CurveSelection } from "./curveEdit";
import { curveTypeOptions, selectionTitle, TypeIcon } from "./CurveInspector";
import { SHORTCUTS } from "./shortcuts";
import { useStore } from "./store";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./ui";
import { useView } from "./view";

/**
 * Wraps one element (the preview overlay, a variable list); `targetAt` names the curve or group under the
 * pointer (a one-curve or group selection), or null: then no menu opens.
 */
export function CurveContextMenu({ targetAt, children }: { targetAt(e: ReactMouseEvent): CurveSelection | null; children: ReactElement }) {
  const [sel, setSel] = useState<CurveSelection | null>(null);

  const onContextMenu = (e: ReactMouseEvent) => {
    const hit = useStore.getState().specErrors.length === 0 ? targetAt(e) : null;
    if (!hit) {
      e.preventDefault(); // no menu (Radix skips prevented events)
      return;
    }
    const view = useView.getState();
    const current = view.curveSelection;
    const clicked = hit.kind === "curves" ? hit.curves[0] : undefined;
    if (clicked && current?.kind === "curves" && isCurveSelected(current, clicked.dataset, clicked.id)) {
      // The whole selection, the clicked curve first (it is the one Copy / Apply this style take the style from).
      setSel({ kind: "curves", curves: [clicked, ...current.curves.filter((c) => c.dataset !== clicked.dataset || c.id !== clicked.id)] });
      return;
    }
    view.selectCurves(hit, { reveal: false });
    setSel(hit);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
        {children}
      </ContextMenuTrigger>
      {sel && <CurveMenuContent sel={sel} />}
    </ContextMenu>
  );
}

function CurveMenuContent({ sel }: { sel: CurveSelection }) {
  const spec = useStore((s) => s.spec);
  const clipboard = useView((s) => s.styleClipboard);
  const store = useStore.getState();
  const env = store.curveEnv();
  const view = curveView(curveTargets(env, sel, defaultApplyTo(sel)), spec);
  const available = availableApplyTo(env, sel);
  const library = spec.styleLibrary ?? [];
  const group = sel.kind === "group";
  const many = sel.kind === "curves" && sel.curves.length > 1;
  const exaggeration = view.effective.get("exaggeration.show");
  const applyThis = (applyTo: ApplyTo) => {
    const style = copyCurveStyle(env, sel);
    if (style) store.applyCurveStyle(sel, style, applyTo);
  };

  return (
    <ContextMenuContent className="min-w-56">
      <ContextMenuLabel>
        <span className="normal-case">{selectionTitle(sel, env.prepared)}</span>
      </ContextMenuLabel>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Spline /> Type
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-52">
          {view.type === MIXED && (
            <ContextMenuItem disabled className="pl-7 italic">
              Mixed
            </ContextMenuItem>
          )}
          <ContextMenuRadioGroup value={view.type === MIXED ? "" : view.type} onValueChange={(t) => isCurveType(t) && store.setCurveOption(sel, "type", t)}>
            {curveTypeOptions().map(({ type, label }) => (
              <ContextMenuRadioItem key={type} value={type}>
                <TypeIcon type={type} /> {label}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
          <ContextMenuSeparator />
          <ContextMenuLabel>Saved styles</ContextMenuLabel>
          {library.length === 0 ? (
            <ContextMenuItem disabled className="text-xs">
              None yet — use “Save style as…”
            </ContextMenuItem>
          ) : (
            library.map((s) => (
              <ContextMenuItem key={s.name} className="pl-7" onSelect={() => store.applyCurveStyle(sel, s.style)}>
                {s.style.type ? <TypeIcon type={s.style.type} /> : <Stamp />} {s.name}
              </ContextMenuItem>
            ))
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem shortcut={SHORTCUTS.copyStyle} onSelect={() => copyStyle(sel)}>
        <Copy /> Copy style
      </ContextMenuItem>
      <ContextMenuItem shortcut={SHORTCUTS.pasteStyle} disabled={!clipboard} onSelect={() => pasteStyle(sel)}>
        <ClipboardPaste /> Paste style
      </ContextMenuItem>
      {!group && (
        <ContextMenuItem disabled={!clipboard || !available.group} onSelect={() => pasteStyle(sel, "group")}>
          <ClipboardPaste /> Paste style to {many ? "their groups" : "group"}
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => saveStyleAs(sel)}>
        <BookmarkPlus /> Save style as…
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Stamp /> Apply this style to
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {!group && (
            <ContextMenuItem disabled={!available.group} onSelect={() => applyThis("group")}>
              {many ? "Their groups" : "Its group"}
            </ContextMenuItem>
          )}
          <ContextMenuItem disabled={!available.panel} onSelect={() => applyThis("panel")}>
            Whole panel
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuCheckboxItem
        checked={exaggeration === MIXED ? "indeterminate" : exaggeration === true}
        disabled={!view.keys.has("exaggeration")}
        onCheckedChange={() => store.setCurveOption(sel, "exaggeration.show", exaggeration !== true)}
      >
        Exaggeration
      </ContextMenuCheckboxItem>
      <ContextMenuItem disabled={view.type === "none"} onSelect={() => store.setCurveOption(sel, "type", "none")}>
        <EyeOff /> {group ? "Hide the group's curves" : many ? "Hide curves" : "Hide curve"}
      </ContextMenuItem>
      <ContextMenuItem disabled={view.own.size === 0} onSelect={() => store.resetCurveStyle(sel)}>
        <RotateCcw /> Reset to inherited
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => useView.getState().selectCurves(useView.getState().curveSelection ?? sel)}>
        <PanelRight /> Open in inspector
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
