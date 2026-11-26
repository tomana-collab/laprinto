import { useEffect, useState } from 'react'
import ExportButtons from '../components/ExportButtons'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { formatDate, formatDateDots } from '../lib/format'
import { VAT_RATE } from '../lib/pricing'
import { useSort, sortRows, SortTh } from '../lib/sort'

const today = () => new Date().toISOString().slice(0, 10)
const label = p => `${p.sku ? p.sku + ' · ' : ''}${p.name}`
const grossCost = i => (Number(i.unit_cost) || 0)
const r4 = n => Math.round(n * 10000) / 10000
// אחוז הנחה שהתקבל ממחיר מקורי ומחיר שהתקבל
const discountFrom = (orig, recv) => (Number(orig) > 0 && recv !== '' && Number.isFinite(Number(recv))) ? r4(Math.max(0, (1 - Number(recv) / Number(orig)) * 100)) : ''
const pct = (g, n) => g > 0 ? `${Math.round((1 - n / g) * 1000) / 10}%` : '—'
const netCost = i => (Number(i.unit_cost) || 0) * (1 - (Number(i.discount_percent) || 0) / 100)
const withVat = n => n * (1 + VAT_RATE)
const PAY = ['לא שולם', 'שולם חלקית', 'שולם']
// מי שילם לספק
const PAYERS = ['רועי שילם', 'אמיר שילם', 'לפרינטו שילמה']
const payClass = st => st === 'שולם' ? 'pay-paid' : st === 'שולם חלקית' ? 'pay-partial' : st === 'לא שולם' ? 'pay-unpaid' : 'pay-none'
const money = n => '₪' + (Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })

