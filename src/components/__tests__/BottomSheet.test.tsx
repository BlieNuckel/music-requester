import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import BottomSheet from "../BottomSheet";

function getSheetEl() {
  return document.querySelector(".rounded-t-2xl") as HTMLElement;
}

function dispatchTouch(
  target: HTMLElement,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  clientY: number
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: [{ clientY }],
  });
  target.dispatchEvent(event);
  return event;
}

describe("BottomSheet", () => {
  it("renders nothing when closed", () => {
    render(
      <BottomSheet isOpen={false} onClose={vi.fn()}>
        content
      </BottomSheet>
    );

    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("renders children when open", () => {
    render(
      <BottomSheet isOpen={true} onClose={vi.fn()}>
        <p>sheet content</p>
      </BottomSheet>
    );

    expect(screen.getByText("sheet content")).toBeInTheDocument();
  });

  it("renders title when provided", () => {
    render(
      <BottomSheet isOpen={true} onClose={vi.fn()} title="My Title">
        content
      </BottomSheet>
    );

    expect(screen.getByText("My Title")).toBeInTheDocument();
  });

  it("calls onClose when backdrop area is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <BottomSheet isOpen={true} onClose={onClose}>
        content
      </BottomSheet>
    );

    const backdrop = document.querySelector(".bg-black\\/60")!;
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not lock main scroll when closed", () => {
    const main = document.createElement("main");
    document.body.appendChild(main);

    render(
      <BottomSheet isOpen={false} onClose={vi.fn()}>
        content
      </BottomSheet>
    );

    expect(main.style.overflow).toBe("");
    document.body.removeChild(main);
  });

  it("locks main scroll when open and restores on close", () => {
    vi.useFakeTimers();
    const main = document.createElement("main");
    document.body.appendChild(main);

    const { rerender } = render(
      <BottomSheet isOpen={true} onClose={vi.fn()}>
        content
      </BottomSheet>
    );

    expect(main.style.overflow).toBe("hidden");

    rerender(
      <BottomSheet isOpen={false} onClose={vi.fn()}>
        content
      </BottomSheet>
    );

    act(() => {
      vi.runAllTimers();
    });
    expect(main.style.overflow).toBe("");
    document.body.removeChild(main);
    vi.useRealTimers();
  });

  it("does not call onClose when sheet content is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <BottomSheet isOpen={true} onClose={onClose}>
        <button>inner button</button>
      </BottomSheet>
    );

    await user.click(screen.getByText("inner button"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when swiped down past dismiss threshold", () => {
    const onClose = vi.fn();

    render(
      <BottomSheet isOpen={true} onClose={onClose}>
        content
      </BottomSheet>
    );

    const sheet = getSheetEl();
    act(() => {
      dispatchTouch(sheet, "touchstart", 100);
      dispatchTouch(sheet, "touchmove", 260);
      dispatchTouch(sheet, "touchend", 260);
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when swipe is below threshold", () => {
    const onClose = vi.fn();

    render(
      <BottomSheet isOpen={true} onClose={onClose}>
        content
      </BottomSheet>
    );

    const sheet = getSheetEl();
    act(() => {
      dispatchTouch(sheet, "touchstart", 100);
      dispatchTouch(sheet, "touchmove", 140);
      dispatchTouch(sheet, "touchend", 140);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose when tapped after an earlier swipe dismiss", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    const { rerender } = render(
      <BottomSheet isOpen={true} onClose={onClose}>
        <button>inner button</button>
      </BottomSheet>
    );

    act(() => {
      const sheet = getSheetEl();
      dispatchTouch(sheet, "touchstart", 100);
      dispatchTouch(sheet, "touchmove", 300);
      dispatchTouch(sheet, "touchend", 300);
    });
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <BottomSheet isOpen={false} onClose={onClose}>
        <button>inner button</button>
      </BottomSheet>
    );
    act(() => {
      vi.runAllTimers();
    });

    rerender(
      <BottomSheet isOpen={true} onClose={onClose}>
        <button>inner button</button>
      </BottomSheet>
    );
    act(() => {
      vi.runAllTimers();
    });

    act(() => {
      const button = screen.getByText("inner button");
      dispatchTouch(button, "touchstart", 200);
      dispatchTouch(button, "touchend", 200);
    });

    expect(onClose).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("stays closed when a settle finishes after the sheet was closed", () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <BottomSheet isOpen={true} onClose={vi.fn()}>
        <p>sheet content</p>
      </BottomSheet>
    );

    act(() => {
      const sheet = getSheetEl();
      dispatchTouch(sheet, "touchstart", 100);
      dispatchTouch(sheet, "touchmove", 140);
      dispatchTouch(sheet, "touchend", 140);
    });

    rerender(
      <BottomSheet isOpen={false} onClose={vi.fn()}>
        <p>sheet content</p>
      </BottomSheet>
    );
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.queryByText("sheet content")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("calls preventDefault on touchmove during a downward drag", () => {
    render(
      <BottomSheet isOpen={true} onClose={vi.fn()}>
        content
      </BottomSheet>
    );

    const sheet = getSheetEl();
    let moveEvent!: Event;
    act(() => {
      dispatchTouch(sheet, "touchstart", 100);
      moveEvent = dispatchTouch(sheet, "touchmove", 200);
    });

    expect(moveEvent.defaultPrevented).toBe(true);
  });
});
