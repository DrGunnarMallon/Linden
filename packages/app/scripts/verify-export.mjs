// End-to-end export check in a real browser: builds the app, serves it, opens it in the installed
// Google Chrome (playwright-core, no browser download), exports the demo as SVG, PDF, PNG (300/600/1200
// dpi, white and transparent) and a project bundle into examples/out/, then reads every file back.
//
//   npm run verify:export -w @linden/app          (needs Google Chrome; set CHROME_PATH to use another)

import { spawn, execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { parseProject, render, specHash } from "@linden/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium } from "playwright-core";

const root = new URL("../../../", import.meta.url);
const out = new URL("examples/out/", root);
const PORT = 4179;
mkdirSync(out, { recursive: true });

let failed = 0;
const check = (ok, message) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${message}`);
  if (!ok) failed++;
};

/** Page size of a PDF in mm, its text and fonts. */
async function readPdf(bytes) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false }).promise;
  const page = await pdf.getPage(1);
  const [x0, y0, x1, y1] = page.view;
  const text = (await page.getTextContent()).items.map((i) => i.str).join(" ");
  const raw = Buffer.from(bytes).toString("latin1");
  return { pages: pdf.numPages, w: ((x1 - x0) * 25.4) / 72, h: ((y1 - y0) * 25.4) / 72, text, raw };
}

/** IHDR size, pHYs dpi and the RGBA of pixel (0,0) (first-row filters leave pixel 0 unchanged). */
function readPng(bytes) {
  const b = Buffer.from(bytes);
  const r = { idat: [] };
  for (let off = 8; off < b.length; ) {
    const len = b.readUInt32BE(off);
    const type = b.toString("latin1", off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") Object.assign(r, { width: data.readUInt32BE(0), height: data.readUInt32BE(4), colourType: data[9] });
    if (type === "pHYs") r.dpi = (data.readUInt32BE(0) * 0.0254).toFixed(2);
    if (type === "IDAT") r.idat.push(data);
    off += 12 + len;
  }
  const px = inflateSync(Buffer.concat(r.idat)).subarray(1, 5);
  return { ...r, pixel0: [...px] };
}

const expectedPx = (mm, dpi) => Math.round((mm / 25.4) * dpi);

console.log("building the app…");
execSync("npm run build -w @linden/app", { cwd: root, stdio: "ignore" });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: new URL("packages/app/", root), stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector(".page svg");

  const save = async (click, name) => {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), click()]);
    const path = new URL(name, out);
    await dl.saveAs(path.pathname);
    return readFileSync(path);
  };
  const exportButton = (label) => page.locator(".top .export button", { hasText: new RegExp(`^${label}$`) });
  const pageSelect = page.locator(".preview .toolbar select");

  for (const [preset, w, h, tag] of [["double", 180, 120, "demo"], ["single", 85, 120, "demo-single-column"], ["a4Landscape", 297, 210, "demo-a4-landscape"]]) {
    await pageSelect.selectOption(preset);
    await page.waitForFunction(([w, h]) => document.querySelector(".page svg")?.getAttribute("width") === `${w}mm` && document.querySelector(".page svg")?.getAttribute("height") === `${h}mm`, [w, h]);
    console.log(`\n${tag}: ${w} × ${h} mm`);

    const svg = (await save(() => exportButton("SVG").click(), `${tag}.svg`)).toString("utf8");
    check(svg.includes(`width="${w}mm" height="${h}mm"`), `SVG page ${w} × ${h} mm`);
    check(/<metadata id="linden-metadata">generator: Linden [\d.]+; spec-sha256: [0-9a-f]{64}<\/metadata>/.test(svg), "SVG has <metadata> with version and spec hash");
    check((svg.match(/<g id="panel-\d+-\w+"/g) ?? []).length >= 2, `SVG has one <g id="panel-…"> per panel (${(svg.match(/<g id="panel-\d+-\w+"/g) ?? []).join(" ")})`);
    check(svg.includes(">Pinus</tspan>") || svg.includes(">Pinus<"), "SVG text stays <text>");

    const pdf = await readPdf(await save(() => exportButton("PDF").click(), `${tag}.pdf`));
    check(pdf.pages === 1, "PDF has one page");
    check(Math.abs(pdf.w - w) < 0.01 && Math.abs(pdf.h - h) < 0.01, `PDF page ${pdf.w.toFixed(3)} × ${pdf.h.toFixed(3)} mm (expected ${w} × ${h})`);
    check(["Depth", "Pinus", "Sphagnum", "Poaceae"].every((t) => pdf.text.includes(t)), "PDF text is extractable (selectable)");
    check((pdf.raw.match(/\/FontFile2 /g) ?? []).length === 2 && !/\/BaseFont \/(Helvetica|Times|Courier)/.test(pdf.raw), "PDF embeds Liberation Sans regular + italic, no standard fonts");

    for (const dpi of tag === "demo" ? [300, 600, 1200] : [300]) {
      await page.locator(".top .export select").selectOption(String(dpi));
      const png = readPng(await save(() => exportButton("PNG").click(), `${tag}-${dpi}dpi.png`));
      check(png.width === expectedPx(w, dpi) && png.height === expectedPx(h, dpi), `PNG ${dpi} dpi: ${png.width} × ${png.height} px (expected ${expectedPx(w, dpi)} × ${expectedPx(h, dpi)})`);
      check(Number(png.dpi) === dpi, `PNG records ${png.dpi} dpi (pHYs)`);
      check(png.pixel0.join() === "255,255,255,255", `PNG white background (pixel 0 = ${png.pixel0})`);
    }
  }

  console.log("\ntransparent PNG");
  await page.locator(".top .export input[type=checkbox]").uncheck();
  await page.locator(".top .export select").selectOption("300");
  const clear = readPng(await save(() => exportButton("PNG").click(), "demo-a4-landscape-300dpi-transparent.png"));
  check(clear.pixel0[3] === 0, `transparent background (pixel 0 alpha = ${clear.pixel0[3]})`);

  console.log("\nproject bundle");
  const bundleText = (await save(() => page.getByRole("button", { name: "Save project" }).click(), "demo.linden.json")).toString("utf8");
  const bundle = parseProject(bundleText);
  check(bundle.ok, "bundle parses");
  if (bundle.ok) {
    const svg = readFileSync(new URL("demo-a4-landscape.svg", out), "utf8");
    check(render(bundle.value.datasets, bundle.value.spec).svg !== "" && svg.includes(specHash(bundle.value.spec)), "bundle spec hash = hash in the exported SVG");
    // Open it in a fresh browser profile: the preview must be the same diagram.
    const fresh = await (await browser.newContext()).newPage();
    fresh.on("dialog", (d) => void d.accept());
    await fresh.goto(`http://localhost:${PORT}/`);
    await fresh.waitForSelector(".page svg");
    await fresh.locator('input[type=file][accept^=".linden.json"]').setInputFiles(new URL("demo.linden.json", out).pathname);
    await fresh.waitForFunction(() => document.querySelector(".page svg")?.getAttribute("width") === "297mm");
    const reopened = await fresh.locator(".page").innerHTML();
    check(reopened.includes(specHash(bundle.value.spec)), "re-opened bundle renders the same spec (same hash in the preview)");
  }

  await page.screenshot({ path: new URL("app-screenshot.png", out).pathname });
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(new URL("README.txt", out), "Generated by npm run verify:export -w @linden/app\n");
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall export checks passed; files in examples/out/");
process.exit(failed ? 1 : 0);
