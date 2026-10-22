import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);

export function readRepoFile(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

export function readRepoJson(path: string): unknown {
  return JSON.parse(readRepoFile(path));
}

/** SVG without line-ending differences and without <metadata> (which carries the spec hash). */
export function withoutMetadata(svg: string): string {
  return svg.replace(/\r\n/g, "\n").replace(/<metadata[^>]*>[^<]*<\/metadata>/, "");
}
