import { resolveSpec, type Dataset } from "@linden/core";
import { Fragment, useMemo } from "react";
import { variableVisibility } from "./specEdit";
import { useStore } from "./store";

/** "*Alnus*-type" → <i>Alnus</i>-type */
function TaxonName({ name }: { name: string }) {
  return (
    <>
      {name.split(/(\*[^*]+\*)/).map((part, i) =>
        /^\*[^*]+\*$/.test(part) ? <i key={i}>{part.slice(1, -1)}</i> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

interface GroupRow {
  id: string | undefined;
  name: string;
  variables: Dataset["variables"];
}

function groupRows(ds: Dataset, presetGroups: { id: string; name: string; order: number }[]): GroupRow[] {
  const rank = (id: string | undefined) => {
    if (id === undefined) return [2, 0];
    const p = presetGroups.find((g) => g.id === id);
    if (p) return [0, p.order];
    return [1, ds.groups.find((g) => g.id === id)?.order ?? 0];
  };
  const ids = [...new Set(ds.variables.map((v) => v.group))];
  ids.sort((a, b) => {
    const [ra, oa] = rank(a);
    const [rb, ob] = rank(b);
    return ra! - rb! || oa! - ob!;
  });
  return ids.map((id) => ({
    id,
    name: id === undefined ? "Ungrouped" : (presetGroups.find((g) => g.id === id)?.name ?? ds.groups.find((g) => g.id === id)?.name ?? id),
    variables: ds.variables.filter((v) => v.group === id),
  }));
}

function DatasetBlock({ ds }: { ds: Dataset }) {
  const { spec, presets, specErrors } = useStore();
  const { setVariableVisible, removeDataset } = useStore.getState();
  const presetGroups = useMemo(() => resolveSpec(spec, presets).spec.groups, [spec, presets]);
  const visibility = useMemo(() => variableVisibility(spec, presets, ds), [spec, presets, ds]);
  const locked = specErrors.length > 0;

  return (
    <section className="dataset">
      <h3>
        {ds.name}
        <button
          className="link"
          title="Remove this dataset and its panels"
          onClick={() => {
            if (confirm(`Remove dataset "${ds.name}" and its panels?`)) removeDataset(ds.id);
          }}
        >
          ×
        </button>
      </h3>
      <div className="muted">
        {ds.samples.length} samples · {ds.variables.length} variables · depth in {ds.depthUnit}
      </div>
      {groupRows(ds, presetGroups).map((g) => (
        <div key={g.id ?? ""} className="group">
          <h4>{g.name}</h4>
          {g.variables.map((v) => {
            const vis = visibility.get(v.id);
            const disabled = locked || (vis?.visible === true && !vis.canHide);
            return (
              <label
                key={v.id}
                className="variable"
                title={locked ? "Fix the spec errors first" : disabled ? "A panel needs at least one variable" : `${v.id} · ${v.kind}`}
              >
                <input
                  type="checkbox"
                  checked={vis?.visible ?? false}
                  disabled={disabled}
                  onChange={(e) => setVariableVisible(ds.id, v.id, e.target.checked)}
                />
                <TaxonName name={v.name} />
                <span className="muted"> {v.kind}</span>
              </label>
            );
          })}
        </div>
      ))}
    </section>
  );
}

export function VariableList() {
  const datasets = useStore((s) => s.datasets);
  if (datasets.length === 0) return <p className="muted">No data. Use “Import CSV…” above.</p>;
  return (
    <>
      {datasets.map((ds) => (
        <DatasetBlock key={ds.id} ds={ds} />
      ))}
    </>
  );
}
