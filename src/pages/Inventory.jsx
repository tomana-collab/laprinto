import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useNav } from '../contexts/NavContext'
import { useSort, sortRows, SortTh } from '../lib/sort'

const num = n => (Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })

// מצב מלאי: מלאי שלילי = נמכר יותר ממה שנקלט, כלומר צריך להזמין מהספק.
const needToOrder = r => Math.max(0, -r.stock - r.incoming) // חסר שעדיין לא הוזמן
function status(r) {
  if (r.stock < 0 && needToOrder(r) === 0) return { key: 'incoming', text: `חסר ${num(-r.stock)} — הוזמן, בהמתנה לאספקה`, cls: 'pos' }
  if (r.stock < 0) return { key: 'order', text: `חסר ${num(needToOrder(r))} — להזמין מהספק`, cls: 'neg' }
  if (r.stock === 0) return { key: 'out', text: 'אזל', cls: 'neg' }
  if (r.stock_min > 0 && r.stock <= r.stock_min) return { key: 'low', text: 'מלאי נמוך', cls: 'neg' }
  return { key: 'ok', text: 'במלאי', cls: 'pos' }
}

export default function Inventory() {
  const { openRecord } = useNav()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [countMode, setCountMode] = useState(false) // ספירת מלאי מרוכזת
  const [counts, setCounts] = useState({}) // id -> כמות בפועל שהוזנה
  const [savingCount, setSavingCount] = useState(false)
  const [sort, onSort] = useSort({ key: 'sold_total', dir: 'desc' }) // ברירת מחדל: הנמכרים ביותר למעלה
  const [counting, setCounting] = useState(null) // שורה לספירת מלאי

  async function load() {
    setError('')
    const [p, s, ri] = await Promise.all([
      supabase.from('products').select('id, name, sku, category, cost_after_discount, price, opening_stock, stock_min, wc_product_id, wc_parent_id, suppliers(name)').order('name'),
      supabase.from('product_stock').select('*'),
      supabase.from('stock_receipt_items').select('product_id, quantity, unit_cost, discount_percent, stock_receipts(status)'),
    ])
    const err = [p, s, ri].find(x => x.error)
    if (err) { setError(err.error.message); setRows([]); return }
    const st = new Map(s.data.map(x => [x.product_id, x]))
    // עלות ממוצעת ליחידה מהתעודות שסופקו (אחרי הנחה) — משמשת כשלא הוזנה עלות במוצר עצמו
    const rc = new Map()
    for (const i of ri.data) {
      if ((i.stock_receipts?.status || 'סופק') !== 'סופק') continue
      const net = (Number(i.unit_cost) || 0) * (1 - (Number(i.discount_percent) || 0) / 100)
      const q = Number(i.quantity) || 0
      const cur = rc.get(i.product_id) || { qty: 0, sum: 0 }
      cur.qty += q; cur.sum += q * net
      rc.set(i.product_id, cur)
    }
    const parents = new Set(p.data.map(x => x.wc_parent_id).filter(Boolean)) // מוצרים ראשיים שפוצלו לוריאציות
    setRows(p.data.filter(pr => !parents.has(pr.wc_product_id)).map(pr => {
      const x = st.get(pr.id) || {}
      return { ...pr, opening: Number(x.opening) || 0, received: Number(x.received) || 0, sold: Number(x.sold) || 0, stock: Number(x.stock) || 0, incoming: Number(x.incoming) || 0, sold_total: Number(x.sold_total) || 0, stock_min: Number(pr.stock_min) || 0, unit_cost: Number(pr.cost_after_discount) || (rc.get(pr.id)?.qty ? rc.get(pr.id).sum / rc.get(pr.id).qty : 0), unit_price: Number(pr.price) || 0 }
    }))
  }
  useEffect(() => { load() }, [])

  // ספירת מלאי: המשתמש מזין כמה יש בפועל, ואנחנו מחשבים מלאי פתיחה כך שהמלאי הנוכחי יתאים
  async function saveCount(row, actual, min) {
    const opening = Number(actual) - row.received + row.sold
    const { error: e } = await supabase.from('products').update({ opening_stock: opening, stock_min: Number(min) || 0 }).eq('id', row.id)
    if (e) { setError(e.message); return }
    setCounting(null); load()
  }

  // שמירת ספירה מרוכזת: לכל מוצר שהוזנה לו כמות שונה מהמלאי הנוכחי מחשבים מלאי פתיחה חדש
  async function saveCounts() {
    const changed = (rows || []).filter(r => counts[r.id] !== undefined && counts[r.id] !== '' && Number(counts[r.id]) !== r.stock)
    if (changed.length === 0) { setCountMode(false); setCounts({}); return }
    if (!window.confirm(`לעדכן את המלאי של ${changed.length} מוצרים לפי הספירה?`)) return
    setSavingCount(true)
    const results = await Promise.all(changed.map(r =>
      supabase.from('products').update({ opening_stock: Number(counts[r.id]) - r.received + r.sold }).eq('id', r.id)))
    setSavingCount(false)
    const failed = results.find(x => x.error)
    if (failed) { setError(failed.error.message); return }
    setCountMode(false); setCounts({}); load()
  }

  const shown = useMemo(() => (rows || []).filter(r => {
    if (category && r.category !== category) return false
    if (filter === 'sold') { if (!(r.sold_total > 0)) return false }
    else if (filter === 'unsold') { if (!(r.stock > 0 && r.sold_total === 0)) return false }
    else if (filter !== 'all' && status(r).key !== filter) return false
    const t = q.trim().toLowerCase()
    return !t || r.name.toLowerCase().includes(t) || (r.sku || '').toLowerCase().includes(t)
  }), [rows, filter, q, category])

  if (rows === null) return <div className="loading">טוען מלאי...</div>

  const toOrder = rows.filter(r => needToOrder(r) > 0)
  const inStock = rows.filter(r => r.stock > 0)
  const unsold = inStock.filter(r => r.sold_total === 0) // יש במלאי ועדיין לא נמכרה אפילו יחידה
  const receivedUnits = rows.reduce((a, r) => a + r.received, 0)
  const incomingUnits = rows.reduce((a, r) => a + r.incoming, 0)
  const stockUnits = inStock.reduce((a, r) => a + r.stock, 0) // רק מלאי חיובי, בלי חוסרים
  const unsoldUnits = unsold.reduce((a, r) => a + r.stock, 0)
  const unsoldCost = unsold.reduce((a, r) => a + r.stock * r.unit_cost, 0)
  const unsoldSale = unsold.reduce((a, r) => a + r.stock * r.unit_price, 0)

  return (
    <div>
      <div className="module-head">
        <h2>📦 מלאי</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {countMode && <button className="btn-add" onClick={() => { setCountMode(false); setCounts({}) }}>ביטול</button>}
          <button className="btn-add" disabled={savingCount} onClick={() => countMode ? saveCounts() : setCountMode(true)}>
            {countMode ? (savingCount ? 'שומר...' : 'שמירת ספירה') : '📝 ספירת מלאי'}
          </button>
        </div>
      </div>
      {countMode && <div className="summary-row" style={{ padding: '8px 12px', gridTemplateColumns: '1fr' }}>
        מצב ספירה: הזן בעמודה "ספירה בפועל" כמה יש לך במחסן. מוצר שלא תזין לו כמות לא ישתנה. אפשר לסנן לפי קטגוריה (למשל סביבונים) ואז לשמור.
      </div>}
      {error && <div className="err-inline">{error}</div>}

      <div className="summary-row">
        <div className="summary-card"><span>יחידות שנקלטו בתעודות (סה״כ שהגיעו)</span><b>{num(receivedUnits)}</b></div>
        <div className="summary-card"><span>יחידות שהוזמנו וממתינות לאספקה</span><b>{num(incomingUnits)}</b></div>
        <div className="summary-card"><span>יחידות במלאי כרגע</span><b>{num(stockUnits)}</b></div>
      </div>

      <div className="summary-row">
        <div className="summary-card"><span>יחידות במלאי שטרם נמכרו ({unsold.length} מוצרים)</span><b>{num(unsoldUnits)}</b></div>
        <div className="summary-card"><span>כסף תקוע בהם — לפי עלות (לפני מע״מ)</span><b>₪{num(Math.round(unsoldCost))}</b></div>
        <div className="summary-card"><span>שווי מכירה שלהם באתר (כולל מע״מ)</span><b>₪{num(Math.round(unsoldSale))}</b></div>
      </div>

      <div className="summary-row">
        <div className="summary-card"><span>מוצרים במלאי</span><b>{inStock.length}</b></div>
        <div className="summary-card"><span>מוצרים שחסרים — להזמין מהספק</span><b className={toOrder.length ? 'neg' : ''}>{toOrder.length}</b></div>
        <div className="summary-card"><span>יחידות להזמנה</span><b>{num(toOrder.reduce((a, r) => a + needToOrder(r), 0))}</b></div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input type="text" placeholder="חיפוש שם / מק״ט" value={q} onChange={e => setQ(e.target.value)} />
        <select value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">כל הקטגוריות</option>
          {[...new Set(rows.map(r => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">הכל</option>
          <option value="unsold">במלאי ללא מכירה</option>
          <option value="sold">נמכר (נמכרו יחידות)</option>
          <option value="order">חסר — להזמין</option>
          <option value="incoming">הוזמן, בהמתנה לאספקה</option>
          <option value="out">אזל</option>
          <option value="low">מלאי נמוך</option>
          <option value="ok">במלאי</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <SortTh k="name" sort={sort} onSort={onSort}>מוצר</SortTh>
              <SortTh k="sku" sort={sort} onSort={onSort}>מק״ט</SortTh>
              <SortTh k="supplier" sort={sort} onSort={onSort}>ספק</SortTh>
              <SortTh k="received" sort={sort} onSort={onSort}>נקלט</SortTh>
              <SortTh k="sold_total" sort={sort} onSort={onSort}>נמכר (סה״כ הזמנות)</SortTh>
              <SortTh k="sold" sort={sort} onSort={onSort}>ירד מהמלאי</SortTh>
              <SortTh k="incoming" sort={sort} onSort={onSort}>בהמתנה לאספקה</SortTh>
              <SortTh k="stock" sort={sort} onSort={onSort}>מלאי נוכחי</SortTh>
              <SortTh k="status" sort={sort} onSort={onSort}>מצב</SortTh>
              {countMode && <th>ספירה בפועל</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td className="empty-col" colSpan={10}>אין מוצרים</td></tr>}
            {sortRows(shown, {
              name: r => r.name, sku: r => r.sku || '', supplier: r => r.suppliers?.name || '',
              received: r => r.received, sold_total: r => r.sold_total,
              sold: r => r.sold, incoming: r => r.incoming, stock: r => r.stock, status: r => status(r).text,
            }, sort).map(r => {
              const s = status(r)
              return (
                <tr key={r.id} onClick={countMode ? undefined : () => setCounting(r)} style={countMode ? { cursor: 'default' } : undefined}>
                  <td><a href="#" onClick={e => { e.preventDefault(); e.stopPropagation(); openRecord('products', r.id) }}>{r.name}</a></td>
                  <td>{r.sku || '—'}</td>
                  <td>{r.suppliers?.name || '—'}</td>
                  <td>{num(r.received)}</td>
                  <td><b>{num(r.sold_total)}</b></td>
                  <td>{num(r.sold)}</td>
                  <td>{r.incoming ? num(r.incoming) : '—'}</td>
                  <td><b className={s.cls}>{num(r.stock)}</b></td>
                  <td><span className={s.cls}>{s.text}</span></td>
                  {countMode && <td><input type="number" min="0" style={{ width: 90 }} placeholder={String(r.stock)} value={counts[r.id] ?? ''} onChange={e => setCounts(c => ({ ...c, [r.id]: e.target.value }))} /></td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: 'var(--ink-soft)', fontSize: 12.5, marginTop: 10 }}>
        מלאי נוכחי = מלאי פתיחה + מה שנקלט בתעודות שסופקו − מה שנמכר מתאריך תחילת המעקב. "נמכר (סה״כ הזמנות)" סופר את כל ההזמנות שבטיפול/הושלמו, גם מלפני תחילת המעקב; "ירד מהמלאי" הוא החלק שמנוכה מהמלאי. לחיצה על שורה = ספירת מלאי.
      </p>

      {counting && <CountModal row={counting} onCancel={() => setCounting(null)} onSave={saveCount} />}
    </div>
  )
}

function CountModal({ row, onCancel, onSave }) {
  const [actual, setActual] = useState(row.stock)
  const [min, setMin] = useState(row.stock_min || 0)
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal">
        <h2>ספירת מלאי</h2>
        <p>{row.name}{row.sku ? ` · ${row.sku}` : ''}</p>
        <div className="field"><label>כמות בפועל במחסן</label>
          <input type="number" value={actual} onChange={e => setActual(e.target.value)} /></div>
        <div className="field"><label>התראת מלאי נמוך מתחת ל־</label>
          <input type="number" min="0" value={min} onChange={e => setMin(e.target.value)} /></div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>ביטול</button>
          <button className="btn btn-primary" onClick={() => onSave(row, actual, min)}>שמירה</button>
        </div>
      </div>
    </div>
  )
}
