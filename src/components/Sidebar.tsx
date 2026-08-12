import { useRef, useLayoutEffect, useState, useCallback } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  DiscoverIcon,
  SearchIcon,
  LibraryIcon,
  UserCircleIcon,
} from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import NotificationBadge from "@/components/NotificationBadge";
import useUnseenReleaseCount from "@/hooks/useUnseenReleaseCount";
import { useAuth } from "@/context/useAuth";
import LogoLockup from "./LogoLockup";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const links: NavItem[] = [
  { to: "/", label: "Discover", icon: DiscoverIcon },
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/library", label: "Library", icon: LibraryIcon },
];

const mobileLinks: NavItem[] = [
  ...links,
  { to: "/settings", label: "Account", icon: UserCircleIcon },
];

function isOnSearchPath(pathname: string): boolean {
  return pathname === "/search" || pathname.startsWith("/search/");
}

function makeSearchClickHandler(
  to: string,
  pathname: string
): ((e: React.MouseEvent<HTMLAnchorElement>) => void) | undefined {
  if (to !== "/search") return undefined;
  return (e) => {
    if (isOnSearchPath(pathname)) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("search:reset"));
    }
  };
}

function MobileNav() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { count: unseenCount } = useUnseenReleaseCount();
  const navRef = useRef<HTMLUListElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const hasMounted = useRef(false);
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });
  const activeIndex = mobileLinks.findIndex((link) => {
    if (link.to === "/") return pathname === "/";
    const base = link.to.split("/").slice(0, 2).join("/");
    return pathname.startsWith(base);
  });

  const measure = useCallback(() => {
    const nav = navRef.current;
    const item = itemRefs.current[activeIndex];
    if (!nav || !item || activeIndex === -1) return;

    const navRect = nav.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const iconCenter = itemRect.left - navRect.left + itemRect.width / 2;
    const pillWidth = 44;
    setPillStyle({ left: iconCenter - pillWidth / 2, width: pillWidth });
  }, [activeIndex]);

  useLayoutEffect(() => {
    measure();

    const pill = pillRef.current;
    if (!pill || !hasMounted.current) {
      hasMounted.current = true;
      return;
    }

    pill.style.animation = "none";
    void pill.offsetHeight;
    pill.style.animation = "";
  }, [measure]);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 px-3 pb-3">
      <div className="relative bg-white dark:bg-gray-800 border-3 border-black rounded-full px-4">
        <ul ref={navRef} className="relative flex items-center justify-around">
          {activeIndex !== -1 && (
            <div
              ref={pillRef}
              className="nav-pill-squish absolute top-2 h-8 bg-amber-300 rounded-full border-2 border-black pointer-events-none transition-[left] duration-300 ease-out"
              style={{ left: pillStyle.left, width: pillStyle.width }}
            />
          )}
          {mobileLinks.map((link, i) => (
            <li
              key={link.to}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              className="flex-1"
            >
              <NavLink
                to={link.to}
                end={link.to === "/"}
                onClick={makeSearchClickHandler(link.to, pathname)}
                className={({ isActive }) =>
                  `relative flex flex-col items-center justify-center gap-1 py-3 text-xs font-bold transition-colors ${
                    isActive
                      ? "text-black dark:text-gray-100"
                      : "text-gray-500 dark:text-gray-400"
                  }`
                }
              >
                <div className="relative">
                  {link.to === "/settings" && user?.thumb ? (
                    <UserAvatar
                      thumb={user.thumb}
                      username={user.username}
                      className="w-6 h-6"
                    />
                  ) : (
                    <link.icon className="w-6 h-6" />
                  )}
                  {link.to === "/library" && (
                    <NotificationBadge
                      count={unseenCount}
                      className="absolute -top-1.5 -right-2"
                    />
                  )}
                </div>
                <span>{link.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function DesktopNavLink({ link }: { link: NavItem }) {
  const { pathname } = useLocation();
  const { count: unseenCount } = useUnseenReleaseCount();
  const base = link.to.split("/").slice(0, 2).join("/");
  const isActive =
    link.to === "/" ? pathname === "/" : pathname.startsWith(base);

  return (
    <NavLink
      to={link.to}
      onClick={makeSearchClickHandler(link.to, pathname)}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg text-base font-bold transition-all border-2 ${
        isActive
          ? "bg-amber-300 text-black border-black shadow-cartoon-sm dark:text-black"
          : "text-gray-700 dark:text-gray-300 border-transparent hover:bg-amber-50 dark:hover:bg-gray-700 hover:border-black hover:text-gray-900 dark:hover:text-gray-100"
      }`}
    >
      <link.icon className="w-5 h-5" />
      <span className="flex-1">{link.label}</span>
      {link.to === "/library" && <NotificationBadge count={unseenCount} />}
    </NavLink>
  );
}

export default function Sidebar() {
  const { user } = useAuth();

  return (
    <>
      {/* Mobile Header, shown only on mobile */}
      <header className="md:hidden fixed top-0 left-0 right-0 bg-white dark:bg-gray-800 border-b-4 border-black z-40">
        <div className="px-4 py-3 flex items-center justify-between">
          <NavLink to="/" className="flex items-center gap-2 group">
            <LogoLockup size="md" />
          </NavLink>
        </div>
      </header>

      {/* Desktop Sidebar, hidden on mobile */}
      <aside className="hidden md:flex w-64 h-screen overflow-y-auto bg-white dark:bg-gray-800 border-r-4 border-black flex-col shrink-0">
        <div className="p-6 border-b-4 border-black">
          <NavLink to="/" className="flex items-center gap-3 group">
            <LogoLockup size="lg" />
          </NavLink>
        </div>

        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {links.map((link) => (
              <li key={link.to}>
                <DesktopNavLink link={link} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t-4 border-black p-4">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg text-base font-bold transition-all border-2 ${
                isActive
                  ? "bg-amber-300 text-black border-black shadow-cartoon-sm dark:text-black"
                  : "text-gray-700 dark:text-gray-300 border-transparent hover:bg-amber-50 dark:hover:bg-gray-700 hover:border-black hover:text-gray-900 dark:hover:text-gray-100"
              }`
            }
          >
            <UserAvatar
              thumb={user?.thumb ?? null}
              username={user?.username}
              className="w-5 h-5"
            />
            <span>{user?.username}</span>
          </NavLink>
        </div>
      </aside>

      {/* Mobile Bottom Navigation, shown only on mobile */}
      <MobileNav />
    </>
  );
}
