import { useStore } from "./store";

export function Warnings() {
  const { importWarnings, renderWarnings, presetWarnings, storageWarnings } = useStore();
  const sections: [string, string[]][] = [
    ["Import", importWarnings],
    ["Render", renderWarnings],
    ["Presets", presetWarnings],
    ["Storage", storageWarnings],
  ];
  const total = sections.reduce((n, [, w]) => n + w.length, 0);
  return (
    <div className="warnings">
      <h3>Warnings ({total})</h3>
      {total === 0 && <div className="muted">None.</div>}
      {sections.map(([label, list]) =>
        list.length === 0 ? null : (
          <ul key={label}>
            {list.map((w, i) => (
              <li key={i}>
                <span className="tag">{label}</span> {w}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
