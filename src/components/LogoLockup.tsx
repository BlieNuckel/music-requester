import LogoMark from "./LogoMark";

export type LogoLockupSize = "sm" | "md" | "lg";

type LogoLockupProps = {
  size?: LogoLockupSize;
  /** Hides the wordmark below a breakpoint, e.g. "hidden sm:inline-block". */
  wordmarkClassName?: string;
};

type SizeSpec = {
  gap: string;
  mark: string;
  text: string;
  underline: string;
};

const SIZES: Record<LogoLockupSize, SizeSpec> = {
  sm: { gap: "gap-2", mark: "w-7 h-7", text: "text-lg", underline: "h-[4px]" },
  md: { gap: "gap-2", mark: "w-8 h-8", text: "text-xl", underline: "h-[5px]" },
  lg: {
    gap: "gap-3",
    mark: "w-10 h-10",
    text: "text-2xl",
    underline: "h-[6px]",
  },
};

/**
 * The horizontal lockup: mark plus wordmark, with a hand-drawn underline that
 * stretches to whatever width the text happens to be. The underline is absolute
 * so it never affects layout height, and `vector-effect` keeps its weight even
 * though the viewBox is stretched.
 */
export default function LogoLockup({
  size = "md",
  wordmarkClassName = "",
}: LogoLockupProps) {
  const spec = SIZES[size];

  return (
    <span className={`flex items-center ${spec.gap}`}>
      <LogoMark className={`${spec.mark} flex-shrink-0`} />
      <span className={`relative inline-block ${wordmarkClassName}`}>
        <span
          className={`${spec.text} font-extrabold tracking-tight text-gray-900 dark:text-gray-100 group-hover:text-amber-500 transition-colors`}
        >
          Tunearr
        </span>
        <svg
          viewBox="0 0 100 8"
          preserveAspectRatio="none"
          aria-hidden="true"
          className={`absolute left-0 -bottom-0.5 w-full ${spec.underline}`}
        >
          <path
            d="M 2 5.5 Q 38 8.5 98 3"
            fill="none"
            stroke="#F472B6"
            strokeWidth="3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </span>
    </span>
  );
}
