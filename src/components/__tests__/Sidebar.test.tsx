import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthContextValue } from "@/context/authContextDef";
import Sidebar from "../Sidebar";

const mockAuthValue: AuthContextValue = {
  status: "authenticated",
  user: {
    id: 1,
    username: "testadmin",
    userType: "local",
    permissions: 2,
    theme: "system",
    thumb: null,
    hasPlexToken: false,
  },
  login: vi.fn(),
  plexLogin: vi.fn(),
  plexSetup: vi.fn(),
  linkPlex: vi.fn(),
  logout: vi.fn(),
  setup: vi.fn(),
  updatePreferences: vi.fn(),
  refreshUser: vi.fn(),
};

const renderSidebar = (path = "/") => {
  return render(
    <AuthContext.Provider value={mockAuthValue}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar />
      </MemoryRouter>
    </AuthContext.Provider>
  );
};

describe("Sidebar", () => {
  it("renders the logo and app name only in the desktop sidebar", () => {
    const { container } = renderSidebar();
    expect(screen.getAllByText("Tunearr")).toHaveLength(1);
    expect(container.querySelector("header")).toBeNull();
  });

  it("renders shared navigation links for both mobile and desktop", () => {
    renderSidebar();
    expect(screen.getAllByRole("link", { name: /Discover/ })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Search/ })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Library/ })).toHaveLength(2);
  });

  it("shows username in desktop sidebar account link", () => {
    renderSidebar();
    expect(screen.getByText("testadmin")).toBeInTheDocument();
  });

  it("shows Account label in mobile nav", () => {
    renderSidebar();
    expect(screen.getByText("Account")).toBeInTheDocument();
  });

  it("renders account link to settings in both mobile and desktop", () => {
    renderSidebar();
    const accountLinks = screen.getAllByRole("link", {
      name: /testadmin|Account/,
    });
    expect(accountLinks).toHaveLength(2);
    accountLinks.forEach((link) => {
      expect(link).toHaveAttribute("href", "/settings");
    });
  });

  it("highlights Discover link on home page in both mobile and desktop", () => {
    renderSidebar("/");
    const discoverLinks = screen.getAllByRole("link", { name: /Discover/ });
    expect(discoverLinks).toHaveLength(2);
    expect(discoverLinks[0]).toHaveClass("bg-amber-300");
    expect(discoverLinks[1]).toHaveClass("text-black");
  });

  it("highlights Search link on search page", () => {
    renderSidebar("/search");
    const searchLinks = screen.getAllByRole("link", { name: /Search/ });
    expect(searchLinks).toHaveLength(2);
    expect(searchLinks[0]).toHaveClass("bg-amber-300");
    expect(searchLinks[1]).toHaveClass("text-black");
  });

  it("highlights Library link on library page", () => {
    renderSidebar("/library/wanted");
    const libraryLinks = screen.getAllByRole("link", { name: /Library/ });
    expect(libraryLinks).toHaveLength(2);
    expect(libraryLinks[0]).toHaveClass("bg-amber-300");
    expect(libraryLinks[1]).toHaveClass("text-black");
  });

  it("highlights account link on settings page", () => {
    renderSidebar("/settings");
    const desktopAccountLink = screen.getByRole("link", { name: /testadmin/ });
    expect(desktopAccountLink).toHaveClass("bg-amber-300");
    const mobileAccountLink = screen.getByRole("link", { name: /Account/ });
    expect(mobileAccountLink).toHaveClass("text-black");
  });

  it("applies hover styles to non-active links", () => {
    renderSidebar("/");
    const searchLinks = screen.getAllByRole("link", { name: /Search/ });
    expect(searchLinks[0]).toHaveClass("hover:bg-amber-50");
    expect(searchLinks[0]).not.toHaveClass("bg-amber-300");
  });

  it("dispatches search:reset and prevents navigation when clicking Search while on /search", () => {
    const handler = vi.fn();
    window.addEventListener("search:reset", handler);
    try {
      renderSidebar("/search");
      const searchLinks = screen.getAllByRole("link", { name: /Search/ });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      const wasDefaultPrevented = !searchLinks[0].dispatchEvent(event);
      expect(wasDefaultPrevented).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("search:reset", handler);
    }
  });

  it("does not dispatch search:reset when clicking Search from another page", () => {
    const handler = vi.fn();
    window.addEventListener("search:reset", handler);
    try {
      renderSidebar("/");
      const searchLinks = screen.getAllByRole("link", { name: /Search/ });
      fireEvent.click(searchLinks[0]);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("search:reset", handler);
    }
  });

  it("pins the desktop sidebar while the document scrolls", () => {
    const { container } = renderSidebar();
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("sticky");
    expect(aside?.className).toContain("top-0");
    expect(aside?.className).toContain("h-screen");
  });

  it("keeps the mobile nav clear of the device safe area", () => {
    const { container } = renderSidebar();
    const mobileNav = container.querySelector("nav.md\\:hidden");
    expect(mobileNav?.className).toContain(
      "pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    );
  });
});
