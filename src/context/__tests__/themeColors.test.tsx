import { render, screen, act } from "@testing-library/react";
import { THEME_COLORS, applyThemeColor } from "../themeColors";
import { ThemeProvider } from "../ThemeContext";
import { useTheme } from "../useTheme";
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
} from "../authContextDef";
import type { Theme } from "../themeContextDef";

function makeAuthValue(theme: Theme = "system"): AuthContextValue {
  return {
    status: "authenticated" as AuthStatus,
    user: {
      id: 1,
      username: "admin",
      userType: "local",
      permissions: 1,
      theme,
      thumb: null,
      hasPlexToken: false,
    },
    login: vi.fn(),
    plexLogin: vi.fn(),
    plexSetup: vi.fn(),
    linkPlex: vi.fn(),
    logout: vi.fn(),
    setup: vi.fn(),
    updatePreferences: vi.fn().mockResolvedValue(undefined),
    refreshUser: vi.fn(),
  };
}

function ThemeSwitcher() {
  const { setTheme } = useTheme();
  return (
    <button onClick={() => void setTheme("dark")} data-testid="go-dark">
      dark
    </button>
  );
}

function metaContent() {
  return document
    .querySelector('meta[name="theme-color"]')
    ?.getAttribute("content");
}

beforeEach(() => {
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = THEME_COLORS.light;
  document.head.appendChild(meta);
});

afterEach(() => {
  document.querySelector('meta[name="theme-color"]')?.remove();
  document.documentElement.classList.remove("dark");
});

describe("applyThemeColor", () => {
  it("writes the theme's background into the meta tag", () => {
    applyThemeColor("dark");
    expect(metaContent()).toBe(THEME_COLORS.dark);

    applyThemeColor("light");
    expect(metaContent()).toBe(THEME_COLORS.light);
  });

  it("does nothing when the page has no theme-color meta", () => {
    document.querySelector('meta[name="theme-color"]')?.remove();

    expect(() => applyThemeColor("dark")).not.toThrow();
  });
});

describe("ThemeProvider", () => {
  it("syncs the meta tag with the user's stored theme", () => {
    render(
      <AuthContext.Provider value={makeAuthValue("dark")}>
        <ThemeProvider>
          <ThemeSwitcher />
        </ThemeProvider>
      </AuthContext.Provider>
    );

    expect(metaContent()).toBe(THEME_COLORS.dark);
  });

  it("updates the meta tag when the theme changes", async () => {
    render(
      <AuthContext.Provider value={makeAuthValue("light")}>
        <ThemeProvider>
          <ThemeSwitcher />
        </ThemeProvider>
      </AuthContext.Provider>
    );

    expect(metaContent()).toBe(THEME_COLORS.light);

    await act(async () => {
      screen.getByTestId("go-dark").click();
    });

    expect(metaContent()).toBe(THEME_COLORS.dark);
  });
});
