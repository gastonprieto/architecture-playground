import { create } from 'zustand'

export type Theme = 'dark' | 'light'
export const THEME_STORAGE_KEY = 'nodarium:theme'

const isTheme = (v: unknown): v is Theme => v === 'dark' || v === 'light'

/** The saved choice, else the system's preference (dark when there is none). */
function initialTheme(): Theme {
  try {
    const saved = globalThis.localStorage?.getItem(THEME_STORAGE_KEY)
    if (isTheme(saved)) return saved
  } catch {
    /* storage blocked */
  }
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** theme.css themes the playground through `<html data-theme>`. */
function apply(theme: Theme) {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
}

type ThemeState = { theme: Theme; toggle: () => void }

export const useTheme = create<ThemeState>((set, get) => {
  const theme = initialTheme()
  apply(theme)
  return {
    theme,
    toggle: () => {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
      apply(next)
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next)
      } catch {
        /* storage blocked */
      }
      set({ theme: next })
    },
  }
})
