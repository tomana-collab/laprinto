import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { formatDateTime } from '../lib/format'

// התראה בראש הפורטל כשמשימה אוטומטית נכשלה או לא רצה במועד.
// מקור: job_runs — הריצה האחרונה של כל משימה, ובדיקת התקינות היומית (09:00).
const LABEL = { wc_sync: 'סנכרון WooCommerce', price_scan: 'סריקת מחירי מתחרים', health_check: 'בדיקת תקינות יומית' }

export default function JobAlert() {
  const [problems, setProblems] = useState([])
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    supabase.from('job_runs').select('id, job_type, status, started_at, errors').order('started_at', { ascending: false }).limit(30)
      .then(({ data }) => {
        const latest = {}
        for (const r of data || []) if (!latest[r.job_type]) latest[r.job_type] = r
        const list = []
        const health = latest.health_check
        if (health?.status === 'failed') for (const e of health.errors || []) list.push({ key: health.id + e.error, text: e.error, at: health.started_at })
        for (const t of ['wc_sync', 'price_scan']) {
          const r = latest[t]
          // כישלון חדש יותר מבדיקת התקינות האחרונה (או שעוד לא הייתה בדיקה)
          if (r?.status === 'failed' && (!health || r.started_at > health.started_at)) list.push({ key: r.id, text: `${LABEL[t]}: נכשלה`, at: r.started_at })
        }
        setProblems(list)
      })
  }, [])

  if (hidden || !problems.length) return null
  return (
    <div className="err-inline" role="alert" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
      <div>
        <b>תקלה במשימות האוטומטיות</b>
        {problems.map(p => <div key={p.key}>{p.text} <span dir="ltr" style={{ opacity: .75 }}>({formatDateTime(p.at)})</span></div>)}
      </div>
      <button className="link-btn" onClick={() => setHidden(true)}>הסתר</button>
    </div>
  )
}
