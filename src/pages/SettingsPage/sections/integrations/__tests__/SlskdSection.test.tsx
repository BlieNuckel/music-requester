import { render, screen, fireEvent } from "@testing-library/react";
import SlskdSection from "../SlskdSection";

const baseProps = {
  url: "http://slskd:5030",
  apiKey: "key",
  downloadPath: "/downloads",
  indexerApiKey: "",
  testing: false,
  onUrlChange: vi.fn(),
  onApiKeyChange: vi.fn(),
  onDownloadPathChange: vi.fn(),
  onIndexerApiKeyChange: vi.fn(),
  onTest: vi.fn(),
  isConnected: false,
  autoSetupStatus: null,
  autoSetupLoading: false,
  onAutoSetup: vi.fn(),
};

describe("SlskdSection", () => {
  it("renders a test connection button", () => {
    render(<SlskdSection {...baseProps} />);
    expect(
      screen.getByRole("button", { name: "Test Connection" })
    ).toBeInTheDocument();
  });

  it("calls onTest when the button is clicked", () => {
    const onTest = vi.fn();
    render(<SlskdSection {...baseProps} onTest={onTest} />);

    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it("disables the test button when url or api key is empty", () => {
    render(<SlskdSection {...baseProps} apiKey="" />);
    expect(
      screen.getByRole("button", { name: "Test Connection" })
    ).toBeDisabled();
  });

  it("shows a testing label while testing", () => {
    render(<SlskdSection {...baseProps} testing />);
    const button = screen.getByRole("button", { name: "Testing..." });
    expect(button).toBeDisabled();
  });

  it("reports indexer api key edits", () => {
    const onIndexerApiKeyChange = vi.fn();
    render(
      <SlskdSection
        {...baseProps}
        onIndexerApiKeyChange={onIndexerApiKeyChange}
      />
    );

    fireEvent.change(screen.getByLabelText("Indexer API Key"), {
      target: { value: "s3cret" },
    });
    expect(onIndexerApiKeyChange).toHaveBeenCalledWith("s3cret");
  });
});
