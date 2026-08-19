import type { ActualTheme } from "./themeContextDef";

/**
 * The colour the app paints behind everything, per theme. Kept in sync with the
 * `bg-amber-50 dark:bg-gray-900` on the Layout root: the browser paints the
 * status bar and overscroll areas from these, so a mismatch shows as a stripe
 * of the wrong colour above the app.
 */
export const THEME_COLORS: Record<ActualTheme, string> = {
  light: "#fffbeb",
  dark: "#111827",
};

/**
 * Points the `theme-color` meta tag at the current theme's background so the
 * system UI around the app (Android status bar, iOS status bar tint) matches.
 */
export const applyThemeColor = (actualTheme: ActualTheme): void => {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]'
  );

  if (meta) {
    meta.content = THEME_COLORS[actualTheme];
  }
};
