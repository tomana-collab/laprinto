import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useNav } from '../contexts/NavContext'
import { formatDate, formatDateTime } from '../lib/format'
import { SupplierStock } from '../components/SupplierStock'

// דף "הודעות חשובות". מקור: טבלת notifications (נכתבת ע"י הבדיקה היומית של מלאי הספק, supplier-stock-check).
// הדגל בתפריט הוא מספר ההודעות שעוד לא סומנו כנקראו.
const SITE_STATUS = { instock: 'במלאי באתר', outofstock: 'אזל באתר', onbackorder: 'בהזמנה מראש' }

export const NOTIFICATIONS_CHANGED = 'notifications-changed'

export default function Notifications() {
  const { openRecord } = useNav()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [lastRun, setLastRun] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }

  async function load() {
    const [n, j] = await Promise.all([
      supabase.from('notifications').select('*').order('day', { ascending: false }).order('kind').limit(60),
      supabase.from('job_runs').select('status, trigger, started_at, finished_at, success_count, failure_count').eq('job_type', 'supplier_stock').order('started_at', { ascending: false }).limit(1),
    ])
    if (n.error) { setError(n.error.message); setRows([]); return }
    setRows(n.data)
    setLastRun(j.data?.[0] || null)
  }
  useEffect(() => { load() }, [])

  async function setRead(ids, read) {
    const { error: e } = await supabase.from('notifications').update({ read_at: read ? new Date().toISOString() : null }).in('id', ids)
    if (e) { setError(e.message); return }
    setRows(list => list.map(r => ids.includes(r.id) ? { ...r, read_at: read ? new Date().toISOString() : null } : r))
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
  }

  async function checkNow() {
    setBusy(true); setMsg(null)
    const { data, error: e } = await supabase.functions.invoke('supplier-stock-check', { body: { start: true } })
    setBusy(false)
    let text = e?.message
    if (e?.context?.json) { try { const j = await e.context.json(); text = j?.error || (j?.already_running ? 'בדיקה כבר רצה כרגע' : text) } catch { /* ignore */ } }
    if (e || data?.error) { setMsg({ ok: false, text: `הבדיקה לא התחילה: ${text || data?.error}` }); return }
    setMsg({ ok: true, text: 'הבדיקה התחילה. היא עוברת על המוצרים בקבוצות ותסתיים בעוד כמה דקות. רענן את הדף כדי לראות את התוצאה.' })
    load()
  }

  const unread = (rows || []).filter(r => !r.read_at)
  return (
    <div>
      <div className="module-head">
        <h2>🔔 הודעות חשובות</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-add" onClick={checkNow} disabled={busy}>{busy ? 'בודק…' : '⟳ בדוק מלאי אצל הספק עכשיו'}</button>
          {unread.length > 0 && <button className="btn-outline" style={{ borderRadius: 999, padding: '9px 16px', fontWeight: 700 }} onClick={() => setRead(unread.map(r => r.id), true)}>סמן הכול כנקרא</button>}
        </div>
      </div>
      <div className="cmp-sub" style={{ marginBottom: 14 }}>
        בדיקת מלאי אצל ארט יודאיקה: כל יום ב-07:00 או בלחיצה. הבדיקה פונה לאתר הספק בלבד ולא משנה כלום באתר שלך.
        {lastRun && <> בדיקה אחרונה: <b dir="ltr">{formatDateTime(lastRun.finished_at || lastRun.started_at)}</b> ({lastRun.status === 'running' ? 'רצה כעת' : lastRun.status === 'failed' ? 'נכשלה' : `נבדקו ${lastRun.success_count ?? 0}, שגיאות ${lastRun.failure_count ?? 0}`})</>}
      </div>
      {msg && <div className={`cmp-scan-msg ${msg.ok ? 'ok' : 'warn'}`} style={{ marginBottom: 12 }}>{msg.text}</div>}
      {error && <div className="err-inline">{error}</div>}
      {rows === null && <div className="loading">טוען...</div>}
      {rows?.length === 0 && !error && <div className="empty-col">עוד אין הודעות. הן יופיעו אחרי הבדיקה הראשונה מול הספק.</div>}

      {(rows || []).map(n => (
        <div key={n.id} className={`notif-card ${n.read_at ? '' : 'unread'}`}>
          <div className="notif-head">
            <div>
              <b>{!n.read_at && <span className="notif-dot" />}{n.title}</b>
              <div className="cmp-sub">{formatDate(n.day)}{n.body ? ` · ${n.body}` : ''}</div>
            </div>
            <button className="cmp-tool" onClick={() => setRead([n.id], !n.read_at)}>{n.read_at ? 'סמן כלא נקרא' : '✓ סמן כנקרא'}</button>
          </div>
          {n.items?.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data-table">
                <thead><tr><th>מוצר</th><th>מק״ט</th><th>אצל הספק</th><th>באתר שלך</th><th>מלאי עצמי</th><th>מאז</th></tr></thead>
                <tbody>
                  {n.items.map(i => (
                    <tr key={i.product_id}>
                      <td><a href="#" onClick={e => { e.preventDefault(); openRecord('products', i.product_id) }}>{i.name}</a></td>
                      <td>{i.sku || '—'}</td>
                      <td><SupplierStock status={i.supplier_status} checkedAt={i.checked_at} /></td>
                      <td>{SITE_STATUS[i.site_status] || (i.site_status ? i.site_status : 'פעיל')}</td>
                      <td title="נקלט פחות נמכר, לפי עמוד המלאי">{i.own_stock ?? '—'}</td>
                      <td>{i.since ? formatDate(String(i.since).slice(0, 10)) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
