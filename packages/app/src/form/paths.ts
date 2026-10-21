// Immutable edits at a concrete path in the spec (the form's only way to change it). Key order is kept,
// so a form edit changes nothing in the JSON but the edited value.

export type Path = readonly (string | number)[];

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** "panels[1].style.mode" — same format as parseSpec's error paths. */
export function pathString(path: Path): string {
  let out = "";
  for (const key of path) out += typeof key === "number" ? `[${key}]` : out === "" ? key : `.${key}`;
  return out === "" ? "(root)" : out;
}

export function getIn(root: unknown, path: Path): unknown {
  let cur = root;
  for (const key of path) {
    if (typeof key === "number" ? !Array.isArray(cur) : !isObj(cur)) return undefined;
    cur = (cur as Obj)[key as string];
  }
  return cur;
}

/** Sets `value` at `path`, creating missing objects / arrays on the way; `undefined` removes the key. */
export function setIn<T>(root: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [key, ...rest] = path as [string | number, ...(string | number)[]];
  if (typeof key === "number") {
    const arr = Array.isArray(root) ? [...(root as unknown[])] : [];
    if (rest.length === 0 && value === undefined) arr.splice(key, 1);
    else arr[key] = setIn(arr[key], rest, value);
    return arr as T;
  }
  const obj: Obj = isObj(root) ? { ...root } : {};
  if (rest.length === 0 && value === undefined) delete obj[key];
  else obj[key] = setIn(obj[key], rest, value);
  return obj as T;
}

/** Removes the key or array item at `path`. */
export function removeIn<T>(root: T, path: Path): T {
  return setIn(root, path, undefined);
}

/** Moves an item of the array at `path` from one index to another. */
export function moveItem<T>(root: T, path: Path, from: number, to: number): T {
  const arr = getIn(root, path);
  if (!Array.isArray(arr) || from === to) return root;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return setIn(root, path, next);
}

/** Renames a key of the object at `path`, keeping its position. No-op if `to` exists already. */
export function renameKey<T>(root: T, path: Path, from: string, to: string): T {
  const obj = getIn(root, path);
  if (!isObj(obj) || !(from in obj) || to in obj) return root;
  return setIn(root, path, Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v])));
}
