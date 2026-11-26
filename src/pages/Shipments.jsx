import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { groupOrders } from '../lib/orders'
import { SHIPPING_COMPANIES, getCompanyCost } from '../lib/pricing'
import { formatDate, isCountedOrder, FINANCE_START } from '../lib/format'
import { useNav } from '../contexts/NavContext'
import { useSort, sortRows, SortTh } from '../lib/sort'
import ExportButtons from '../components/ExportButtons'

// משלוחים: פירוט לפי חברת השליחויות שנבחרה בהזמנה (פרדי / הובלות / אנחנו) — כמה משלוחים, כמה כל אחד לקח
// (לפי המחירים בהגדרות; "אנחנו" ללא עלות), וכמה הלקוחות שילמו על משלוח. הזמנות בלי חברה ואיסוף עצמי בנפרד.
const ils = n => '₪' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('he-IL')
const pad = n => String(n).padStart(2, '0')
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const isPickup = o => /איסוף/.test(o.shipping_method || '')
const cityOf = o => {
  if (o.shipping_city) return o.shipping_city
  const addr = String(o.shipping_address || '').split(' · ').pop()
  const parts = addr.split(',').map(x => x.trim()).filter(x => x && !/^\d+$/.test(x))
  return parts.length > 1 ? parts[parts.length - 1] : (parts[0] ? parts[0].split(/\s+/).pop() : '')
}
// לאיזו קבוצה שייכת ההזמנה
const groupOf = o => {
  const c = SHIPPING_COMPANIES.find(x => x.label === o.shipping_company)
  if (c) return c.key
  return isPickup(o) ? 'pickup' : 'none'
}

