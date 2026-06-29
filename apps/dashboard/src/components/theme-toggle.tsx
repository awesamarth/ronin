"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { setTheme } = useTheme();

  function toggleTheme() {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <button
      aria-label="Toggle theme"
      className="theme-toggle inline-flex h-10 w-10 items-center justify-center border border-ronin-border bg-ronin-panel text-ronin-muted transition hover:border-ronin-strong-border hover:text-ronin-foreground"
      onClick={toggleTheme}
      type="button"
    >
      <Sun className="theme-toggle-sun h-4 w-4" />
      <Moon className="theme-toggle-moon h-4 w-4" />
    </button>
  );
}
