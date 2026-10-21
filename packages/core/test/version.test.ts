import { describe, expect, it } from "vitest";
import { LINDEN_VERSION } from "../src/version.js";
import { readRepoJson } from "./fixtures.js";

describe("LINDEN_VERSION", () => {
  it("equals the core package version", () => {
    expect(LINDEN_VERSION).toBe((readRepoJson("packages/core/package.json") as { version: string }).version);
  });
});
