import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLabelAncestors } from "./labels";

const mockFetch = vi.fn();
const mockAcquireMbSlot = vi.fn((..._args: unknown[]) => Promise.resolve());

vi.mock("../resilientFetch", () => ({
  resilientFetch: (...args: unknown[]) => mockFetch(...args),
}));

vi.mock("./queue", () => ({
  acquireMbSlot: (...args: unknown[]) => mockAcquireMbSlot(...args),
  reportMbSuccess: () => {},
  reportMbThrottled: () => {},
}));

import { clearMbCache } from "./cache";

beforeEach(() => {
  vi.resetAllMocks();
  mockAcquireMbSlot.mockResolvedValue(undefined);
  clearMbCache();
});

function okResponse(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function errorResponse(status: number) {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

function labelWithParent(
  id: string,
  name: string,
  parentId: string,
  parentName: string
) {
  return {
    id,
    name,
    relations: [
      {
        type: "label ownership",
        direction: "backward",
        ended: false,
        label: { id: parentId, name: parentName },
      },
    ],
  };
}

function labelWithoutParent(id: string, name: string) {
  return { id, name, relations: [] };
}

describe("getLabelAncestors", () => {
  it("returns single parent", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse(
        labelWithParent("l-1", "Polydor", "l-2", "Universal Music Group")
      )
    );
    mockFetch.mockResolvedValueOnce(
      okResponse(labelWithoutParent("l-2", "Universal Music Group"))
    );

    const result = await getLabelAncestors("l-1");
    expect(result).toEqual([{ name: "Universal Music Group", mbid: "l-2" }]);
  });

  it("walks multiple levels", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse(
        labelWithParent("l-1", "Interscope", "l-2", "Interscope Geffen")
      )
    );
    mockFetch.mockResolvedValueOnce(
      okResponse(
        labelWithParent(
          "l-2",
          "Interscope Geffen",
          "l-3",
          "Universal Music Group"
        )
      )
    );
    mockFetch.mockResolvedValueOnce(
      okResponse(labelWithoutParent("l-3", "Universal Music Group"))
    );

    const result = await getLabelAncestors("l-1");
    expect(result).toEqual([
      { name: "Interscope Geffen", mbid: "l-2" },
      { name: "Universal Music Group", mbid: "l-3" },
    ]);
  });

  it("returns empty array when label has no parent", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse(labelWithoutParent("l-1", "Warp Records"))
    );

    const result = await getLabelAncestors("l-1");
    expect(result).toEqual([]);
  });

  it("returns empty array on fetch error", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404));

    const result = await getLabelAncestors("l-bad");
    expect(result).toEqual([]);
  });

  it("ignores ended ownership relationships", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        id: "l-1",
        name: "Some Label",
        relations: [
          {
            type: "label ownership",
            direction: "backward",
            ended: true,
            label: { id: "l-2", name: "Old Parent" },
          },
        ],
      })
    );

    const result = await getLabelAncestors("l-1");
    expect(result).toEqual([]);
  });

  it("ignores forward (subsidiary) relationships", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        id: "l-1",
        name: "Big Label",
        relations: [
          {
            type: "label ownership",
            direction: "forward",
            ended: false,
            label: { id: "l-2", name: "Subsidiary" },
          },
        ],
      })
    );

    const result = await getLabelAncestors("l-1");
    expect(result).toEqual([]);
  });

  it("stops on circular references", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse(labelWithParent("l-1", "Label A", "l-2", "Label B"))
    );
    mockFetch.mockResolvedValueOnce(
      okResponse(labelWithParent("l-2", "Label B", "l-1", "Label A"))
    );

    const result = await getLabelAncestors("l-1");
    expect(result).toEqual([{ name: "Label B", mbid: "l-2" }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("collects all active parents when a label has multiple owners", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        id: "l-1",
        name: "Atlantic",
        relations: [
          {
            type: "label ownership",
            direction: "backward",
            ended: false,
            label: { id: "l-2", name: "Warner Bros.-Seven Arts Records" },
          },
          {
            type: "label ownership",
            direction: "backward",
            ended: false,
            label: { id: "l-3", name: "Warner Music Group" },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(
      okResponse(labelWithoutParent("l-2", "Warner Bros.-Seven Arts Records"))
    );
    mockFetch.mockResolvedValueOnce(
      okResponse(labelWithoutParent("l-3", "Warner Music Group"))
    );

    const result = await getLabelAncestors("l-1");
    expect(result).toEqual([
      { name: "Warner Bros.-Seven Arts Records", mbid: "l-2" },
      { name: "Warner Music Group", mbid: "l-3" },
    ]);
  });

  it("deduplicates shared ancestors across branches", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        id: "l-1",
        name: "Sub Label",
        relations: [
          {
            type: "label ownership",
            direction: "backward",
            ended: false,
            label: { id: "l-2", name: "Branch A" },
          },
          {
            type: "label ownership",
            direction: "backward",
            ended: false,
            label: { id: "l-3", name: "Branch B" },
          },
        ],
      })
    );
    mockFetch.mockResolvedValueOnce(
      okResponse(labelWithParent("l-2", "Branch A", "l-4", "Top Corp"))
    );
    mockFetch.mockResolvedValueOnce(
      okResponse(labelWithParent("l-3", "Branch B", "l-4", "Top Corp"))
    );
    mockFetch.mockResolvedValueOnce(
      okResponse(labelWithoutParent("l-4", "Top Corp"))
    );

    const result = await getLabelAncestors("l-1");
    expect(result).toEqual([
      { name: "Branch A", mbid: "l-2" },
      { name: "Branch B", mbid: "l-3" },
      { name: "Top Corp", mbid: "l-4" },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("stops early when shouldStop returns true", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse(
        labelWithParent("l-1", "Interscope", "l-2", "Interscope Geffen")
      )
    );
    mockFetch.mockResolvedValueOnce(
      okResponse(
        labelWithParent(
          "l-2",
          "Interscope Geffen",
          "l-3",
          "Universal Music Group"
        )
      )
    );

    const result = await getLabelAncestors("l-1", {
      shouldStop: (ancestors) =>
        ancestors.some((a) => a.name === "Interscope Geffen"),
    });

    expect(result).toEqual([{ name: "Interscope Geffen", mbid: "l-2" }]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("calls onAncestorFound for each discovered ancestor", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse(
        labelWithParent("l-1", "Polydor", "l-2", "Universal Music Group")
      )
    );
    mockFetch.mockResolvedValueOnce(
      okResponse(labelWithoutParent("l-2", "Universal Music Group"))
    );

    const onFound = vi.fn();
    await getLabelAncestors("l-1", { onAncestorFound: onFound });

    expect(onFound).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledWith({
      name: "Universal Music Group",
      mbid: "l-2",
    });
  });
});
