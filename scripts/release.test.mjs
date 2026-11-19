import { describe, expect, it } from "vitest";
import { compareVersions, notesFor } from "./release.mjs";

describe("compareVersions", () => {
  it("orders by semver precedence", () => {
    const ordered = ["0.1.0", "0.2.0-alpha", "0.2.0-alpha.1", "0.2.0-alpha.beta", "0.2.0-beta.2", "0.2.0-beta.11", "0.2.0-rc.1", "0.2.0", "0.10.0", "1.0.0"];
    const shuffled = [...ordered].reverse();
    expect(shuffled.sort(compareVersions)).toEqual(ordered);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("notesFor", () => {
  const sections = ["## Unreleased\n\n", "## 0.2.0 — 2026-12-01\n\n- Faster logs\n\n", "## 0.1.0 — 2026-11-19\n\n- First release\n"];
  it("returns the body of the matching version only", () => {
    expect(notesFor(sections, "0.2.0")).toBe("- Faster logs");
    expect(notesFor(sections, "0.1.0")).toBe("- First release");
    expect(notesFor(sections, "0.3.0")).toBeNull();
  });
});
