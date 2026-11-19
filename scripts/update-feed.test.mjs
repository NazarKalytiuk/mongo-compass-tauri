import { describe, expect, it } from "vitest";
import { buildFeed } from "./update-feed.mjs";

const base = {
  repo: "NazarKalytiuk/mongo-compass-tauri",
  tag: "v0.2.0",
  notes: "- Faster\n",
  pubDate: new Date("2026-12-01T10:20:30.456Z"),
  platforms: [
    { key: "darwin-aarch64", asset: "mongo-compass-tauri_0.2.0_universal.app.tar.gz", signature: "bWFj\n" },
    { key: "darwin-x86_64", asset: "mongo-compass-tauri_0.2.0_universal.app.tar.gz", signature: "bWFj\n" },
    { key: "linux-x86_64", asset: "mongo-compass-tauri_0.2.0_amd64.AppImage", signature: "bGlu" },
    { key: "windows-x86_64", asset: "mongo-compass-tauri_0.2.0_x64-setup.exe", signature: "d2lu" },
  ],
};

describe("buildFeed", () => {
  it("links every platform to its artifact on the public download path", () => {
    const feed = buildFeed(base);
    const dl = "https://github.com/NazarKalytiuk/mongo-compass-tauri/releases/download/v0.2.0/";
    expect(feed).toEqual({
      version: "0.2.0",
      notes: "- Faster",
      pub_date: "2026-12-01T10:20:30Z",
      platforms: {
        "darwin-aarch64": { signature: "bWFj", url: `${dl}mongo-compass-tauri_0.2.0_universal.app.tar.gz` },
        "darwin-x86_64": { signature: "bWFj", url: `${dl}mongo-compass-tauri_0.2.0_universal.app.tar.gz` },
        "linux-x86_64": { signature: "bGlu", url: `${dl}mongo-compass-tauri_0.2.0_amd64.AppImage` },
        "windows-x86_64": { signature: "d2lu", url: `${dl}mongo-compass-tauri_0.2.0_x64-setup.exe` },
      },
    });
  });

  it("rejects a feed that installed apps could not use", () => {
    const with1 = (p) => ({ ...base, platforms: [{ ...base.platforms[0], ...p }] });
    expect(() => buildFeed(with1({ asset: "mongo-compass-tauri_0.2.0_universal.dmg" }))).toThrow(/not an updater artifact/);
    expect(() => buildFeed(with1({ key: "linux-x86_64" }))).toThrow(/not an updater artifact/);
    expect(() => buildFeed(with1({ key: "darwin-arm64" }))).toThrow(/unknown platform/);
    expect(() => buildFeed(with1({ signature: " \n" }))).toThrow(/empty signature/);
    expect(() => buildFeed({ ...base, platforms: [] })).toThrow(/no platforms/);
    expect(() => buildFeed({ ...base, tag: "0.2.0" })).toThrow(/invalid tag/);
  });
});
