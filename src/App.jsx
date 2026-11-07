import { useEffect, useState } from 'react'
import { useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Settings from './pages/Settings'
import Dashboard from './pages/Dashboard'
import Bundles from './pages/Bundles'
import Receipts from './pages/Receipts'
import Inventory from './pages/Inventory'
import Competitors from './pages/Competitors'
import Sidebar from './components/Sidebar'
import GenericModule from './modules/GenericModule'
import { MODULES } from './modules/moduleConfigs'
import { NavProvider } from './contexts/NavContext'

const PAGES = ['dashboard', 'settings', 'bundles', 'receipts', 'inventory', 'competitors']
const isPage = k => PAGES.includes(k) || !!MODULES[k]

// הדף הפעיל נשמר ב-hash של ה-URL, כך שרענון (או חזרה אחורה) נשארים על אותו דף
function pageFromHash() {
  // כתובת ישירה כמו /competitors → מתורגמת ל-hash (ה-CRM עובד בניווט לפי hash)
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '')
  if (path && isPage(path)) { window.history.replaceState(null, '', '/#/' + path); return path }
  const k = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''))
  return isPage(k) ? k : 'tasks'
}

export default function App() {
  const { loading, user } = useAuth()
  const [active, setActive] = useState(pageFromHash)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [focus, setFocus] = useState(null) // { module, id } — רשומה לפתוח לעריכה אחרי מעבר מודול

  useEffect(() => {
    const want = '#/' + active
    const h = window.location.hash
    // לא דורסים hash של Supabase Auth (קישור איפוס סיסמה / אימות), רק hash ריק או שלנו
    if (h !== want && (h === '' || h.startsWith('#/'))) window.history.pushState(null, '', want)
  }, [active])

  useEffect(() => {
    const onPop = () => { setFocus(null); setActive(pageFromHash()) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (loading) return <div className="loading">טוען...</div>
  if (!user) return <Login />

  const openRecord = (module, id) => { if (!module || !id) return; setFocus({ module, id }); setActive(module) }
  const select = key => { setFocus(null); setActive(key) }

  return (
    <NavProvider value={{ openRecord }}>
    <div className="layout">
      <Sidebar
        active={active}
        onSelect={select}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      <main>
        <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)}>☰ תפריט</button>
        {active === 'settings' ? <Settings />
          : active === 'dashboard' ? <Dashboard />
          : active === 'bundles' ? <Bundles />
          : active === 'receipts' ? <Receipts />
          : active === 'inventory' ? <Inventory />
          : active === 'competitors' ? <Competitors />
          : <GenericModule key={active} config={MODULES[active]} focusId={focus?.module === active ? focus.id : null} />}
      </main>
    </div>
    </NavProvider>
  )
}
