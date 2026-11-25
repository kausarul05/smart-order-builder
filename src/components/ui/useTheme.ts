import { useCallback, useEffect, useState } from 'react';

/**
 * Light / dark / follow-the-system, remembered per browser.
 *
 * The CSS does the work: `data-theme` on <html> overrides the
 * `prefers-color-scheme` media query. This only writes that attribute, so
 * there is no flash of the wrong palette and nothing re-renders to repaint.
 *
 * localStorage can throw in a private window, so every access is guarded
 * and the hook degrades to "system" rather than breaking the screen.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'sob.theme.v1';

function read(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private mode: fall through to the system default.
  }
  return 'system';
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function useTheme(): {
  readonly choice: ThemeChoice;
  setChoice(next: ThemeChoice): void;
} {
  const [choice, setStored] = useState<ThemeChoice>(read);

  useEffect(() => {
    apply(choice);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice): void => {
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembering it is better than failing the click.
    }
  }, []);

  return { choice, setChoice };
}
