import { createTheme, type MantineThemeOverride, type CSSVariablesResolver } from '@mantine/core'

const STORAGE_KEY = 'ga_theme'

// Each theme varies accent color, corner radius, font family, heading style and
// component defaults so they look genuinely distinct (not just a different hue).
export const themes: Record<string, MantineThemeOverride> = {
  Default: createTheme({
    primaryColor: 'blue',
    defaultRadius: 'md',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  }),
  Ocean: createTheme({
    primaryColor: 'cyan',
    primaryShade: { light: 7, dark: 5 },
    defaultRadius: 'lg',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    headings: { fontWeight: '700' },
    components: {
      Card: { defaultProps: { radius: 'lg', shadow: 'sm' } },
      Button: { defaultProps: { radius: 'xl' } },
    },
  }),
  Forest: createTheme({
    primaryColor: 'teal',
    primaryShade: { light: 8, dark: 5 },
    defaultRadius: 'md',
    fontFamily: 'Georgia, "Times New Roman", serif',
    headings: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: '700' },
  }),
  Sunset: createTheme({
    primaryColor: 'orange',
    primaryShade: { light: 6, dark: 5 },
    defaultRadius: 'xl',
    fontFamily: '"Trebuchet MS", Verdana, Geneva, sans-serif',
    headings: { fontWeight: '800' },
    components: {
      Button: { defaultProps: { radius: 'xl' } },
      Card: { defaultProps: { radius: 'lg', shadow: 'md' } },
      Badge: { defaultProps: { radius: 'sm' } },
    },
  }),
  Mono: createTheme({
    primaryColor: 'dark',
    primaryShade: { light: 9, dark: 4 },
    defaultRadius: 0,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    headings: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontWeight: '600' },
    components: {
      Card: { defaultProps: { radius: 0, shadow: undefined, withBorder: true } },
      Paper: { defaultProps: { radius: 0 } },
      Button: { defaultProps: { radius: 0 } },
      Badge: { defaultProps: { radius: 0 } },
      TextInput: { defaultProps: { radius: 0 } },
      PasswordInput: { defaultProps: { radius: 0 } },
      Select: { defaultProps: { radius: 0 } },
    },
  }),
}

// Per-theme page background tint (body), for light and dark color schemes.
const bodyBg: Record<string, { light: string; dark: string }> = {
  Default: { light: '#ffffff', dark: '#1a1b1e' },
  Ocean: { light: '#eef6fb', dark: '#0b1f2a' },
  Forest: { light: '#f1f8f3', dark: '#0e1f16' },
  Sunset: { light: '#fff6ef', dark: '#241712' },
  Mono: { light: '#f4f4f5', dark: '#161616' },
}

// resolverFor returns a CSS-variables resolver that tints the page background
// for the given theme (applied via MantineProvider's cssVariablesResolver).
export function resolverFor(name: string): CSSVariablesResolver {
  const c = bodyBg[name] ?? bodyBg.Default
  return () => ({
    variables: {},
    light: { '--mantine-color-body': c.light },
    dark: { '--mantine-color-body': c.dark },
  })
}

export const themeNames = Object.keys(themes)

export function loadThemeName(): string {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved && themes[saved] ? saved : 'Default'
}

export function saveThemeName(name: string) {
  localStorage.setItem(STORAGE_KEY, name)
}
