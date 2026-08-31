const KEY = 'laprinto-crm-theme'

export function getStoredTheme() {
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme) } catch { /* private mode etc — theme just won't persist */ }
  applyTheme(theme)
}

// קוראים לזה פעם אחת לפני ה-render הראשון כדי למנוע הבזק של הצבע הלא נכון
export function initTheme() {
  const stored = getStoredTheme()
  const theme = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  applyTheme(theme)
  return theme
}
