import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/format'
import { VAT_RATE } from '../lib/pricing'

const today = () => new Date().toISOString().slice(0, 10)
const label = p => `${p.sku ? p.sku + ' · ' : ''}${p.name}`
const netCost = i => (Number(i.unit_cost) || 0) * (1 - (Number(i.discount_percent) || 0) / 100)
const withVat = n => n * (1 + VAT_RATE)
const money = n => '₪' + (Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })

// קליטת תעודות ספק: כל תעודה מוסיפה כמות למלאי של המוצרים שבה.
export default function Receipts() {
  const { user } = useAuth()
  const [receipts, setReceipts] = useState(null)
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // {} חדשה | תעודה קיימת (צפייה/מחיקה)

  async function load() {
    setError('')
    const [r, p, s] = await Promise.all([
      supabase.from('stock_receipts')
        .select('*, suppliers(name), stock_receipt_items(id, product_id, quantity, unit_cost, discount_percent, products(name, sku))')
        .order('doc_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('products').select('id, name, sku, cost, supplier_discount_percent').order('name'),
      supabase.from('suppliers').select('id, name').order('name'),
    ])
    const err = [r, p, s].find(x => x.error)
    if (err) { setError(err.error.message); setReceipts([]); return }
    setReceipts(r.data); setProducts(p.data); setSuppliers(s.data)
  }
  useEffect(() => { load() }, [])

  async function handleSave({ supplier_id, doc_number, doc_date, notes, status, items }) {
    const clean = items.filter(i => i.product_id && Number(i.quantity) > 0)
    if (clean.length === 0) { setError('הוסף לפחות מוצר אחד עם כמות'); return }
    const fields = { supplier_id: supplier_id || null, doc_number, doc_date, notes, status }
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
    setError(''); setEditing(null); load()
  }

  async function handleDelete(id) {
    if (!window.confirm('למחוק את התעודה? הכמויות שלה יורדו מהמלאי.')) return
    const { error: e } = await supabase.from('stock_receipts').delete().eq('id', id)
    if (e) { setError(e.message); return }
    setEditing(null); load()
  }

  if (receipts === null) return <div className="loading">טוען תעודות...</div>

  const total = r => r.stock_receipt_items.reduce((a, i) => a + i.quantity * netCost(i), 0)

  return (
    <div>
      <div className="module-head">
        <h2>📥 קליטת תעודות</h2>
        <button className="btn-add" onClick={() => setEditing({})}>+ תעודה חדשה</button>
      </div>
      {error && <div className="err-inline">{error}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>תאריך</th><th>מס׳ תעודה</th><th>ספק</th><th>סטטוס</th><th>פריטים</th><th>יחידות</th><th>סה״כ (לפני מע״מ)</th><th>סה״כ כולל מע״מ</th></tr>
          </thead>
          <tbody>
            {receipts.length === 0 && <tr><td className="empty-col" colSpan={8}>אין תעודות עדיין</td></tr>}
            {receipts.map(r => (
              <tr key={r.id} onClick={() => setEditing(r)}>
                <td>{formatDate(r.doc_date)}</td>
                <td>{r.doc_number || '—'}</td>
                <td>{r.suppliers?.name || '—'}</td>
                <td><span className={r.status === 'בהמתנה לאספקה' ? 'neg' : 'pos'}>{r.status || 'סופק'}</span></td>
                <td>{r.stock_receipt_items.length}</td>
                <td>{r.stock_receipt_items.reduce((a, i) => a + Number(i.quantity), 0)}</td>
                <td>{money(total(r))}</td>
                <td><b>{money(withVat(total(r)))}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ReceiptModal
          initial={editing} products={products} suppliers={suppliers}
          onCancel={() => setEditing(null)} onSave={handleSave}
          onDelete={editing.id ? () => handleDelete(editing.id) : null}
        />
      )}
    </div>
  )
}

function ReceiptModal({ initial, products, suppliers, onCancel, onSave, onDelete }) {
  const [supplierId, setSupplierId] = useState(initial.supplier_id || '')
  const [docNumber, setDocNumber] = useState(initial.doc_number || '')
  const [docDate, setDocDate] = useState(initial.doc_date || today())
  const [notes, setNotes] = useState(initial.notes || '')
  const [status, setStatus] = useState(initial.status || 'סופק')
  const [items, setItems] = useState(() => initial.id && initial.stock_receipt_items.length
    ? initial.stock_receipt_items.map(i => {
        const p = products.find(x => x.id === i.product_id)
        return { text: p ? label(p) : (i.products?.name || ''), product_id: i.product_id, quantity: i.quantity, unit_cost: i.unit_cost ?? '', discount_percent: i.discount_percent || '' }
      })
    : [{ text: '', product_id: '', quantity: 1, unit_cost: '', discount_percent: '' }])

  const byLabel = new Map(products.map(p => [label(p), p]))
  const setItem = (idx, patch) => setItems(list => list.map((it, i) => i === idx ? { ...it, ...patch } : it))

  function pick(idx, text) {
    const p = byLabel.get(text)
    setItem(idx, { text, product_id: p?.id || '', ...(p && !items[idx].unit_cost ? { unit_cost: p.cost || '', discount_percent: p.supplier_discount_percent || '' } : {}) })
  }

  const total = items.reduce((a, i) => a + (Number(i.quantity) || 0) * netCost(i), 0)

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
          <div className="field"><label>הערות</label><input type="text" value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>

        <datalist id="receipt-products">{products.map(p => <option key={p.id} value={label(p)} />)}</datalist>
        <table className="data-table">
          <thead><tr><th style={{ width: '55%' }}>מוצר (מק״ט / שם)</th><th>כמות</th><th>עלות ליחידה (לפני מע״מ)</th><th>הנחה %</th><th>אחרי הנחה</th><th>סה״כ שורה</th><th>שורה כולל מע״מ</th><th /></tr></thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} style={{ cursor: 'default' }}>
                <td>
                  <input type="text" list="receipt-products" value={it.text} placeholder="הקלד מק״ט או שם"
                    onChange={e => pick(idx, e.target.value)} style={{ width: '100%' }} />
                  {it.text && !it.product_id && <small className="neg">לא נמצא מוצר — בחר מהרשימה</small>}
                </td>
                <td><input type="number" min="0" value={it.quantity} onChange={e => setItem(idx, { quantity: e.target.value })} style={{ width: 80 }} /></td>
                <td><input type="number" min="0" step="0.01" value={it.unit_cost} onChange={e => setItem(idx, { unit_cost: e.target.value })} style={{ width: 110 }} /></td>
                <td><input type="number" min="0" max="100" step="0.1" value={it.discount_percent} onChange={e => setItem(idx, { discount_percent: e.target.value })} style={{ width: 80 }} /></td>
                <td>{money(netCost(it))}</td>
                <td>{money((Number(it.quantity) || 0) * netCost(it))}</td>
                <td><b>{money(withVat((Number(it.quantity) || 0) * netCost(it)))}</b></td>
                <td><button type="button" className="btn-ghost" style={{ border: 'none', borderRadius: 8, padding: '4px 10px' }}
                  onClick={() => setItems(l => l.length > 1 ? l.filter((_, i) => i !== idx) : l)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn-add" style={{ marginTop: 10 }}
          onClick={() => setItems(l => [...l, { text: '', product_id: '', quantity: 1, unit_cost: '', discount_percent: '' }])}>+ שורה</button>

        <div className="summary-row" style={{ marginTop: 14 }}>
          <div className="summary-card"><span>סה״כ לפני מע״מ</span><b>{money(total)}</b></div>
          <div className="summary-card"><span>מע״מ {Math.round(VAT_RATE * 100)}%</span><b>{money(withVat(total) - total)}</b></div>
          <div className="summary-card"><span>סה״כ כולל מע״מ (להשוואה לחשבונית)</span><b>{money(withVat(total))}</b></div>
        </div>
        <div className="modal-actions">
          {onDelete && <button className="btn btn-danger" onClick={onDelete}>מחיקת תעודה</button>}
          <button className="btn btn-ghost" onClick={onCancel}>ביטול</button>
          <button className="btn btn-primary" onClick={() => onSave({ supplier_id: supplierId, doc_number: docNumber, doc_date: docDate, notes, status, items })}>{initial.id ? 'שמירת שינויים' : status === 'סופק' ? 'קליטה למלאי' : 'שמירת הזמנה'}</button>
        </div>
      </div>
    </div>
  )
}
