import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthContext, type AuthContextValue } from "@/context/authContextDef";
import Layout from "../Layout";

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

function renderLayout(path = "/") {
  return render(
    <AuthContext.Provider value={mockAuthValue}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Home Content</div>} />
            <Route path="/other" element={<div>Other Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe("Layout", () => {
  it("renders the logo only in the desktop sidebar", () => {
    renderLayout();
    expect(screen.getAllByText("Tunearr")).toHaveLength(1);
  });

  it("renders child route content via Outlet", () => {
    renderLayout("/");
    expect(screen.getByText("Home Content")).toBeInTheDocument();
  });

  it("renders different child route content", () => {
    renderLayout("/other");
    expect(screen.getByText("Other Content")).toBeInTheDocument();
  });

  it("sizes the shell to the dynamic viewport so the mobile nav is not pushed off-screen", () => {
    const { container } = renderLayout();
    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toContain("h-[100dvh]");
    expect(shell.className).not.toContain("h-screen");
  });

  it("pads the scroll area past the mobile nav and the safe area", () => {
    renderLayout();
    const main = screen.getByRole("main");
    expect(main.className).toContain(
      "pb-[calc(7rem+env(safe-area-inset-bottom))]"
    );
    expect(main.className).toContain("md:pb-6");
  });

  it("does not reserve room for a mobile header", () => {
    renderLayout();
    const main = screen.getByRole("main");
    expect(main.className).not.toContain("pt-20");
    expect(main.className).toContain(
      "pt-[calc(1.5rem+env(safe-area-inset-top))]"
    );
  });
});
