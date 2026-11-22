import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useLiveReload } from '../lib/useLive'
import { useNav } from '../contexts/NavContext'
import { inCategory } from '../lib/category'
import { useSort, sortRows, SortTh } from '../lib/sort'

// חלון "במלאי" — חישוב פשוט לפי מק"ט, בלי תלות בשום נוסחה אחרת:
//   נקלט  = סכום הכמויות בתעודות קליטה שסופקו, לפי המק"ט של המוצר בתעודה
//   נמכר  = סכום הכמויות בהזמנות (בטיפול / הושלמה / ידנית) עם אותו מק"ט, בלי מוצרים שסומנו "לא לספק"
//   תיקון ספירה = מה שנשמר בספירת מלאי (products.opening_stock), כדי שהמלאי יתאים למה שספרת במחסן
//   פחת = מה שנרשם כפחת (נשבר / נפל / אבד), לפי המק"ט של המוצר
//   במלאי = נקלט − נמכר − פחת + תיקון ספירה. מוצגים רק מק"טים שנשאר מהם במלאי (בלי מינוסים)
//   שווי במכירה = מחיר המוצר באתר × במלאי (כולל מע"מ). שווי בקנייה = עלות המוצר כולל מע"מ (אחרי הנחת ספק) × במלאי
const norm = s => String(s || '').trim().toUpperCase()

export async function loadSimpleStock() {
  const [ri, or, op, wo] = await Promise.all([
    supabase.from('stock_receipt_items').select('quantity, product_id, products(name, sku, category, subcategory, wc_categories, price, cost_with_vat), stock_receipts(status)'),
    supabase.from('orders').select('sku, product_id, quantity, wc_status, not_supplied'),
    supabase.from('products').select('id, name, sku, category, subcategory, wc_categories, price, cost_with_vat, opening_stock').neq('opening_stock', 0),
    supabase.from('stock_writeoffs').select('quantity, product_id, products(sku)'),
  ])
  if (wo.error) throw wo.error
  if (ri.error) throw ri.error
  if (or.error) throw or.error
  if (op.error) throw op.error
  const map = new Map() // sku → { sku, name, product_id, received, sold, adjust }
  for (const i of ri.data || []) {
    if ((i.stock_receipts?.status || 'סופק') !== 'סופק') continue
    const k = norm(i.products?.sku)
    if (!k) continue
    const e = map.get(k) || { sku: i.products.sku, name: i.products.name, category: i.products.category, subcategory: i.products.subcategory, wc_categories: i.products.wc_categories, price: Number(i.products.price) || 0, cost: Number(i.products.cost_with_vat) || 0, product_id: i.product_id, received: 0, sold: 0, adjust: 0 }
    e.received += Number(i.quantity) || 0
    map.set(k, e)
  }
  // תיקון מספירת מלאי — גם למוצר שאף פעם לא נקלט בתעודה (למשל סחורה שהייתה לפני התעודות)
  for (const p of op.data || []) {
    const k = norm(p.sku) || 'ID:' + p.id
    const e = map.get(k) || { sku: p.sku || '', name: p.name, category: p.category, subcategory: p.subcategory, wc_categories: p.wc_categories, price: Number(p.price) || 0, cost: Number(p.cost_with_vat) || 0, product_id: p.id, received: 0, sold: 0, adjust: 0 }
    e.adjust += Number(p.opening_stock) || 0
    map.set(k, e)
  }
  for (const o of or.data || []) {
    if (o.not_supplied) continue
    if (o.wc_status && !['processing', 'completed'].includes(o.wc_status)) continue
    // מוצר בלי מק"ט: לפי המוצר עצמו
    const e = map.get(norm(o.sku) || 'ID:' + o.product_id)
    if (e) e.sold += Number(o.quantity) || 0
  }
  for (const w of wo.data || []) {
    const e = map.get(norm(w.products?.sku) || 'ID:' + w.product_id)
    if (e) e.writeoff = (e.writeoff || 0) + (Number(w.quantity) || 0)
  }
  const r2 = n => Math.round(n * 100) / 100
  return [...map.values()].map(e => {
    const stock = e.received - e.sold - (e.writeoff || 0) + e.adjust
    return { ...e, stock, saleValue: r2(stock * e.price), costValue: r2(stock * e.cost) }
  })
}

