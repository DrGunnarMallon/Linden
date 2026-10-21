// The bundled export font (fonts/, SIL OFL 1.1). Core's text metrics are this font's metrics
// (core/src/layout/metrics.ts), so PDF and PNG output match the layout on every OS.

export const EMBEDDED_FONT = "Liberation Sans";

export interface FontFiles {
  regular: Uint8Array;
  italic: Uint8Array;
}

/** Families Liberation Sans is metrically compatible with: substituting it changes no layout. */
const COMPATIBLE = new Set(["arial", "helvetica", "liberation sans", "arimo", "sans-serif"]);

/** Warning when the spec's font is not one the bundled font stands in for (null if it is). */
export function fontSubstitutionWarning(family: string): string | null {
  const first = family.split(",")[0]!.trim().replace(/^["']|["']$/g, "").toLowerCase();
  return COMPATIBLE.has(first)
    ? null
    : `Font "${family}" is not bundled; the export uses ${EMBEDDED_FONT} (Arial metrics, which the layout is measured with).`;
}

/** Points every font-family in core's SVG (attributes only, canonical output) at the embedded font. */
export function useEmbeddedFont(svg: string): string {
  return svg.replace(/font-family="[^"]*"/g, `font-family="${EMBEDDED_FONT}"`);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Page size in mm from the root <svg width="…mm" height="…mm"> that core writes. */
export function svgSizeMm(svg: string): { width: number; height: number } {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const width = /\bwidth="([\d.]+)mm"/.exec(root)?.[1];
  const height = /\bheight="([\d.]+)mm"/.exec(root)?.[1];
  if (width === undefined || height === undefined) throw new Error("SVG has no width/height in mm.");
  return { width: Number(width), height: Number(height) };
}

/** Text of core's <metadata id="linden-metadata"> (generator and spec hash), if present. */
export function svgMetadataText(svg: string): string | undefined {
  return /<metadata id="linden-metadata">([^<]*)<\/metadata>/.exec(svg)?.[1];
}

let files: Promise<FontFiles> | undefined;

/** Fetches the bundled TTFs once (browser; Vite serves them as assets). */
export function loadFontFiles(): Promise<FontFiles> {
  files ??= (async () => {
    const [regularUrl, italicUrl] = await Promise.all([
      import("../../../../fonts/LiberationSans-Regular.ttf?url").then((m) => m.default),
      import("../../../../fonts/LiberationSans-Italic.ttf?url").then((m) => m.default),
    ]);
    const get = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load the export font (${res.status}).`);
      return new Uint8Array(await res.arrayBuffer());
    };
    const [regular, italic] = await Promise.all([get(regularUrl), get(italicUrl)]);
    return { regular, italic };
  })();
  files.catch(() => (files = undefined));
  return files;
}

let registered: Promise<void> | undefined;

/** Makes the font available to the page (once), so svg2pdf's text measuring (anchors, tspans) uses it. */
export function registerDocumentFont(fonts: FontFiles): Promise<void> {
  registered ??= (async () => {
    const faces = [
      new FontFace(EMBEDDED_FONT, fonts.regular.slice().buffer, { style: "normal" }),
      new FontFace(EMBEDDED_FONT, fonts.italic.slice().buffer, { style: "italic" }),
    ];
    for (const face of faces) document.fonts.add(await face.load());
  })();
  registered.catch(() => (registered = undefined));
  return registered;
}
