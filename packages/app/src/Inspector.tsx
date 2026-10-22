import { Braces, Spline, SlidersHorizontal } from "lucide-react";
import { CurveInspector } from "./CurveInspector";
import { SpecForm } from "./form/SpecForm";
import { SpecEditor } from "./SpecEditor";
import { useStore } from "./store";
import { Tabs, TabsContent, TabsList, TabsTrigger, toast } from "./ui";
import { useView, type InspectorTab } from "./view";

/**
 * Form | JSON: two editors of the one spec in the store. Form → JSON always works; JSON → Form only
 * when the JSON is valid (otherwise the JSON editor stays, showing its errors). A third tab, Curve,
 * appears while curves or a group are selected (preview or variable list).
 */
export function Inspector() {
  const { inspectorTab, showInspector, curveTab } = useView();
  const hasCurves = useView((s) => s.curveSelection !== null);
  const errorCount = useStore((s) => s.specErrors.length);
  const tab: InspectorTab | "curve" = errorCount > 0 ? "json" : curveTab && hasCurves ? "curve" : inspectorTab;
  const select = (v: string) => {
    if ((v === "form" || v === "curve") && errorCount > 0) {
      toast("Fix the JSON first", { description: `The form needs a valid spec; the JSON has ${errorCount} error${errorCount > 1 ? "s" : ""}.`, variant: "error" });
      return;
    }
    showInspector(v as InspectorTab | "curve");
  };
  return (
    <Tabs value={tab} onValueChange={select} activationMode="manual" className="flex h-full flex-col">
      <TabsList aria-label="Spec editor">
        <div className="inline-flex gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
          <TabsTrigger value="form">
            <SlidersHorizontal /> Form
          </TabsTrigger>
          <TabsTrigger value="json">
            <Braces /> JSON
          </TabsTrigger>
          {hasCurves && (
            <TabsTrigger value="curve">
              <Spline /> Curve
            </TabsTrigger>
          )}
        </div>
      </TabsList>
      <TabsContent value="form">
        <SpecForm />
      </TabsContent>
      <TabsContent value="json">
        <SpecEditor />
      </TabsContent>
      <TabsContent value="curve">
        <CurveInspector />
      </TabsContent>
    </Tabs>
  );
}
