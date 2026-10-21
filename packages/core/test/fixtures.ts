import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);

export function readRepoFile(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

export function readRepoJson(path: string): unknown {
  return JSON.parse(readRepoFile(path));
}
