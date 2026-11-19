import { describe, it, expect, vi } from "vitest";
import { formatBytes, installUpdate } from "../../updater";

describe("installUpdate", () => {
  it("reports cumulative progress and ignores events that arrive after it finished", async () => {
    let emit: (e: any) => void = () => {};
    const update = {
      downloadAndInstall: vi.fn(async (onEvent: (e: any) => void) => {
        emit = onEvent;
        onEvent({ event: "Started", data: { contentLength: 300 } });
        onEvent({ event: "Progress", data: { chunkLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 200 } });
      }),
    } as any;
    const progress: Array<[number, number | null]> = [];
    await installUpdate(update, (received, total) => progress.push([received, total]));
    // The channel delivers late: the finished state must not be overwritten.
    emit({ event: "Progress", data: { chunkLength: 50 } });
    expect(progress).toEqual([
      [0, 300],
      [100, 300],
      [300, 300],
    ]);
  });
});

describe("formatBytes", () => {
  it("uses binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});
