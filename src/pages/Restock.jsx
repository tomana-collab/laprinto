import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useNav } from '../contexts/NavContext'
import { useSort, sortRows, SortTh } from '../lib/sort'

const num = n => (Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })

// השלמת מוצרים: מוצרים שהוזמנו (הזמנות שעוד לא נקבע להן סטטוס טיפול) ואין להם מספיק במלאי.
//   מלאי קיים  = נקלט בתעודות − מה שסופק ללקוחות
//   הוזמן      = כמות בהזמנות פתוחות
//   חסר        = הוזמן − מלאי קיים
//   להזמנה     = חסר − מה שכבר הוזמן מהספק ומחכה לאספקה
export default function Restock() {
  const { openRecord } = useNav()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState('')
  const [sort, onSort] = useSort({ key: 'toOrder', dir: 'desc' })

  useEffect(() => {
    async function load() {
      const [p, s] = await Promise.all([
        supabase.from('products').select('id, name, sku, category, wc_product_id, wc_parent_id, suppliers(name)'),
        supabase.from('product_stock').select('product_id, stock, incoming, open_orders'),
      ])
      const err = [p, s].find(x => x.error)
      if (err) { setError(err.error.message); setRows([]); return }
      const st = new Map(s.data.map(x => [x.product_id, x]))
      const parents = new Set(p.data.map(x => x.wc_parent_id).filter(Boolean))
      setRows(p.data.filter(pr => !parents.has(pr.wc_product_id)).map(pr => {
        const x = st.get(pr.id) || {}
        const stock = Number(x.stock) || 0
        const ordered = Number(x.open_orders) || 0
        const incoming = Number(x.incoming) || 0
        const missing = Math.max(0, ordered - Math.max(0, stock))
        return { ...pr, supplier: pr.suppliers?.name || '', stock, ordered, incoming, missing, toOrder: Math.max(0, missing - incoming) }
      }).filter(r => r.ordered > 0))
    }
    load()
  }, [])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows || []).filter(r => (showAll || r.missing > 0) &&
      (!needle || r.name.toLowerCase().includes(needle) || (r.sku || '').toLowerCase().includes(needle)))
  }, [rows, showAll, q])

  if (rows === null) return <div className="loading">טוען...</div>

  const missingRows = rows.filter(r => r.missing > 0)
  const toOrderRows = rows.filter(r => r.toOrder > 0)

  return (
    <div>
      <div className="module-head"><h2>🧩 השלמת מוצרים</h2></div>
      {error && <div className="err-inline">{error}</div>}

      <div className="summary-row">
        <div className="summary-card"><span>מוצרים בהזמנות פתוחות</span><b>{rows.length}</b></div>
        <div className="summary-card"><span>מוצרים שהוזמנו ואין מספיק במלאי</span><b className={missingRows.length ? 'neg' : ''}>{missingRows.length}</b></div>
        <div className="summary-card"><span>מוצרים להזמין מהספק ({num(toOrderRows.reduce((a, r) => a + r.toOrder, 0))} יחידות)</span><b className={toOrderRows.length ? 'neg' : ''}>{toOrderRows.length}</b></div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="חיפוש שם / מק״ט" value={q} onChange={e => setQ(e.target.value)} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> הצג גם מוצרים שיש להם מספיק במלאי
        </label>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <SortTh k="name" sort={sort} onSort={onSort}>מוצר</SortTh>
              <SortTh k="sku" sort={sort} onSort={onSort}>מק״ט</SortTh>
              <SortTh k="supplier" sort={sort} onSort={onSort}>ספק</SortTh>
              <SortTh k="ordered" sort={sort} onSort={onSort}>הוזמן (בהזמנות פתוחות)</SortTh>
              <SortTh k="stock" sort={sort} onSort={onSort}>מלאי קיים</SortTh>
              <SortTh k="missing" sort={sort} onSort={onSort}>חסר</SortTh>
              <SortTh k="incoming" sort={sort} onSort={onSort}>בהמתנה לאספקה</SortTh>
              <SortTh k="toOrder" sort={sort} onSort={onSort}>להזמין מהספק</SortTh>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td className="empty-col" colSpan={8}>{showAll ? 'אין מוצרים בהזמנות פתוחות' : 'אין מוצרים שחסרים. כל מה שהוזמן קיים במלאי'}</td></tr>}
            {sortRows(shown, {
              name: r => r.name, sku: r => r.sku || '', supplier: r => r.supplier, ordered: r => r.ordered,
              stock: r => r.stock, missing: r => r.missing, incoming: r => r.incoming, toOrder: r => r.toOrder,
            }, sort).map(r => (
              <tr key={r.id}>
                <td><a href="#" onClick={e => { e.preventDefault(); openRecord('products', r.id) }}>{r.name}</a></td>
                <td>{r.sku || '—'}</td>
                <td>{r.supplier || '—'}</td>
                <td><b>{num(r.ordered)}</b></td>
                <td><b className={r.stock <= 0 ? 'neg' : ''}>{num(r.stock)}</b></td>
                <td>{r.missing ? <b className="neg">{num(r.missing)}</b> : '—'}</td>
                <td>{r.incoming ? num(r.incoming) : '—'}</td>
                <td>{r.toOrder ? <b className="neg">{num(r.toOrder)}</b> : (r.missing ? <span className="pos">הוזמן</span> : '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: 'var(--ink-soft)', fontSize: 12.5, marginTop: 10 }}>
        הזמנות פתוחות = הזמנות שעוד לא נקבע להן סטטוס טיפול. מלאי קיים יורד ברגע שנקבע להזמנה סטטוס טיפול (נקלט ובטיפול, בוצעה חריטה / אריזה, יצא למשלוח או הגיע ללקוח) או שהיא הושלמה באתר. חסר = הוזמן פחות מלאי קיים. להזמין = חסר פחות מה שכבר הוזמן מהספק ומחכה לאספקה (תעודה בסטטוס "בהמתנה לאספקה").
      </p>
    </div>
  )
}