export default function SimpleStock({ q = '', category = '', onCount }) {
  const { openRecord } = useNav()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  // מיון בלחיצה על כותרת: לחיצה ראשונה מהגדול לקטן, שנייה מהקטן לגדול, שלישית חוזרת לסדר לפי שם
  const [sort, onSort] = useSort({ key: 'stock', dir: 'desc' })
  async function load() {
    try { setRows(await loadSimpleStock()); setError('') } catch (e) { setError(e.message); setRows([]) }
  }
  useEffect(() => { load() }, [])
  useLiveReload(load, ['stock_receipts', 'stock_receipt_items', 'orders', 'products'])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (rows || [])
      .filter(r => r.stock > 0)
      .filter(r => inCategory(r, category))
      .filter(r => !t || r.name.toLowerCase().includes(t) || r.sku.toLowerCase().includes(t))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'))
  }, [rows, q, category])
  const sorted = sortRows(shown, { name: r => r.name, stock: r => r.stock, sold: r => r.sold, received: r => r.received, adjust: r => r.adjust, writeoff: r => r.writeoff || 0, sku: r => r.sku, saleValue: r => r.saleValue, costValue: r => r.costValue }, sort)
  useEffect(() => { onCount?.(shown.length, shown.reduce((a, r) => a + r.stock, 0)) }, [shown])

  const hasAdjust = (rows || []).some(r => r.adjust)
  const hasWriteoff = (rows || []).some(r => r.writeoff)
  const ils = n => `₪${Math.round(n).toLocaleString('he-IL')}`
  const totalSale = shown.reduce((a, r) => a + r.saleValue, 0)
  const totalCost = shown.reduce((a, r) => a + r.costValue, 0)
  const units = shown.reduce((a, r) => a + r.stock, 0)
  if (rows === null) return <div className="loading">טוען מלאי...</div>
  return (
    <>
      {error && <div className="err-inline">{error}</div>}
      {/* סיכום לפי מה שמוצג (קטגוריה / חיפוש) */}
      <div className="summary-row">
        <div className="summary-card"><span>מוצרים</span><b>{shown.length}</b></div>
        <div className="summary-card"><span>יחידות במלאי</span><b>{units}</b></div>
        <div className="summary-card"><span>נמכרו</span><b>{shown.reduce((a, r) => a + r.sold, 0)}</b></div>
        <div className="summary-card"><span>נקלטו בתעודות</span><b>{shown.reduce((a, r) => a + r.received, 0)}</b></div>
        {hasWriteoff && <div className="summary-card"><span>פחת</span><b className="neg">{shown.reduce((a, r) => a + (r.writeoff || 0), 0)}</b></div>}
        <div className="summary-card"><span>שווי במכירה (כולל מע״מ)</span><b>{ils(totalSale)}</b></div>
        <div className="summary-card"><span>שווי בקנייה (כולל מע״מ)</span><b>{ils(totalCost)}</b></div>
      </div>
      <div className="cmp-sub" style={{ marginBottom: 8 }}>
        לפי מק"ט: מה שנקלט בתעודות פחות מה שנמכר בהזמנות{hasWriteoff ? ' ופחות פחת' : ''}{hasAdjust ? ', ועוד תיקון מספירת מלאי' : ''}.
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <SortTh k="name" sort={sort} onSort={onSort}>מוצר</SortTh>
            <SortTh k="stock" sort={sort} onSort={onSort}>במלאי</SortTh>
            <SortTh k="sold" sort={sort} onSort={onSort}>נמכר</SortTh>
            <SortTh k="received" sort={sort} onSort={onSort}>נקלט בתעודות</SortTh>
            <SortTh k="saleValue" sort={sort} onSort={onSort} title="מחיר המוצר באתר (כולל מע״מ) × יחידות במלאי">שווי במכירה</SortTh>
            <SortTh k="costValue" sort={sort} onSort={onSort} title="עלות המוצר כולל מע״מ, אחרי הנחת ספק × יחידות במלאי">שווי בקנייה</SortTh>
            {hasWriteoff && <SortTh k="writeoff" sort={sort} onSort={onSort} title="נשבר / נפל / אבד (חלון פחת)">פחת</SortTh>}
            {hasAdjust && <SortTh k="adjust" sort={sort} onSort={onSort} title="ההפרש שנשמר בספירת מלאי">תיקון ספירה</SortTh>}
            <SortTh k="sku" sort={sort} onSort={onSort}>מק״ט</SortTh>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td className="empty-col" colSpan={7 + (hasAdjust ? 1 : 0) + (hasWriteoff ? 1 : 0)}>אין מוצרים במלאי</td></tr>}
            {sorted.map(r => (
              <tr key={r.sku} style={{ cursor: 'default' }}>
                <td><a href="#" onClick={e => { e.preventDefault(); openRecord('products', r.product_id) }}>{r.name}</a></td>
                <td><b>{r.stock}</b></td>
                <td>{r.sold}</td>
                <td>{r.received}</td>
                <td>{r.price ? ils(r.saleValue) : '—'}</td>
                <td>{r.cost ? ils(r.costValue) : <span title="לא הוזנה עלות למוצר">—</span>}</td>
                {hasWriteoff && <td>{r.writeoff ? <span className="neg">−{r.writeoff}</span> : '—'}</td>}
                {hasAdjust && <td>{r.adjust ? (r.adjust > 0 ? `+${r.adjust}` : r.adjust) : '—'}</td>}
                <td>{r.sku}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
