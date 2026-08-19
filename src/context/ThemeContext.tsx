import { useEffect, useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import {
  ThemeContext,
  type Theme,
  type ActualTheme,
  type ThemeContextValue,
} from "./themeContextDef";
import { applyThemeColor } from "./themeColors";
import { useAuth } from "./useAuth";

const getSystemTheme = (): ActualTheme => {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const { user, status, updatePreferences } = useAuth();

  const userTheme: Theme = user?.theme ?? "system";

  const [theme, setThemeState] = useState<Theme>(userTheme);
  const [systemTheme, setSystemTheme] = useState<ActualTheme>(getSystemTheme);
  const [prevUserTheme, setPrevUserTheme] = useState<Theme>(userTheme);

  if (prevUserTheme !== userTheme) {
    setPrevUserTheme(userTheme);
    setThemeState(userTheme);
  }

  const actualTheme: ActualTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", actualTheme === "dark");
    applyThemeColor(actualTheme);
  }, [actualTheme]);

  const setTheme = useCallback(
    async (newTheme: Theme) => {
      setThemeState(newTheme);

      if (status === "authenticated") {
        try {
          await updatePreferences({ theme: newTheme });
        } catch (error) {
          console.error("Failed to save theme:", error);
        }
      }
    },
    [status, updatePreferences]
  );

  const value: ThemeContextValue = useMemo(
    () => ({
      theme,
      actualTheme,
      setTheme,
      isLoading: false,
    }),
    [theme, actualTheme, setTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};
