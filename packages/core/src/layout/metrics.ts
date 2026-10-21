// Font metrics without a DOM — SPEC.md §6.
// Advance widths of Liberation Sans (fonts/, embedded in PDF/PNG export; metrically compatible
// with Arial/Helvetica) in 1/1000 em. Regular and italic widths are identical for these characters;
// test/metrics.test.ts checks the table against the font files. Deterministic by design: keep every
// text-width query going through estimateTextWidth in theme.ts so there is one place to swap.

/** Widths for U+0020 (space) … U+007E (~). */
const ASCII: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 0–9 : ; < = > ?
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // @ A–O
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // P–Z [ \ ] ^ _
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // ` a–o
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // p–z { | } ~
];

const EXTRA: Readonly<Record<string, number>> = {
  " ": 278, // no-break space
  "°": 400, // °
  "±": 549, // ±
  "µ": 576, // µ
  "×": 584, // ×
  "–": 556, // –
  "—": 1000, // —
  "‰": 1000, // ‰
};

/** Average lower-case advance, used for characters not in the table. */
const FALLBACK = 556;

/** Advance width of one character in em. Accented letters use their base letter. */
export function charWidth(ch: string): number {
  const code = ch.codePointAt(0)!;
  if (code >= 32 && code <= 126) return ASCII[code - 32]! / 1000;
  const extra = EXTRA[ch];
  if (extra !== undefined) return extra / 1000;
  const base = ch.normalize("NFD")[0]!;
  if (base !== ch) return charWidth(base);
  return FALLBACK / 1000;
}

/** Width of plain text (no markup) in em. */
export function textWidthEm(text: string): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w;
}
