// The curve quick actions through the store (SPEC §11): each is one undo step.
import { describe, expect, it } from "vitest";
import { copyCurveStyle, type CurveSelection } from "../src/curveEdit";
import { useStore } from "../src/store";

const curves = (...ids: string[]): CurveSelection => ({ kind: "curves", curves: ids.map((id) => ({ dataset: "demo-pollen", id, panel: null })) });

describe("curve quick actions in the store", () => {
  it("line on one curve, its style pasted on three at once, one undo reverts all three; saved as “Moss line” and applied to another", async () => {
    await useStore.getState().loadExample("demo-pollen");
    const store = () => useStore.getState();
    const base = store().spec;

    store().setCurveOption(curves("Betula"), "type", "line");
    const style = copyCurveStyle(store().curveEnv(), curves("Betula"))!;
    expect(style.type).toBe("line");
    const before = store().past.length;
    store().applyCurveStyle(curves("Pinus", "Quercus", "Poaceae"), style);
    expect(store().past.length).toBe(before + 1);
    expect(Object.keys(store().spec.curveStyles ?? {})).toEqual(["Betula", "Pinus", "Quercus", "Poaceae"]);

    store().undo();
    expect(store().spec.curveStyles).toEqual({ Betula: { type: "line" } });

    store().saveCurveStyle("Moss line", style);
    expect(store().spec.styleLibrary).toEqual([{ name: "Moss line", style }]);
    store().applyCurveStyle(curves("Corylus"), store().spec.styleLibrary![0]!.style);
    expect(store().spec.curveStyles).toEqual({ Betula: { type: "line" }, Corylus: { type: "line" } });
    expect(store().renderWarnings).toEqual([]);

    store().resetCurveStyle(curves("Betula", "Corylus"));
    store().removeCurveStyle("Moss line");
    expect(store().spec).toEqual(base);
  });
});
