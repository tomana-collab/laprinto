import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { MODULE_ORDER, MODULES } from '../modules/moduleConfigs'
import { useAuth } from '../contexts/AuthContext'

export default function Sidebar({ active, onSelect, mobileOpen, onClose }) {
  const { user, signOut } = useAuth()
  const [role, setRole] = useState(null) // null עד שנטען, כדי לא להבזיק תפריטים אדמין לפני שידוע שהם מותרים

  useEffect(() => {
    if (!user?.email) return
    supabase.from('team_members').select('role').ilike('email', user.email).maybeSingle()
      .then(({ data }) => setRole(data?.role || null))
  }, [user?.email])

  const visibleModules = MODULE_ORDER.filter(key => !MODULES[key].adminOnly || role === 'אדמין')

  return (
    <>
      {mobileOpen && <div className="sidebar-scrim" onClick={onClose} />}
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="mark">L</div>
          <div>
            <h1>Laprinto</h1>
            <span>CRM פנימי</span>
          </div>
        </div>
        <nav>
          {visibleModules.map(key => (
            <button
              key={key}
              className={active === key ? 'active' : ''}
              onClick={() => { onSelect(key); onClose() }}
            >
              <span className="nav-icon">{MODULES[key].icon}</span> {MODULES[key].label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-line">{user?.email}</div>
          <button className="signout" onClick={signOut}>התנתקות</button>
        </div>
      </aside>
    </>
  )
}
