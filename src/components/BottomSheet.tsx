import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useHaptics from "../hooks/useHaptics";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

type SheetPhase =
  "entering" | "open" | "dragging" | "settling" | "exiting" | "closed";

const DISMISS_THRESHOLD = 100;
const EXIT_DURATION = 200;
const SETTLE_DURATION = 200;

export default function BottomSheet({
  isOpen,
  onClose,
  children,
  title,
}: BottomSheetProps) {
  const haptics = useHaptics();
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [phase, setPhase] = useState<SheetPhase>(
    isOpen ? "entering" : "closed"
  );
  const [dragY, setDragY] = useState(0);
  const touchStartY = useRef(0);
  const isDragging = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<SheetPhase>(phase);
  const dragYRef = useRef(0);
  const onCloseRef = useRef(onClose);
  const hapticsRef = useRef(haptics);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    hapticsRef.current = haptics;
  }, [haptics]);

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setPhase("entering");
      setDragY(0);
    } else if (phase !== "exiting" && phase !== "closed") {
      setPhase("exiting");
    }
  }

  useEffect(() => {
    if (phase === "exiting") {
      const timer = setTimeout(() => {
        setPhase("closed");
        dragYRef.current = 0;
        setDragY(0);
      }, EXIT_DURATION);
      return () => clearTimeout(timer);
    }
    if (phase === "settling") {
      const timer = setTimeout(() => setPhase("open"), SETTLE_DURATION);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  const isVisible = phase !== "closed";

  useEffect(() => {
    if (!isVisible) return;
    const scrollableMain = document.querySelector("main");
    if (!scrollableMain) return;
    const prev = scrollableMain.style.overflow;
    scrollableMain.style.overflow = "hidden";
    return () => {
      scrollableMain.style.overflow = prev;
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    const el = sheetRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      const current = phaseRef.current;
      if (current === "exiting" || current === "closed") return;
      const scrolledToTop =
        !scrollRef.current || scrollRef.current.scrollTop <= 0;
      if (!scrolledToTop) return;
      touchStartY.current = e.touches[0].clientY;
      dragYRef.current = 0;
      setDragY(0);
      isDragging.current = true;
      setPhase("dragging");
      hapticsRef.current.light();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current) return;
      const delta = e.touches[0].clientY - touchStartY.current;
      if (delta <= 0) {
        dragYRef.current = 0;
        setDragY(0);
        return;
      }
      e.preventDefault();
      dragYRef.current = delta;
      setDragY(delta);
    };

    const onTouchEnd = () => {
      if (!isDragging.current) return;
      isDragging.current = false;

      if (dragYRef.current > DISMISS_THRESHOLD) {
        hapticsRef.current.medium();
        setPhase("exiting");
        onCloseRef.current();
      } else {
        setPhase("settling");
        dragYRef.current = 0;
        setDragY(0);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [isVisible]);

  if (phase === "closed") return null;

  const getSheetStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      maxHeight: "92vh",
      touchAction: "pan-y",
    };

    switch (phase) {
      case "dragging":
        return {
          ...base,
          transform: `translateY(${dragY}px)`,
          transition: "none",
        };
      case "exiting":
        return {
          ...base,
          transform: "translateY(100%)",
          transition: `transform ${EXIT_DURATION}ms ease-in`,
        };
      case "settling":
        return {
          ...base,
          transform: "translateY(0)",
          transition: `transform ${SETTLE_DURATION}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        };
      default:
        return base;
    }
  };

  const getBackdropStyle = (): React.CSSProperties => {
    switch (phase) {
      case "dragging":
        return {
          opacity: Math.max(0, 1 - dragY / (DISMISS_THRESHOLD * 3)),
          transition: "none",
        };
      case "exiting":
        return { opacity: 0, transition: `opacity ${EXIT_DURATION}ms ease-in` };
      case "settling":
        return {
          opacity: 1,
          transition: `opacity ${SETTLE_DURATION}ms ease-out`,
        };
      default:
        return { opacity: 1 };
    }
  };

  const backdropAnimClass = phase === "entering" ? "animate-backdrop-in" : "";

  const sheetAnimClass = phase === "entering" ? "animate-sheet-in" : "";

  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className={`absolute inset-0 bg-black/60 dark:bg-black/80 ${backdropAnimClass}`}
        style={getBackdropStyle()}
      />
      <div
        ref={sheetRef}
        className={`absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-800 rounded-t-2xl flex flex-col ${sheetAnimClass}`}
        style={getSheetStyle()}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={() => {
          if (phase === "entering") setPhase("open");
        }}
      >
        <div className="flex flex-col items-center pt-3 pb-2 px-4 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600 mb-3" />
          {title && (
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {title}
            </h2>
          )}
        </div>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
