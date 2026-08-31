import { MODULE_ORDER, MODULES } from '../modules/moduleConfigs'
import { useAuth } from '../contexts/AuthContext'

export default function Sidebar({ active, onSelect, mobileOpen, onClose }) {
  const { user, signOut } = useAuth()

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
          {MODULE_ORDER.map(key => (
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
