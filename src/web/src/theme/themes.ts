import { createTheme, type MantineThemeOverride } from '@mantine/core'

export const themes: Record<string, MantineThemeOverride> = {
  Default: createTheme({ primaryColor: 'blue', defaultRadius: 'md' }),
  Ocean: createTheme({ primaryColor: 'cyan', defaultRadius: 'lg' }),
  Forest: createTheme({ primaryColor: 'teal', defaultRadius: 'md' }),
  Sunset: createTheme({ primaryColor: 'orange', defaultRadius: 'xl' }),
  Mono: createTheme({ primaryColor: 'gray', defaultRadius: 'xs' }),
}

export const themeNames = Object.keys(themes)
const STORAGE_KEY = 'ga_theme'

export function loadThemeName(): string {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved && themes[saved] ? saved : 'Default'
}

export function saveThemeName(name: string) {
  localStorage.setItem(STORAGE_KEY, name)
}
