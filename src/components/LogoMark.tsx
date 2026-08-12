type LogoMarkProps = {
  className?: string;
};

/**
 * The Tunearr mark, drawn as the app-icon tile so the header shows exactly what
 * the installed icon looks like. Kept inline rather than as an <img> so it stays
 * crisp at any size and needs no request. Detail is deliberately coarse: this
 * renders at ~28px in the header and ~48px in a notification.
 */
export default function LogoMark({ className = "" }: LogoMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      className={className}
      role="img"
      aria-label="Tunearr"
    >
      <rect width="1024" height="1024" rx="230" fill="#FCD34D" />
      <circle cx="512" cy="512" r="400" fill="#000000" />
      <g fill="none" stroke="#FFFFFF" strokeWidth="52" strokeLinecap="round">
        <path d="M 181.1 453.7 A 336 336 0 0 1 769.4 296.0" />
        <path d="M 737.5 594.1 A 240 240 0 0 1 357.7 695.9" />
      </g>
      <circle cx="512" cy="512" r="54" fill="#FCD34D" />
    </svg>
  );
}
