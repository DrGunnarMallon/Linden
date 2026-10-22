// Fails if any runtime (non-dev) dependency of any workspace, transitive ones included, has a
// licence outside the allow-list (CLAUDE.md rule 8). Uses `npm ls`, which resolves workspaces
// and hoisting the way Node does. SPDX expressions: "A OR B" passes if either side passes,
// "A AND B" only if both do.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Zlib"]);
/** OFL-1.1 is accepted for font packages only. */
const FONT_PACKAGE = /^@fontsource(-variable)?\//;

function licenceOf(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === "string") return l;
  if (Array.isArray(l)) return l.map((x) => (typeof x === "string" ? x : x.type)).join(" OR ");
  if (l && typeof l === "object") return l.type;
  return undefined;
}

function allowedTerm(term, name) {
  if (ALLOWED.has(term)) return true;
  return term === "OFL-1.1" && FONT_PACKAGE.test(name);
}

/** Minimal SPDX evaluation: parentheses, OR, AND; "SEE LICENSE IN …" counts as not allowed. */
function allowed(expr, name) {
  const tokens = expr.replace(/[()]/g, " $& ").split(/\s+/).filter(Boolean);
  let i = 0;
  const primary = () => {
    if (tokens[i] === "(") {
      i++;
      const v = or();
      i++; // ")"
      return v;
    }
    const words = [];
    while (i < tokens.length && !["AND", "OR", ")"].includes(tokens[i])) words.push(tokens[i++]);
    return words.length === 1 && allowedTerm(words[0], name);
  };
  const and = () => {
    let v = primary();
    while (tokens[i] === "AND") {
      i++;
      v = primary() && v;
    }
    return v;
  };
  const or = () => {
    let v = and();
    while (tokens[i] === "OR") {
      i++;
      v = and() || v;
    }
    return v;
  };
  return or();
}

const paths = execSync("npm ls --all --omit=dev --parseable", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split(/\r?\n/)
  .filter(Boolean);

const failures = [];
let checked = 0;
for (const dir of new Set(paths)) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  // The repo's own workspaces (root: MIT; private packages have no licence field).
  if (pkg.name === "linden" || pkg.name?.startsWith("@linden/")) continue;
  checked++;
  const licence = licenceOf(pkg);
  if (!licence || !allowed(licence, pkg.name)) failures.push(`${pkg.name}@${pkg.version}: ${licence ?? "no licence field"}`);
}

if (failures.length > 0) {
  console.error(`Licence check failed: ${failures.length} of ${checked} runtime packages are not under an allowed licence:`);
  for (const f of failures.sort()) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`Licence check passed: ${checked} runtime packages, all under ${[...ALLOWED].join(", ")} (OFL-1.1 for fonts).`);
