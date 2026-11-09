"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark" | "system";
const STORAGE_KEY = "fsb.theme.mode";
const labels: Record<ThemeMode, string> = { light: "روشن", dark: "تیره", system: "سیستم" };
const icons: Record<ThemeMode, string> = { light: "☀", dark: "☾", system: "◐" };

function applyTheme(mode: ThemeMode) {
  const resolved = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = resolved;
}

export default function ThemeControl() {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const initial: ThemeMode = saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
    setMode(initial);
    applyTheme(initial);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => { if (initial === "system") applyTheme("system"); };
    media.addEventListener?.("change", onSystemChange);
    return () => media.removeEventListener?.("change", onSystemChange);
  }, []);

  function choose(next: ThemeMode) {
    setMode(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    setOpen(false);
  }

  return (
    <div className="fsb-theme-control" dir="rtl">
      <button
        type="button"
        className="fsb-theme-trigger"
        aria-label={`پوسته فعلی: ${labels[mode]}؛ تغییر پوسته`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(value => !value)}
      >
        <span aria-hidden="true">{icons[mode]}</span>
        <span>{labels[mode]}</span>
        <span className="fsb-theme-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <>
          <button className="fsb-theme-dismiss" aria-label="بستن انتخاب پوسته" onClick={() => setOpen(false)} />
          <div className="fsb-theme-menu" role="menu" aria-label="انتخاب پوسته">
            {(["light", "dark", "system"] as ThemeMode[]).map(option => (
              <button key={option} type="button" role="menuitemradio" aria-checked={mode === option} className={mode === option ? "selected" : ""} onClick={() => choose(option)}>
                <span aria-hidden="true">{icons[option]}</span>
                <span>{labels[option]}</span>
                {mode === option && <span className="fsb-theme-check" aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
