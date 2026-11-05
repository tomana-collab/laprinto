import { useState } from 'react'
import { useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Settings from './pages/Settings'
import Dashboard from './pages/Dashboard'
import Bundles from './pages/Bundles'
import Receipts from './pages/Receipts'
import Inventory from './pages/Inventory'
import Sidebar from './components/Sidebar'
import GenericModule from './modules/GenericModule'
import { MODULES } from './modules/moduleConfigs'
import { NavProvider } from './contexts/NavContext'

export default function App() {
  const { loading, user } = useAuth()
  const [active, setActive] = useState('tasks')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [focus, setFocus] = useState(null) // { module, id } — רשומה לפתוח לעריכה אחרי מעבר מודול

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
          : <GenericModule key={active} config={MODULES[active]} focusId={focus?.module === active ? focus.id : null} />}
      </main>
    </div>
    </NavProvider>
  )
}
