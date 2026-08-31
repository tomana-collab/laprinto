import { useState } from 'react'
import { useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Sidebar from './components/Sidebar'
import GenericModule from './modules/GenericModule'
import { MODULES } from './modules/moduleConfigs'

export default function App() {
  const { loading, user } = useAuth()
  const [active, setActive] = useState('tasks')
  const [mobileOpen, setMobileOpen] = useState(false)

  if (loading) return <div className="loading">טוען...</div>
  if (!user) return <Login />

  return (
    <div className="layout">
      <Sidebar
        active={active}
        onSelect={setActive}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      <main>
        <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)}>☰ תפריט</button>
        <GenericModule key={active} config={MODULES[active]} />
      </main>
    </div>
  )
}
