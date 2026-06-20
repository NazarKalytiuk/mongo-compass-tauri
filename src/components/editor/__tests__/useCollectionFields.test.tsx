import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  useCollectionFields,
  invalidateCollectionFields,
} from "../useCollectionFields";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const SAMPLE = {
  documents: [{ _id: "1", name: "Alice", profile: { age: 30 } }],
  total_count: 1,
};

describe("useCollectionFields", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(SAMPLE as any);
    invalidateCollectionFields("db", "coll");
    invalidateCollectionFields("db", "other");
  });

  it("samples the collection once and derives nested fields", async () => {
    const { result } = renderHook(() => useCollectionFields("db", "coll"));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));

    const names = result.current.fields.map((f) => f.name);
    expect(names).toContain("name");
    expect(names).toContain("profile.age");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      "find_documents",
      expect.objectContaining({ dbName: "db", collName: "coll", limit: 50 })
    );
  });

  it("serves a second consumer of the same collection from cache", async () => {
    const first = renderHook(() => useCollectionFields("db", "coll"));
    await waitFor(() => expect(first.result.current.fields.length).toBeGreaterThan(0));
    expect(invoke).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useCollectionFields("db", "coll"));
    // Cache hit — fields available immediately, no second fetch.
    expect(second.result.current.fields.length).toBeGreaterThan(0);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("refetches when the collection changes", async () => {
    const { result, rerender } = renderHook(
      ({ coll }) => useCollectionFields("db", coll),
      { initialProps: { coll: "coll" } }
    );
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));
    expect(invoke).toHaveBeenCalledTimes(1);

    rerender({ coll: "other" });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it("returns empty fields without a db/collection", () => {
    const { result } = renderHook(() => useCollectionFields("", ""));
    expect(result.current.fields).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("recovers gracefully when sampling fails", async () => {
    invalidateCollectionFields("db", "coll");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useCollectionFields("db", "coll"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.fields).toEqual([]);
  });
});
