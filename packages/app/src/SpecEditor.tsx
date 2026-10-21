import { useStore } from "./store";

export function SpecEditor() {
  const { specText, specErrors } = useStore();
  const setSpecText = useStore.getState().setSpecText;
  return (
    <div className="editor">
      <h3>Spec (JSON)</h3>
      <textarea
        spellCheck={false}
        value={specText}
        className={specErrors.length ? "invalid" : ""}
        onChange={(e) => setSpecText(e.target.value, { typing: true })}
      />
      {specErrors.length > 0 ? (
        <ul className="errors">
          <li className="muted">Preview shows the last valid spec.</li>
          {specErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : (
        <div className="ok">✓ valid</div>
      )}
    </div>
  );
}
