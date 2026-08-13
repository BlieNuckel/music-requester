import { useState, useRef, useEffect, useCallback } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
} from "@floating-ui/react-dom";
import { CheckIcon, ChevronDown } from "./icons";
import { toggleValue } from "./helpers";
import type { FilterGroup } from "./types";

const pillActiveClass = "bg-amber-400 text-black";
const pillInactiveClass =
  "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700";

function handleClickOutside(
  e: MouseEvent,
  containerRef: React.RefObject<HTMLDivElement | null>,
  close: () => void
) {
  if (
    containerRef.current &&
    !containerRef.current.contains(e.target as Node)
  ) {
    close();
  }
}

function DropdownOption({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onToggle}
      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
    >
      <span
        className={`flex items-center justify-center w-4.5 h-4.5 rounded border-2 flex-shrink-0 transition-colors ${
          selected
            ? "bg-gray-900 dark:bg-gray-100 border-gray-900 dark:border-gray-100 text-white dark:text-gray-900"
            : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
        }`}
      >
        {selected && <CheckIcon className="w-3.5 h-3.5" />}
      </span>
      <span className="text-gray-900 dark:text-gray-100">{label}</span>
    </button>
  );
}

export default function FilterDropdown({
  group,
  selected,
  isOpen,
  onToggleOpen,
  onChange,
}: {
  group: FilterGroup;
  selected: string[];
  isOpen: boolean;
  onToggleOpen: () => void;
  onChange: (values: string[]) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [referenceEl, setReferenceEl] = useState<HTMLElement | null>(null);
  const [floatingEl, setFloatingEl] = useState<HTMLElement | null>(null);

  const setReference = useCallback((node: HTMLButtonElement | null) => {
    setReferenceEl(node);
  }, []);

  const { floatingStyles, placement } = useFloating({
    elements: { reference: referenceEl, floating: floatingEl },
    placement: "bottom-start",
    transform: false,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (!isOpen) return;

    const listener = (e: MouseEvent) =>
      handleClickOutside(e, wrapperRef, onToggleOpen);

    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [isOpen, onToggleOpen]);

  const selectedLabels = group.options
    .filter((o) => selected.includes(o.value))
    .map((o) => o.label);

  const pillText =
    selectedLabels.length === 0
      ? group.label
      : `${group.label}: ${selectedLabels.join(", ")}`;

  const originClass = placement.startsWith("top")
    ? "origin-bottom"
    : "origin-top";

  return (
    <div ref={wrapperRef}>
      <button
        ref={setReference}
        type="button"
        onClick={onToggleOpen}
        className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border-2 border-black shadow-cartoon-sm hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all whitespace-nowrap ${
          selected.length > 0 ? pillActiveClass : pillInactiveClass
        }`}
      >
        {pillText}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          ref={setFloatingEl}
          style={floatingStyles}
          role="listbox"
          className={`min-w-48 bg-white dark:bg-gray-800 border-2 border-black rounded-xl shadow-cartoon-lg py-1 z-50 animate-dropdown-in ${originClass}`}
        >
          {group.options.map((option) => (
            <DropdownOption
              key={option.value}
              label={option.label}
              selected={selected.includes(option.value)}
              onToggle={() => onChange(toggleValue(selected, option.value))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
