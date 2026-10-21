// PDF export: jsPDF + svg2pdf.js. Vector output, page = the diagram's page in mm, the bundled font
// embedded (with a ToUnicode map, so text stays selectable and searchable). SPEC.md §10.

import { LINDEN_VERSION, type Exporter } from "@linden/core";
import { EMBEDDED_FONT, loadFontFiles, registerDocumentFont, svgMetadataText, svgSizeMm, toBase64, useEmbeddedFont, type FontFiles } from "./fonts";

/** Converts core's SVG to PDF bytes. Needs a DOM (DOMParser); jsPDF and svg2pdf.js load on first use. */
export async function svgToPdf(svg: string, fonts: FontFiles): Promise<Uint8Array<ArrayBuffer>> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const { width, height } = svgSizeMm(svg);
  // jsPDF swaps the sides of `format` to match `orientation`, so derive it from the page.
  const doc = new jsPDF({ unit: "mm", format: [width, height], orientation: width > height ? "landscape" : "portrait", compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS("LiberationSans-Regular.ttf", toBase64(fonts.regular));
  doc.addFont("LiberationSans-Regular.ttf", EMBEDDED_FONT, "normal");
  doc.addFileToVFS("LiberationSans-Italic.ttf", toBase64(fonts.italic));
  doc.addFont("LiberationSans-Italic.ttf", EMBEDDED_FONT, "italic");
  doc.setFont(EMBEDDED_FONT, "normal");
  doc.setProperties({ title: "Linden diagram", creator: `Linden ${LINDEN_VERSION}`, subject: svgMetadataText(svg) ?? "" });

  const root = new DOMParser().parseFromString(useEmbeddedFont(svg), "image/svg+xml").documentElement;
  await svg2pdf(root, doc, { x: 0, y: 0, width, height });
  return new Uint8Array(doc.output("arraybuffer"));
}

export const pdfExporter: Exporter = {
  type: "pdf",
  async export(svg) {
    const fonts = await loadFontFiles();
    await registerDocumentFont(fonts);
    return new Blob([await svgToPdf(svg, fonts)], { type: "application/pdf" });
  },
};
