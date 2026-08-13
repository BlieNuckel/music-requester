import useHaptics from "../../hooks/useHaptics";

const chipBase =
  "px-2.5 py-1 text-sm font-medium rounded-lg border-2 border-black transition-all whitespace-nowrap";
const chipActive = "bg-amber-400 text-black shadow-cartoon-sm";
const chipInactive =
  "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 shadow-cartoon-sm hover:bg-gray-50 dark:hover:bg-gray-700";

export function SelectableChip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const haptics = useHaptics();

  return (
    <button
      type="button"
      onClick={() => {
        haptics.light();
        onToggle();
      }}
      className={`${chipBase} ${selected ? chipActive : chipInactive}`}
    >
      {label}
    </button>
  );
}

export function RemovableChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  const haptics = useHaptics();

  return (
    <button
      type="button"
      onClick={() => {
        haptics.light();
        onRemove();
      }}
      className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-400 text-black border-2 border-black shadow-cartoon-sm transition-all active:shadow-cartoon-pressed"
    >
      {label}
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
      </svg>
    </button>
  );
}
