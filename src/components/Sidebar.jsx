import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { MODULES } from '../modules/moduleConfigs'
import { useAuth } from '../contexts/AuthContext'

const DEV_GROUP = ['tasks', 'ideas', 'opportunities', 'trends', 'suppliers']

export default function Sidebar({ active, onSelect, mobileOpen, onClose }) {
  const { user, signOut, signOutAllDevices } = useAuth()
  const [role, setRole] = useState(null) // null עד שנטען, כדי לא להבזיק תפריטים אדמין לפני שידוע שהם מותרים

  useEffect(() => {
    if (!user?.email) return
    supabase.from('team_members').select('role').ilike('email', user.email).maybeSingle()
      .then(({ data }) => setRole(data?.role || null))
  }, [user?.email])

  const [devOpen, setDevOpen] = useState(false)
  const devActive = DEV_GROUP.includes(active)
  const isAdmin = role === 'אדמין'

  // סדר התפריט. מארזים וקליטת תעודות נשארים ליד המוצרים והמלאי שהם שייכים אליהם.
  // משתמשים — בתוך עמוד ההגדרות (לאדמין).
  const PAGES = {
    dashboard: { icon: '📊', label: 'דאשבורד', admin: true },
    competitors: { icon: '🔎', label: 'השוואת מחירים' },
    bundles: { icon: '🎁', label: 'מארזים' },
    inventory: { icon: '📦', label: 'מלאי' },
    receipts: { icon: '📥', label: 'קליטת תעודות' },
  }
  const ORDER = ['dashboard', 'orders', 'competitors', 'products', 'inventory', 'receipts', 'expenses', 'dev']

  const item = key => {
    if (key === 'dev') return devGroup
    const page = PAGES[key] || MODULES[key]
    if (!page) return null
    if ((page.admin || page.adminOnly) && !isAdmin) return null
    return (
      <button key={key} className={active === key ? 'active' : ''} onClick={() => { onSelect(key); onClose() }}>
        <span className="nav-icon">{page.icon}</span> {page.label}
      </button>
    )
  }
  const devGroup = (
    <Fragment key="dev-group">
      <button className={`nav-group ${devOpen || devActive ? 'open' : ''}`} onClick={() => setDevOpen(o => !o)}>
        <span className="nav-icon">🚀</span> פיתוח העסק <span className="chev">◀</span>
      </button>
      {(devOpen || devActive) && <div className="nav-sub">{DEV_GROUP.map(item)}</div>}
    </Fragment>
  )

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
          {ORDER.map(item)}
        </nav>
        <div className="sidebar-footer">
          <button
            className={`settings-btn ${active === 'settings' ? 'active' : ''}`}
            onClick={() => { onSelect('settings'); onClose() }}
          >⚙️ הגדרות</button>
          <div className="user-line">{user?.email}</div>
          <button className="signout" onClick={signOut}>התנתקות</button>
          <button className="signout" onClick={() => { if (window.confirm('להתנתק מכל המכשירים והדפדפנים שמחוברים לחשבון הזה?')) signOutAllDevices() }}>התנתקות מכל המכשירים</button>
        </div>
      </aside>
    </>
  )
}