// קליטת תעודות ספק: כל תעודה מוסיפה כמות למלאי של המוצרים שבה.
export default function Receipts() {
  const { user } = useAuth()
  const [receipts, setReceipts] = useState(null)
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [error, setError] = useState('')
  const [sort, onSort] = useSort()
  const [q, setQ] = useState('')
  const [view, setView] = useState('receipts') // receipts | lines
  const [payFilter, setPayFilter] = useState('all') // all | open | paid | none
  const [editing, setEditing] = useState(null) // {} חדשה | תעודה קיימת (צפייה/מחיקה)

  async function load() {
    setError('')
    const [r, p, s] = await Promise.all([
      supabase.from('stock_receipts')
        .select('*, suppliers(name), stock_receipt_items(id, product_id, quantity, unit_cost, discount_percent, products(name, sku))')
        .order('doc_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('products').select('id, name, sku, cost, supplier_discount_percent, wc_product_id, wc_parent_id').order('name'),
      supabase.from('suppliers').select('id, name').order('name'),
    ])
    const err = [r, p, s].find(x => x.error)
    if (err) { setError(err.error.message); setReceipts([]); return }
    setReceipts(r.data); const parents = new Set(p.data.map(x => x.wc_parent_id).filter(Boolean)); setProducts(p.data.filter(pr => !parents.has(pr.wc_product_id))); setSuppliers(s.data)
  }
  useEffect(() => { load() }, [])

  async function handleSave({ supplier_id, doc_number, doc_date, notes, status, payment_status, paid_amount, paid_at, paid_by, items, updateCost = true }) {
    // לא מדלגים בשקט על שורות בעייתיות — עוצרים ומראים איזו שורה לא תקינה
    const filled = items.map((i, n) => ({ ...i, n: n + 1 })).filter(i => i.text || i.product_id || Number(i.quantity) > 0)
    const bad = filled.find(i => !i.product_id)
    if (bad) { setError(`שורה ${bad.n}: המוצר "${bad.text}" לא נמצא. בחר מוצר מהרשימה שנפתחת (לפי מק"ט או שם).`); return }
    const noQty = filled.find(i => !(Number(i.quantity) > 0))
    if (noQty) { setError(`שורה ${noQty.n}: חסרה כמות.`); return }
    const clean = filled
    if (clean.length === 0) { setError('הוסף לפחות מוצר אחד עם כמות'); return }
    const fields = { supplier_id: supplier_id || null, doc_number, doc_date, notes, status,
      payment_status: payment_status || null, paid_by: paid_by || null,
      paid_amount: payment_status === 'שולם חלקית' && paid_amount !== '' ? Number(paid_amount) : null,
      paid_at: payment_status && payment_status !== 'לא שולם' ? (paid_at || today()) : null }
    const rows = id => clean.map(i => ({ receipt_id: id, product_id: i.product_id, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost) || 0, discount_percent: Number(i.discount_percent) || 0 }))

    if (editing?.id) {
      // עריכה: מוסיפים את השורות החדשות ורק אחר כך מוחקים את הישנות, כדי לא לאבד נתונים אם ההוספה נכשלת
      const oldIds = editing.stock_receipt_items.map(i => i.id)
      const { error: e0 } = await supabase.from('stock_receipts').update(fields).eq('id', editing.id)
      if (e0) { setError(e0.message); return }
      const { error: e2 } = await supabase.from('stock_receipt_items').insert(rows(editing.id))
      if (e2) { setError(e2.message); return }
      if (oldIds.length) {
        const { error: e3 } = await supabase.from('stock_receipt_items').delete().in('id', oldIds)
        if (e3) { setError(e3.message); return }
      }
    } else {
      const { data, error: e1 } = await supabase.from('stock_receipts')
        .insert({ ...fields, created_by: user?.email || '' }).select('id').single()
      if (e1) { setError(e1.message); return }
      const { error: e2 } = await supabase.from('stock_receipt_items').insert(rows(data.id))
      if (e2) {
        await supabase.from('stock_receipts').delete().eq('id', data.id)
        setError(e2.message); return
      }
    }
    // תעודה שסופקה מעדכנת את מחיר הקנייה של המוצר (עלות ליחידה לפני מע"מ + הנחת ספק) — רק אם זו התעודה האחרונה של המוצר,
    // כדי שעריכת תעודה ישנה לא תדרוס מחיר עדכני יותר. העלות במוצר משמשת לחישוב הרווח בהזמנות ובמוצרים
    // updateCost=false: המחיר נשמר רק בתעודה הזו, בלי לשנות את מחיר הקנייה במוצר
    if (status === 'סופק' && updateCost) {
      const newerExists = pid => receipts.some(r => r.id !== editing?.id && (r.status || 'סופק') === 'סופק'
        && String(r.doc_date || '') > String(doc_date || '') && r.stock_receipt_items.some(i => i.product_id === pid))
      const updates = clean.filter(i => Number(i.unit_cost) > 0 && !newerExists(i.product_id)).map(i => {
        const p = products.find(x => x.id === i.product_id)
        const cost = Number(i.unit_cost), disc = Number(i.discount_percent) || 0
        if (p && Number(p.cost) === cost && (Number(p.supplier_discount_percent) || 0) === disc) return null
        return supabase.from('products').update({ cost, supplier_discount_percent: disc }).eq('id', i.product_id)
      }).filter(Boolean)
      const res = await Promise.all(updates)
      const failed = res.find(x => x.error)
      if (failed) { setError('התעודה נשמרה, אבל עדכון מחיר הקנייה במוצרים נכשל: ' + failed.error.message); setEditing(null); load(); return }
    }
    setError(''); setEditing(null); load()
  }

  // סימון מהיר של מצב תשלום מתוך הטבלה. "שולם חלקית" פותח את החלון כדי להזין כמה שולם
  async function setPayment(r, value) {
    if (value === 'שולם חלקית') { setEditing({ ...r, payment_status: value }); return }
    const patch = { payment_status: value || null, paid_amount: null, paid_at: value === 'שולם' ? (r.paid_at || today()) : null }
    setReceipts(list => list.map(x => x.id === r.id ? { ...x, ...patch } : x))
    const { error: e } = await supabase.from('stock_receipts').update(patch).eq('id', r.id)
    if (e) { setError(e.message); load() }
  }

  // מי שילם: בחירה בתעודה שעוד לא סומנה כשולמה מסמנת אותה "שולם" (תשלום חלקי נשאר חלקי)
  async function setPayer(r, value) {
    const patch = { paid_by: value || null }
    if (value && (!r.payment_status || r.payment_status === 'לא שולם')) Object.assign(patch, { payment_status: 'שולם', paid_amount: null, paid_at: r.paid_at || today() })
    setReceipts(list => list.map(x => x.id === r.id ? { ...x, ...patch } : x))
    const { error: e } = await supabase.from('stock_receipts').update(patch).eq('id', r.id)
    if (e) { setError(e.message); load() }
  }

  async function handleDelete(id) {
    if (!window.confirm('למחוק את התעודה? הכמויות שלה יורדו מהמלאי.')) return
    const { error: e } = await supabase.from('stock_receipts').delete().eq('id', id)
    if (e) { setError(e.message); return }
    setEditing(null); load()
  }

  if (receipts === null) return <div className="loading">טוען תעודות...</div>

  const total = r => r.stock_receipt_items.reduce((a, i) => a + i.quantity * netCost(i), 0)
  const units = r => r.stock_receipt_items.reduce((a, i) => a + Number(i.quantity), 0)
  // תשלום לספק: לפי הסכום כולל מע״מ (כמו בחשבונית)
  const gross = r => withVat(total(r))
  const owed = r => r.payment_status === 'לא שולם' ? gross(r)
    : r.payment_status === 'שולם חלקית' ? Math.max(0, gross(r) - (Number(r.paid_amount) || 0)) : 0
  const paidOf = r => r.payment_status === 'שולם' ? gross(r) : r.payment_status === 'שולם חלקית' ? Math.min(gross(r), Number(r.paid_amount) || 0) : 0
  const openRecs = receipts.filter(r => owed(r) > 0)
  const debt = openRecs.reduce((a, r) => a + owed(r), 0)
  const paidTotal = receipts.reduce((a, r) => a + paidOf(r), 0)
  const unmarked = receipts.filter(r => !r.payment_status)
  // כמה שילם כל אחד (כולל מע״מ; בתשלום חלקי — הסכום ששולם)
  const paidBy = who => receipts.filter(r => (r.paid_by || '') === who).reduce((a, r) => a + paidOf(r), 0)
  const paidNoPayer = paidBy('')
  const bySupplier = Object.entries(openRecs.reduce((m, r) => {
    const k = r.suppliers?.name || 'ללא ספק'; m[k] = (m[k] || 0) + owed(r); return m
  }, {})).sort((a, b) => b[1] - a[1])
  const payHit = r => payFilter === 'all' ? true : payFilter === 'open' ? owed(r) > 0
    : payFilter === 'paid' ? r.payment_status === 'שולם' : !r.payment_status
  const needle = q.trim().toLowerCase()
  const itemHit = i => needle && `${i.products?.sku || ''} ${i.products?.name || ''}`.toLowerCase().includes(needle)
  const shown = receipts.filter(payHit).filter(r => !needle ||
    r.stock_receipt_items.some(itemHit) ||
    `${r.doc_number || ''} ${r.suppliers?.name || ''}`.toLowerCase().includes(needle))
  const sorted = sortRows(shown, {
    date: r => r.doc_date || '', doc: r => r.doc_number || '', supplier: r => r.suppliers?.name || '',
    status: r => r.status || 'סופק', pay: r => owed(r) || -paidOf(r), payer: r => r.paid_by || '', items: r => r.stock_receipt_items.length, units,
    total, totalVat: r => withVat(total(r)),
  }, sort)

  return (
    <div>
      <div className="module-head">
        <h2>📥 קליטת תעודות</h2>
        <button className="btn-add" onClick={() => setEditing({})}>+ תעודה חדשה</button>
      </div>
      {error && <div className="err-inline">{error}</div>}

      <div className="summary-row wide">
        <div className="summary-card"><span>עוד פתוח, לא שולם (כולל מע״מ) · {openRecs.length} תעודות</span><b className={debt > 0 ? 'neg' : 'pos'}>{money(debt)}</b></div>
        {PAYERS.map(p => <div key={p} className="summary-card"><span>{p} (כולל מע״מ)</span><b className="pos">{money(paidBy(p))}</b></div>)}
        {paidNoPayer > 0 && <div className="summary-card"><span>שולם בלי לציין מי שילם</span><b>{money(paidNoPayer)}</b></div>}
        <div className="summary-card"><span>תעודות שלא סומן להן תשלום{unmarked.length ? ` · ${money(unmarked.reduce((a, r) => a + gross(r), 0))}` : ''}</span><b>{unmarked.length}</b></div>
      </div>
      <div className="cmp-sub" style={{ margin: '-6px 0 12px' }}>סה״כ שולם לספקים: <b>{money(paidTotal)}</b></div>
      {bySupplier.length > 0 && (
        <div className="debt-suppliers">
          <span className="cmp-sub">חוב לפי ספק:</span>
          {bySupplier.map(([name, v]) => <span key={name} className="debt-chip">{name} <b>{money(v)}</b></span>)}
        </div>
      )}

      <div className="status-filter">
        {[['all', 'הכל', receipts.length], ['open', 'לא שולם / חלקית', openRecs.length], ['paid', 'שולם', receipts.filter(r => r.payment_status === 'שולם').length], ['none', 'לא סומן', unmarked.length]].map(([k, l, n]) => (
          <button key={k} className={payFilter === k ? 'active' : ''} onClick={() => setPayFilter(k)}>{l} <span style={{ opacity: 0.6 }}>({n})</span></button>
        ))}
      </div>
      <input type="search" value={q} onChange={e => setQ(e.target.value)}
        placeholder="🔍 חיפוש לפי מק״ט, שם מוצר, מס׳ תעודה או ספק"
        style={{ width: '100%', maxWidth: 420, margin: '0 0 12px', padding: '8px 12px' }} />
      <div style={{ display: 'flex', gap: 8, margin: '0 0 12px' }}>
        <button type="button" className={`btn-soft${view === 'receipts' ? ' sel' : ''}`} onClick={() => setView('receipts')}>לפי תעודה</button>
        <button type="button" className={`btn-soft${view === 'lines' ? ' sel' : ''}`} onClick={() => setView('lines')}>לפי מוצר (כל שורה)</button>
        <span style={{ marginInlineStart: 'auto' }}><ExportButtons name="kliyat-teudot" title="קליטת תעודות" getData={() => {
          const r2 = n => Math.round(n * 100) / 100
          const rows = sorted.flatMap(r => r.stock_receipt_items
            .filter(i => !needle || itemHit(i) || !r.stock_receipt_items.some(itemHit))
            .map(i => {
              const g = grossCost(i), n = netCost(i), line = i.quantity * n
              return [formatDateDots(r.doc_date), r.doc_number || '', r.suppliers?.name || '', r.status || 'סופק', r.payment_status || 'לא סומן', r.paid_by || '', i.products?.sku || '', i.products?.name || '',
                Number(i.quantity), r2(g), g > 0 ? r4((1 - n / g) * 100) : '', r2(n), r2(line), r2(withVat(line))]
            }))
          return { headers: ['תאריך', 'מס׳ תעודה', 'ספק', 'סטטוס', 'תשלום', 'מי שילם', 'מק״ט', 'מוצר', 'כמות', 'מחיר מקורי', 'אחוז הנחה', 'מחיר שהתקבל', 'סה״כ שורה לפני מע״מ', 'סה״כ שורה כולל מע״מ'], rows }
        }} /></span>
      </div>

      {view === 'lines' && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>תאריך</th><th>תעודה</th><th>ספק</th><th>מק״ט</th><th>מוצר</th><th>כמות</th><th>מחיר מקורי</th><th>מחיר שהתקבל</th><th>אחוז הנחה שהתקבל</th><th>סה״כ שורה</th></tr></thead>
            <tbody>
              {sorted.flatMap(r => r.stock_receipt_items
                .filter(i => !needle || itemHit(i) || !r.stock_receipt_items.some(itemHit))
                .map(i => (
                  <tr key={i.id} onClick={() => setEditing(r)}>
                    <td>{formatDate(r.doc_date)}</td>
                    <td>{r.doc_number || '—'}</td>
                    <td>{r.suppliers?.name || '—'}</td>
                    <td>{i.products?.sku || '—'}</td>
                    <td>{i.products?.name || '—'}</td>
                    <td>{Number(i.quantity)}</td>
                    <td>{grossCost(i) > 0 ? money(grossCost(i)) : '—'}</td>
                    <td>{money(netCost(i))}</td>
                    <td className="pos"><b>{grossCost(i) > 0 ? pct(grossCost(i), netCost(i)) : '—'}</b></td>
                    <td>{money(i.quantity * netCost(i))}</td>
                  </tr>
                )))}
              {sorted.length === 0 && <tr><td className="empty-col" colSpan={10}>{needle ? 'לא נמצאו תעודות מתאימות' : 'אין תעודות עדיין'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === 'receipts' && <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <SortTh k="date" sort={sort} onSort={onSort}>תאריך</SortTh>
              <SortTh k="doc" sort={sort} onSort={onSort}>מס׳ תעודה</SortTh>
              <SortTh k="supplier" sort={sort} onSort={onSort}>ספק</SortTh>
              <SortTh k="status" sort={sort} onSort={onSort}>סטטוס</SortTh>
              <SortTh k="pay" sort={sort} onSort={onSort}>תשלום</SortTh>
              <SortTh k="payer" sort={sort} onSort={onSort}>מי שילם</SortTh>
              <SortTh k="items" sort={sort} onSort={onSort}>פריטים</SortTh>
              <SortTh k="units" sort={sort} onSort={onSort}>יחידות</SortTh>
              <SortTh k="total" sort={sort} onSort={onSort}>סה״כ (לפני מע״מ)</SortTh>
              <SortTh k="totalVat" sort={sort} onSort={onSort}>סה״כ כולל מע״מ</SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.length > 0 && (
              <tr className="totals-row">
                <td colSpan={6}>סה״כ ({sorted.length} תעודות)</td>
                <td>{sorted.reduce((a, r) => a + r.stock_receipt_items.length, 0)}</td>
                <td>{sorted.reduce((a, r) => a + units(r), 0)}</td>
                <td>{money(sorted.reduce((a, r) => a + total(r), 0))}</td>
                <td>{money(sorted.reduce((a, r) => a + withVat(total(r)), 0))}</td>
              </tr>
            )}
            {sorted.length === 0 && <tr><td className="empty-col" colSpan={10}>{needle || payFilter !== 'all' ? 'לא נמצאו תעודות מתאימות' : 'אין תעודות עדיין'}</td></tr>}
            {sorted.map(r => [
              <tr key={r.id} onClick={() => setEditing(r)}>
                <td>{formatDate(r.doc_date)}</td>
                <td>{r.doc_number || '—'}</td>
                <td>{r.suppliers?.name || '—'}</td>
                <td><span className={r.status === 'בהמתנה לאספקה' ? 'neg' : 'pos'}>{r.status || 'סופק'}</span></td>
                <td onClick={e => e.stopPropagation()}>
                  <select className={`pay-select ${payClass(r.payment_status)}`} value={r.payment_status || ''} onChange={e => setPayment(r, e.target.value)}>
                    <option value="">לא סומן</option>
                    {PAY.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {r.payment_status === 'שולם חלקית' && <div className="cmp-sub">נותר {money(owed(r))}</div>}
                </td>
                <td onClick={e => e.stopPropagation()}>
                  <select className="pay-select" value={r.paid_by || ''} onChange={e => setPayer(r, e.target.value)}>
                    <option value="">—</option>
                    {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td>{r.stock_receipt_items.length}</td>
                <td>{r.stock_receipt_items.reduce((a, i) => a + Number(i.quantity), 0)}</td>
                <td>{money(total(r))}</td>
                <td><b>{money(withVat(total(r)))}</b></td>
              </tr>,
              needle && r.stock_receipt_items.some(itemHit) && (
                <tr key={r.id + '-hit'} onClick={() => setEditing(r)} style={{ background: 'var(--bg-soft, #f7f7fb)' }}>
                  <td colSpan={10}>
                    {r.stock_receipt_items.filter(itemHit).map(i => (
                      <div key={i.id}>↳ <b>{i.products?.sku || '—'}</b> {i.products?.name} — הוזמן/נקלט: <b>{Number(i.quantity)}</b>
                        {grossCost(i) > 0 && <> · מחיר מקורי {money(grossCost(i))} ← שהתקבל {money(netCost(i))} · <b className="pos">הנחה {pct(grossCost(i), netCost(i))}</b></>}</div>
                    ))}
                  </td>
                </tr>
              ),
            ])}
          </tbody>
        </table>
      </div>}

      {editing && (
        <ReceiptModal
          initial={editing} products={products} suppliers={suppliers} error={error} receipts={receipts}
          onCancel={() => setEditing(null)} onSave={handleSave}
          onDelete={editing.id ? () => handleDelete(editing.id) : null}
        />
      )}
    </div>
  )
}

function ReceiptModal({ initial, products, suppliers, error, onCancel, onSave, onDelete, receipts = [] }) {
  const [updateCost, setUpdateCost] = useState(true)
  // המחיר הזול ביותר (לפני מע״מ, אחרי הנחה) שבו המוצר התקבל בתעודות אחרות — להערה אדומה אם בתעודה הזו יקר יותר
  const cheapest = new Map()
  for (const r of receipts) {
    if (r.id === initial.id) continue
    for (const i of r.stock_receipt_items || []) {
      const n = netCost(i)
      if (!(n > 0)) continue
      const c = cheapest.get(i.product_id)
      if (!c || n < c.price) cheapest.set(i.product_id, { price: n, doc: r.doc_number, date: r.doc_date, supplier: r.suppliers?.name })
    }
  }
  const cheaperElsewhere = it => {
    const c = it.product_id && cheapest.get(it.product_id)
    return c && netCost(it) > 0 && netCost(it) - c.price > 0.005 ? c : null
  }
  const [supplierId, setSupplierId] = useState(initial.supplier_id || '')
  const [docNumber, setDocNumber] = useState(initial.doc_number || '')
  const [docDate, setDocDate] = useState(initial.doc_date || today())
  const [notes, setNotes] = useState(initial.notes || '')
  const [status, setStatus] = useState(initial.status || 'סופק')
  const [payStatus, setPayStatus] = useState(initial.id ? (initial.payment_status || '') : 'לא שולם')
  const [paidAmount, setPaidAmount] = useState(initial.paid_amount ?? '')
  const [paidAt, setPaidAt] = useState(initial.paid_at || '')
  const [paidBy, setPaidBy] = useState(initial.paid_by || '')
  const [items, setItems] = useState(() => initial.id && initial.stock_receipt_items.length
    ? initial.stock_receipt_items.map(i => {
        const p = products.find(x => x.id === i.product_id)
        return { text: p ? label(p) : (i.products?.name || ''), hidden: !p, product_id: i.product_id, quantity: i.quantity, unit_cost: i.unit_cost ?? '', discount_percent: i.discount_percent || '' }
      })
    : [{ text: '', product_id: '', quantity: 1, unit_cost: '', discount_percent: '' }])

  const byLabel = new Map(products.map(p => [label(p), p]))
  const setItem = (idx, patch) => setItems(list => list.map((it, i) => i === idx ? { ...it, ...patch } : it))

  function pick(idx, text) {
    const p = byLabel.get(text)
    setItem(idx, { text, hidden: false, product_id: p?.id || '', ...(p && !items[idx].unit_cost ? { unit_cost: p.cost || '', discount_percent: p.supplier_discount_percent || '' } : {}) })
  }

  const total = items.reduce((a, i) => a + (Number(i.quantity) || 0) * netCost(i), 0)
  const grossTotal = items.reduce((a, i) => a + (Number(i.quantity) || 0) * grossCost(i), 0)

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal wide" style={{ maxWidth: 900 }}>
        <h2>{initial.id ? `עריכת תעודה ${initial.doc_number || ''}` : 'תעודה חדשה'}</h2>
        <div className="fields-grid cols-4">
          <div className="field"><label>ספק</label>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field"><label>מס׳ תעודה</label><input type="text" value={docNumber} onChange={e => setDocNumber(e.target.value)} /></div>
          <div className="field"><label>תאריך</label><input type="date" value={docDate} onChange={e => setDocDate(e.target.value)} /></div>
          <div className="field"><label>סטטוס אספקה</label>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="סופק">סופק (נכנס למלאי)</option>
              <option value="בהמתנה לאספקה">בהמתנה לאספקה (הוזמן, עדיין לא הגיע)</option>
            </select>
          </div>
          <div className="field"><label>תשלום לספק</label>
            <select value={payStatus} onChange={e => setPayStatus(e.target.value)}>
              <option value="">לא סומן</option>
              {PAY.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {payStatus && payStatus !== 'לא שולם' && <div className="field"><label>מי שילם</label>
            <select value={paidBy} onChange={e => setPaidBy(e.target.value)}>
              <option value="">—</option>
              {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>}
          {payStatus === 'שולם חלקית' && <div className="field"><label>כמה שולם (₪, כולל מע״מ)</label><input type="number" min="0" step="0.01" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} /></div>}
          {payStatus && payStatus !== 'לא שולם' && <div className="field"><label>תאריך תשלום</label><input type="date" value={paidAt || today()} onChange={e => setPaidAt(e.target.value)} /></div>}
          <div className="field"><label>הערות</label><input type="text" value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>

        <datalist id="receipt-products">{products.map(p => <option key={p.id} value={label(p)} />)}</datalist>
        <table className="data-table">
          <thead><tr><th style={{ width: '55%' }}>מוצר (מק״ט / שם)</th><th>כמות</th><th>מחיר מקורי (לפני מע״מ)</th><th>הנחה %</th><th>מחיר שהתקבל</th><th>סה״כ שורה</th><th>שורה כולל מע״מ</th><th>אחוז הנחה שהתקבל</th><th /></tr></thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} style={{ cursor: 'default' }}>
                <td>
                  <input type="text" list="receipt-products" value={it.text} placeholder="הקלד מק״ט או שם"
                    onChange={e => pick(idx, e.target.value)} style={{ width: '100%' }} />
                  {it.text && !it.product_id && <small className="neg">לא נמצא מוצר — בחר מהרשימה</small>}
                  {cheaperElsewhere(it) && (() => { const c = cheaperElsewhere(it); return (
                    <div className="cheaper-note">⚠ קיבלת כבר את המוצר הזה ביותר זול: {money(c.price)} לפני מע״מ{c.doc ? ` בתעודה ${c.doc}` : ''}{c.date ? ` (${formatDate(c.date)})` : ''}{c.supplier ? ` · ${c.supplier}` : ''} · כאן {money(netCost(it))}, יקר ב-{money(netCost(it) - c.price)}</div>
                  ) })()}
                  {it.hidden && <small className="neg">מוצר ראשי שפוצל לוריאציות — לא נספר במלאי. בחר את הוריאציה (לפי מק״ט).</small>}
                </td>
                <td><input type="number" min="0" value={it.quantity} onChange={e => setItem(idx, { quantity: e.target.value })} style={{ width: 80 }} /></td>
                <td><input type="number" min="0" step="0.01" value={it.unit_cost} onChange={e => setItem(idx, { unit_cost: e.target.value, ...(it.recv !== undefined ? { discount_percent: discountFrom(e.target.value, it.recv) } : {}) })} style={{ width: 110 }} /></td>
                <td><input type="number" min="0" max="100" step="0.1" value={it.discount_percent} onChange={e => setItem(idx, { discount_percent: e.target.value, recv: undefined })} style={{ width: 80 }} /></td>
                <td><input type="number" min="0" step="0.01" style={{ width: 100 }} title="מחיר שהתקבל בפועל — אחוז ההנחה מחושב לבד"
                  value={it.recv !== undefined ? it.recv : (grossCost(it) > 0 ? Math.round(netCost(it) * 100) / 100 : '')}
                  onChange={e => setItem(idx, { recv: e.target.value, discount_percent: discountFrom(it.unit_cost, e.target.value) })} /></td>
                <td>{money((Number(it.quantity) || 0) * netCost(it))}</td>
                <td><b>{money(withVat((Number(it.quantity) || 0) * netCost(it)))}</b></td>
                <td className="pos"><b>{grossCost(it) > 0 ? pct(grossCost(it), netCost(it)) : '—'}</b></td>
                <td><button type="button" className="btn-ghost" style={{ border: 'none', borderRadius: 8, padding: '4px 10px' }}
                  onClick={() => setItems(l => l.length > 1 ? l.filter((_, i) => i !== idx) : l)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn-add" style={{ marginTop: 10 }}
          onClick={() => setItems(l => [...l, { text: '', product_id: '', quantity: 1, unit_cost: '', discount_percent: '' }])}>+ שורה</button>

        <div className="summary-row" style={{ marginTop: 14 }}>
          <div className="summary-card"><span>אחוז הנחה ממוצע על התעודה (משוקלל)</span><b className="pos">{pct(grossTotal, total)}</b></div>
          <div className="summary-card"><span>סה״כ לפני מע״מ</span><b>{money(total)}</b></div>
          <div className="summary-card"><span>מע״מ {Math.round(VAT_RATE * 100)}%</span><b>{money(withVat(total) - total)}</b></div>
          <div className="summary-card"><span>סה״כ כולל מע״מ (להשוואה לחשבונית)</span><b>{money(withVat(total))}</b></div>
          {payStatus === 'שולם חלקית' && <div className="summary-card"><span>נותר לתשלום</span><b className="neg">{money(Math.max(0, withVat(total) - (Number(paidAmount) || 0)))}</b></div>}
        </div>
        {status === 'סופק' && (
          <label className="cmp-check" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={updateCost} onChange={e => setUpdateCost(e.target.checked)} />
            לעדכן את מחיר הקנייה במוצרים לפי התעודה הזו {updateCost ? '' : <span className="cmp-sub">(כבוי: המחיר נשמר רק בתעודה הזו, מחיר הקנייה במוצר לא משתנה)</span>}
          </label>
        )}
        {error && <div className="err-inline" style={{ marginTop: 12 }}>{error}</div>}
        <div className="modal-actions">
          {onDelete && <button className="btn btn-danger" onClick={onDelete}>מחיקת תעודה</button>}
          <button className="btn btn-ghost" onClick={onCancel}>ביטול</button>
          <button className="btn btn-primary" onClick={() => onSave({ supplier_id: supplierId, doc_number: docNumber, doc_date: docDate, notes, status, payment_status: payStatus, paid_amount: paidAmount, paid_at: paidAt, paid_by: payStatus && payStatus !== 'לא שולם' ? paidBy : '', items, updateCost })}>{initial.id ? 'שמירת שינויים' : status === 'סופק' ? 'קליטה למלאי' : 'שמירת הזמנה'}</button>
        </div>
      </div>
    </div>
  )
}