export default function Shipments() {
  const { openRecord } = useNav()
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')
  const [month, setMonth] = useState(thisMonth())
  const [tab, setTab] = useState('all')
  const [sort, onSort] = useSort({ key: 'date', dir: 'desc' })

  useEffect(() => {
    supabase.from('orders')
      .select('id, wc_order_id, merged_into_wc_order_id, order_number, order_date, created_at, customer_name, shipping_method, shipping_company, shipping_city, shipping_address, shipping_total, order_total, handling_status, wc_status, not_supplied, manual_line, product_name, sku, quantity, total_amount, discount_amount, replaces_line_id, is_promo')
      .order('order_date', { ascending: false })
      .then(({ data, error: e }) => {
        if (e) { setError(e.message); setOrders([]); return }
        // רק הזמנות מהאתר (הזמנה ידנית אינה משלוח), בסטטוס שנספר, מתאריך תחילת הסיכומים
        const site = (data || []).filter(o => isCountedOrder(o) && (o.wc_order_id || o.merged_into_wc_order_id)
          && String(o.order_date || '').slice(0, 10) >= FINANCE_START)
        setOrders(groupOrders(site))
      })
  }, [])

  if (orders === null) return <div className="loading">טוען משלוחים...</div>

  const inMonth = o => !month || String(o.order_date || '').slice(0, 7) === month
  const list = orders.filter(inMonth)
  const costOf = o => { const c = SHIPPING_COMPANIES.find(x => x.label === o.shipping_company); return c ? getCompanyCost(c.key) : 0 }
  const GROUPS = [
    ...SHIPPING_COMPANIES.map(c => ({ key: c.key, label: c.label, note: c.free ? 'ללא עלות' : `${ils(getCompanyCost(c.key))} למשלוח` })),
    { key: 'none', label: 'לא נבחרה חברה', note: 'לא נספר בעלות' },
    { key: 'pickup', label: 'איסוף עצמי', note: 'ללא משלוח' },
  ]
  const stats = Object.fromEntries(GROUPS.map(g => {
    const rows = list.filter(o => groupOf(o) === g.key)
    return [g.key, { count: rows.length, cost: rows.reduce((a, o) => a + costOf(o), 0), paid: rows.reduce((a, o) => a + (Number(o.shipping_total) || 0), 0) }]
  }))
  const totalCost = list.reduce((a, o) => a + costOf(o), 0)
  const totalPaid = list.reduce((a, o) => a + (Number(o.shipping_total) || 0), 0)

  const shown = tab === 'all' ? list : list.filter(o => groupOf(o) === tab)
  const sorted = sortRows(shown, {
    date: o => o.order_date || '', num: o => Number(o.order_number) || 0, customer: o => o.customer_name || '',
    city: o => cityOf(o), company: o => o.shipping_company || '', status: o => o.handling_status || '',
    paid: o => Number(o.shipping_total) || 0, cost: costOf,
  }, sort)
  const groupLabel = o => GROUPS.find(g => g.key === groupOf(o))?.label || ''

  return (
    <div>
      <div className="module-head">
        <h2>🚚 משלוחים</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="head-month">
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
            {month && <button type="button" className="link-btn" onClick={() => setMonth('')}>כל החודשים</button>}
          </span>
          <ExportButtons name="mishlochim" title="משלוחים" getData={() => ({
            headers: ['תאריך', 'מס׳ הזמנה', 'לקוח', 'עיר', 'שיטת משלוח', 'חברת שליחויות', 'סטטוס טיפול', 'הלקוח שילם על משלוח', 'עלות המשלוח'],
            rows: sorted.map(o => [formatDate(String(o.order_date || '').slice(0, 10)), o.order_number || '', o.customer_name || '', isPickup(o) ? '' : cityOf(o),
              o.shipping_method || '', groupLabel(o), o.handling_status || '', Number(o.shipping_total) || 0, costOf(o)]),
          })} />
        </div>
      </div>
      {error && <div className="err-inline">{error}</div>}

      <div className="summary-row wide">
        {GROUPS.map(g => (
          <div key={g.key} className={`summary-card ship-sum${tab === g.key ? ' on' : ''}`} role="button" onClick={() => setTab(tab === g.key ? 'all' : g.key)} title="לחיצה מסננת את הטבלה">
            <span>{g.label} · {stats[g.key].count} משלוחים · {g.note}</span>
            <b className={stats[g.key].cost ? 'neg' : ''}>{stats[g.key].cost ? `−${ils(stats[g.key].cost)}` : ils(0)}</b>
            {stats[g.key].paid > 0 && <small className="cmp-sub">הלקוחות שילמו על משלוח: {ils(stats[g.key].paid)}</small>}
          </div>
        ))}
      </div>
      <div className="cmp-sub" style={{ margin: '-6px 0 12px' }}>
        סה״כ {list.length} הזמנות · עלות משלוחים: <b className="neg">{ils(totalCost)}</b> · הלקוחות שילמו על משלוח: <b className="pos">{ils(totalPaid)}</b>
        {' · '}הפרש: <b className={totalPaid - totalCost >= 0 ? 'pos' : 'neg'}>{ils(totalPaid - totalCost)}</b>
        <br />המחירים לכל חברה נקבעים בהגדרות. כדי לשייך הזמנה לחברה: בחר אותה בעמודת המשלוח במסך ההזמנות.
      </div>

      <div className="status-filter">
        {[{ key: 'all', label: 'הכל' }, ...GROUPS].map(g => (
          <button key={g.key} className={tab === g.key ? 'active' : ''} onClick={() => setTab(g.key)}>
            {g.label} <span style={{ opacity: 0.6 }}>({g.key === 'all' ? list.length : stats[g.key].count})</span>
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <SortTh k="date" sort={sort} onSort={onSort}>תאריך</SortTh>
            <SortTh k="num" sort={sort} onSort={onSort}>הזמנה</SortTh>
            <SortTh k="customer" sort={sort} onSort={onSort}>לקוח</SortTh>
            <SortTh k="city" sort={sort} onSort={onSort}>עיר</SortTh>
            <SortTh k="company" sort={sort} onSort={onSort}>חברת שליחויות</SortTh>
            <SortTh k="status" sort={sort} onSort={onSort}>סטטוס טיפול</SortTh>
            <SortTh k="paid" sort={sort} onSort={onSort}>הלקוח שילם על משלוח</SortTh>
            <SortTh k="cost" sort={sort} onSort={onSort}>עלות המשלוח</SortTh>
          </tr></thead>
          <tbody>
            {sorted.length > 0 && (
              <tr className="totals-row">
                <td colSpan={6}>סה״כ ({sorted.length} הזמנות)</td>
                <td>{ils(sorted.reduce((a, o) => a + (Number(o.shipping_total) || 0), 0))}</td>
                <td>{ils(sorted.reduce((a, o) => a + costOf(o), 0))}</td>
              </tr>
            )}
            {sorted.length === 0 && <tr><td className="empty-col" colSpan={8}>אין משלוחים בתקופה</td></tr>}
            {sorted.map(o => (
              <tr key={o.id} onClick={() => openRecord('orders', o.id)} title="לחיצה פותחת את ההזמנה">
                <td>{formatDate(String(o.order_date || '').slice(0, 10))}</td>
                <td>#{o.order_number}</td>
                <td>{o.customer_name || '—'}</td>
                <td>{isPickup(o) ? '—' : cityOf(o) || '—'}</td>
                <td>{o.shipping_company
                  ? <span className={`ship-badge ${isPickup(o) ? 'ship-pickup' : 'ship-delivery'}`}>{o.shipping_company}</span>
                  : <span className="cmp-sub">{isPickup(o) ? 'איסוף עצמי' : 'לא נבחרה'}</span>}</td>
                <td>{o.handling_status || '—'}</td>
                <td>{Number(o.shipping_total) ? ils(o.shipping_total) : '—'}</td>
                <td className={costOf(o) ? 'neg' : ''}>{costOf(o) ? `−${ils(costOf(o))}` : '₪0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
