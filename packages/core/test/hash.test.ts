import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex, specHash } from "../src/io/hash.js";

describe("sha256Hex", () => {
  it("matches the FIPS 180-2 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("agrees with node:crypto across block boundaries and non-ASCII text", () => {
    for (const s of ["a".repeat(55), "a".repeat(56), "a".repeat(64), "b".repeat(1000), "*Quercus* 10 µm ± 2 °C — 𝛼"]) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });
});

describe("specHash", () => {
  it("ignores key order and undefined values, but not content", () => {
    const a = { specVersion: 5, page: { width: 85, height: 100 }, panels: [] };
    const b = { panels: [], page: { height: 100, width: 85, font: undefined }, specVersion: 5 };
    expect(canonicalJson(b)).toBe('{"page":{"height":100,"width":85},"panels":[],"specVersion":5}');
    expect(specHash(a)).toBe(specHash(b));
    expect(specHash({ ...a, page: { width: 86, height: 100 } })).not.toBe(specHash(a));
  });
});
