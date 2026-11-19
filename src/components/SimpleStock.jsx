import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useLiveReload } from '../lib/useLive'
import { useNav } from '../contexts/NavContext'

// חלון "במלאי" — חישוב פשוט לפי מק"ט, בלי תלות בשום נוסחה אחרת:
//   נקלט  = סכום הכמויות בתעודות קליטה שסופקו, לפי המק"ט של המוצר בתעודה
//   נמכר  = סכום הכמויות בהזמנות (בטיפול / הושלמה / ידנית) עם אותו מק"ט, בלי מוצרים שסומנו "לא לספק"
//   במלאי = נקלט − נמכר. מוצגים רק מק"טים שנשאר מהם במלאי (בלי מינוסים)
const norm = s => String(s || '').trim().toUpperCase()

export async function loadSimpleStock() {
  const [ri, or] = await Promise.all([
    supabase.from('stock_receipt_items').select('quantity, product_id, products(name, sku), stock_receipts(status)'),
    supabase.from('orders').select('sku, quantity, wc_status, not_supplied'),
  ])
  if (ri.error) throw ri.error
  if (or.error) throw or.error
  const map = new Map() // sku → { sku, name, product_id, received, sold }
  for (const i of ri.data || []) {
    if ((i.stock_receipts?.status || 'סופק') !== 'סופק') continue
    const k = norm(i.products?.sku)
    if (!k) continue
    const e = map.get(k) || { sku: i.products.sku, name: i.products.name, product_id: i.product_id, received: 0, sold: 0 }
    e.received += Number(i.quantity) || 0
    map.set(k, e)
  }
  for (const o of or.data || []) {
    if (o.not_supplied) continue
    if (o.wc_status && !['processing', 'completed'].includes(o.wc_status)) continue
    const e = map.get(norm(o.sku))
    if (e) e.sold += Number(o.quantity) || 0
  }
  return [...map.values()].map(e => ({ ...e, stock: e.received - e.sold }))
}

export default function SimpleStock({ q = '', onCount }) {
  const { openRecord } = useNav()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  async function load() {
    try { setRows(await loadSimpleStock()); setError('') } catch (e) { setError(e.message); setRows([]) }
  }
  useEffect(() => { load() }, [])
  useLiveReload(load, ['stock_receipts', 'stock_receipt_items', 'orders'])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (rows || [])
      .filter(r => r.stock > 0)
      .filter(r => !t || r.name.toLowerCase().includes(t) || r.sku.toLowerCase().includes(t))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'))
  }, [rows, q])
  useEffect(() => { onCount?.(shown.length, shown.reduce((a, r) => a + r.stock, 0)) }, [shown])

  if (rows === null) return <div className="loading">טוען מלאי...</div>
  return (
    <>
      {error && <div className="err-inline">{error}</div>}
      <div className="cmp-sub" style={{ marginBottom: 8 }}>
        לפי מק"ט: מה שנקלט בתעודות פחות מה שנמכר בהזמנות. {shown.length} מוצרים, {shown.reduce((a, r) => a + r.stock, 0)} יחידות.
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>מוצר</th><th>מק״ט</th><th>נקלט בתעודות</th><th>נמכר</th><th>במלאי</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td className="empty-col" colSpan={5}>אין מוצרים במלאי</td></tr>}
            {shown.map(r => (
              <tr key={r.sku} style={{ cursor: 'default' }}>
                <td><a href="#" onClick={e => { e.preventDefault(); openRecord('products', r.product_id) }}>{r.name}</a></td>
                <td>{r.sku}</td>
                <td>{r.received}</td>
                <td>{r.sold}</td>
                <td><b>{r.stock}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
