import { render, screen, fireEvent } from "@testing-library/react";
import ImportReview from "../ImportReview";
import type { ManualImportItem } from "../../hooks/useManualImport";

function makeItem(overrides: Partial<ManualImportItem> = {}): ManualImportItem {
  return {
    path: "/music/file.flac",
    name: "test-file.flac",
    quality: { quality: { id: 7, name: "FLAC" } },
    rejections: [],
    tracks: [{ id: 1, title: "Track 1", trackNumber: "1" }],
    albumReleaseId: 1,
    indexerFlags: 0,
    downloadId: "",
    disableReleaseSwitching: false,
    artist: { id: 1 },
    album: { id: 1 },
    ...overrides,
  };
}

describe("ImportReview", () => {
  it("renders item names", () => {
    const items = [makeItem({ name: "song.flac" })];
    render(
      <ImportReview items={items} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText("song.flac")).toBeInTheDocument();
  });

  it("shows rejection reasons inline", () => {
    const items = [
      makeItem({
        rejections: [{ reason: "bad quality" }, { reason: "wrong format" }],
      }),
    ];
    render(
      <ImportReview items={items} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText("bad quality")).toBeInTheDocument();
    expect(screen.getByText("wrong format")).toBeInTheDocument();
  });

  it("shows single rejection reason inline", () => {
    const items = [makeItem({ rejections: [{ reason: "issue" }] })];
    render(
      <ImportReview items={items} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText("issue")).toBeInTheDocument();
  });

  it("shows correct button text for singular file", () => {
    render(
      <ImportReview
        items={[makeItem()]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText("Confirm Import (1 file)")).toBeInTheDocument();
  });

  it("shows correct button text for plural files", () => {
    render(
      <ImportReview
        items={[makeItem(), makeItem()]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText("Confirm Import (2 files)")).toBeInTheDocument();
  });

  it("blocks the import when Lidarr matched no tracks", () => {
    const onConfirm = vi.fn();
    render(
      <ImportReview
        items={[makeItem({ tracks: [] })]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(
      screen.getByText(/could not determine: track match/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Confirm Import/)).toBeDisabled();

    fireEvent.click(screen.getByText(/Confirm Import/));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("blocks the import when the quality came back Unknown", () => {
    render(
      <ImportReview
        items={[makeItem({ quality: { quality: { id: 0, name: "Unknown" } } })]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(
      screen.getByText(/could not determine: quality/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Confirm Import/)).toBeDisabled();
  });

  it("names every field Lidarr left unresolved", () => {
    render(
      <ImportReview
        items={[
          {
            path: "/music/mystery.flac",
            name: "mystery.flac",
          },
        ]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        "Lidarr could not determine: artist, album, album release, track match, quality"
      )
    ).toBeInTheDocument();
  });

  it("calls onConfirm and onCancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ImportReview
        items={[makeItem()]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByText(/Confirm Import/));
    expect(onConfirm).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
