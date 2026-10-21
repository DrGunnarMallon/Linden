// Project persistence in IndexedDB (browser-local only; nothing is ever sent anywhere).

import type { Dataset, Spec } from "@linden/core";

export interface Project {
  datasets: Dataset[];
  /** Last valid spec (what is rendered). */
  spec: Spec;
  /** Editor contents; may be invalid JSON while the user is typing. */
  specText: string;
  importWarnings: string[];
}

const DB_NAME = "linden";
const STORE = "projects";
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }).finally(() => db.close()),
  );
}

export function loadProject(): Promise<Project | undefined> {
  return run<Project | undefined>("readonly", (s) => s.get(KEY));
}

export function saveProject(project: Project): Promise<void> {
  return run<void>("readwrite", (s) => s.put(project, KEY));
}
