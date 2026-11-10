import { useCallback, useEffect, useState } from "react";
import type { ClassroomWindow } from "../../shared/classroom";
import "./tutor-theme.scss";

export type TutorTheme = "light" | "dark";
const KEY = "tars-theme";
function readTheme(view: ClassroomWindow): TutorTheme {
  try {
    const saved = view.localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    /* The theme remains usable without browser storage. */
  }
  const current = view.document.documentElement.dataset.tarsTheme;
  if (current === "light" || current === "dark") {
    return current;
  }
  return view.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    ? "dark"
    : "light";
}

export function useTutorTheme(view: ClassroomWindow) {
  const [theme, update] = useState<TutorTheme>(() => readTheme(view));
  useEffect(() => {
    view.document.documentElement.dataset.tarsTheme = theme;
  }, [theme, view]);
  useEffect(() => {
    const sync = () => update(readTheme(view));
    view.addEventListener("tars-theme-change", sync);
    const stored = (event: StorageEvent) => {
      if (event.key === KEY || event.key === null) {
        sync();
      }
    };
    view.addEventListener("storage", stored);
    return () => {
      view.removeEventListener("tars-theme-change", sync);
      view.removeEventListener("storage", stored);
    };
  }, [view]);
  const setTheme = useCallback(
    (next: TutorTheme) => {
      try {
        view.localStorage.setItem(KEY, next);
      } catch {
        /* Session-only fallback. */
      }
      view.document.documentElement.dataset.tarsTheme = next;
      update(next);
      view.dispatchEvent(new view.Event("tars-theme-change"));
    },
    [view],
  );
  return { theme, setTheme };
}

export function ThemeToggle({
  view,
  compact = false,
}: {
  view: ClassroomWindow;
  compact?: boolean;
}) {
  const { theme, setTheme } = useTutorTheme(view);
  return (
    <button
      type="button"
      className={`tt-theme-toggle${compact ? " tt-theme-toggle--compact" : ""}`}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
          </>
        ) : (
          <path d="M20.5 13.3A8.6 8.6 0 0 1 10.7 3.5a8.6 8.6 0 1 0 9.8 9.8Z" />
        )}
      </svg>
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
