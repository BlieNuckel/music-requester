import { useState, useRef, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
} from "@floating-ui/react-dom";
import useHaptics from "../hooks/useHaptics";
import LogoLockup from "./LogoLockup";

const links = [
  { to: "/", label: "Discover" },
  { to: "/search", label: "Search" },
  { to: "/status", label: "Status" },
  { to: "/settings", label: "Settings" },
];

export default function Navbar() {
  const haptics = useHaptics();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const [referenceEl, setReferenceEl] = useState<HTMLElement | null>(null);
  const [floatingEl, setFloatingEl] = useState<HTMLElement | null>(null);

  const { floatingStyles, placement } = useFloating({
    elements: { reference: referenceEl, floating: floatingEl },
    placement: "bottom-end",
    transform: false,
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const currentLabel =
    links.find(
      (l) =>
        l.to === location.pathname ||
        (l.to !== "/" && location.pathname.startsWith(l.to))
    )?.label ?? "Menu";

  const originClass = placement.startsWith("top")
    ? "origin-bottom-right"
    : "origin-top-right";

  return (
    <nav className="bg-white border-b-4 border-black">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
        <NavLink to="/" className="flex items-center gap-2 group">
          <LogoLockup size="sm" wordmarkClassName="hidden sm:inline-block" />
        </NavLink>

        <div ref={menuRef}>
          <button
            ref={setReferenceEl}
            onClick={() => {
              haptics.light();
              setOpen((v) => !v);
            }}
            className="flex items-center gap-1.5 text-sm font-bold text-gray-900 hover:text-amber-500 transition-colors px-3 py-1.5 rounded-lg border-2 border-black"
          >
            {currentLabel}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {open && (
            <div
              ref={setFloatingEl}
              style={floatingStyles}
              className={`w-40 bg-white border-2 border-black rounded-lg shadow-lg overflow-hidden z-50 animate-dropdown-in ${originClass}`}
            >
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === "/"}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `block px-4 py-2.5 text-sm font-bold transition-colors ${
                      isActive
                        ? "text-amber-500 bg-amber-50"
                        : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
