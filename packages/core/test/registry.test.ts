import { describe, expect, it } from "vitest";
import { Registry } from "../src/registry.js";

describe("Registry", () => {
  it("registers and retrieves by type", () => {
    const r = new Registry<{ type: string; n: number }>("panel");
    r.register({ type: "b", n: 2 });
    r.register({ type: "a", n: 1 });
    expect(r.get("a").n).toBe(1);
    expect(r.types()).toEqual(["a", "b"]);
  });

  it("rejects duplicates and unknown types", () => {
    const r = new Registry<{ type: string }>("panel");
    r.register({ type: "x" });
    expect(() => r.register({ type: "x" })).toThrow();
    expect(() => r.get("y")).toThrow();
  });
});
