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
const LOGO_URL = 'https://laprinto.co.il/wp-content/uploads/2026/08/logolaprinto.png'
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// הזמנה לספק כ-PDF: נפתח חלון הדפסה מעוצב (עברית RTL, לוגו, שם ספק, טבלה) ושם בוחרים "שמירה כ-PDF".
// לכל ספק עמוד נפרד. כמות רצויה = כמה להזמין מהספק (חסר פחות מה שכבר הוזמן ומחכה לאספקה).
function exportOrderPdf(rows) {
  const bySupplier = new Map()
  for (const r of rows.filter(r => r.toOrder > 0)) {
    const k = r.supplier || 'ללא ספק'
    bySupplier.set(k, [...(bySupplier.get(k) || []), r])
  }
  if (!bySupplier.size) return false
  const date = new Date().toLocaleDateString('he-IL')
  const pages = [...bySupplier.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he')).map(([name, items]) => `
    <section>
      <header><img src="${LOGO_URL}" alt="Laprinto" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'Laprinto'}))"><div class="meta">הזמנת סחורה<br>${esc(date)}</div></header>
      <h1>${esc(name)}</h1>
      <table>
        <thead><tr><th class="n">#</th><th>מוצר</th><th>מק״ט</th><th class="q">כמות רצויה</th></tr></thead>
        <tbody>${items.sort((a, b) => a.name.localeCompare(b.name, 'he')).map((r, i) => `<tr><td class="n">${i + 1}</td><td>${esc(r.name)}</td><td dir="ltr" class="sku">${esc(r.sku || '—')}</td><td class="q">${esc(r.toOrder)}</td></tr>`).join('')}</tbody>
      </table>
    </section>`).join('')
  const w = window.open('', '_blank')
  if (!w) return 'blocked'
  w.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>הזמנת סחורה</title><style>
    @page { size: A4; margin: 16mm }
    body { font-family: Arial, 'Segoe UI', sans-serif; color: #1c1c28; margin: 0 }
    section { page-break-after: always } section:last-child { page-break-after: auto }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1c1c28; padding-bottom: 10px }
    header img { height: 56px } .meta { text-align: left; font-size: 13px; color: #555 }
    h1 { font-size: 24px; margin: 18px 0 14px }
    table { width: 100%; border-collapse: collapse; font-size: 14px }
    th, td { border: 1px solid #bbb; padding: 7px 10px; text-align: right } th { background: #f0f0f4 }
    .n { width: 36px; text-align: center } .q { width: 110px; text-align: center; font-weight: 700 } .sku { text-align: left }
    tr { page-break-inside: avoid }
  </style></head><body>${pages}</body></html>`)
  w.document.close()
  // מחכים לטעינת הלוגו לפני ההדפסה
  const go = () => { w.focus(); w.print() }
  const imgs = [...w.document.images]
  Promise.all(imgs.map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r }))).then(() => setTimeout(go, 200))
  return true
}

export default function Restock() {
  const { openRecord } = useNav()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState('')
  const [supplier, setSupplier] = useState('')
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
      (!supplier || (r.supplier || 'ללא ספק') === supplier) &&
      (!needle || r.name.toLowerCase().includes(needle) || (r.sku || '').toLowerCase().includes(needle)))
  }, [rows, showAll, q, supplier])

  if (rows === null) return <div className="loading">טוען...</div>

  const suppliers = [...new Set(rows.map(r => r.supplier || 'ללא ספק'))].sort((a, b) => a.localeCompare(b, 'he'))
  const exportRows = shown.filter(r => r.toOrder > 0)
  function doExport() {
    const res = exportOrderPdf(exportRows)
    if (res === false) alert('אין מה להזמין: אין חוסרים שעדיין לא הוזמנו מהספק בסינון הנוכחי.')
    else if (res === 'blocked') alert('הדפדפן חסם את החלון. אפשר חלונות קופצים לאתר ונסה שוב.')
  }

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
        <select value={supplier} onChange={e => setSupplier(e.target.value)}>
          <option value="">כל הספקים</option>
          {suppliers.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> הצג גם מוצרים שיש להם מספיק במלאי
        </label>
        <button className="btn-add" onClick={doExport} disabled={exportRows.length === 0} title="פותח הזמנה להדפסה / שמירה כ-PDF">
          📄 ייצוא הזמנה ל-PDF{supplier ? ` (${supplier})` : ''} · {exportRows.length}
        </button>
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
