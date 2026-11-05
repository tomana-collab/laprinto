import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/format'

const today = () => new Date().toISOString().slice(0, 10)
const label = p => `${p.sku ? p.sku + ' · ' : ''}${p.name}`
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
        .select('*, suppliers(name), stock_receipt_items(id, product_id, quantity, unit_cost, products(name, sku))')
        .order('doc_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('products').select('id, name, sku, cost').order('name'),
      supabase.from('suppliers').select('id, name').order('name'),
    ])
    const err = [r, p, s].find(x => x.error)
    if (err) { setError(err.error.message); setReceipts([]); return }
    setReceipts(r.data); setProducts(p.data); setSuppliers(s.data)
  }
  useEffect(() => { load() }, [])

  async function handleSave({ supplier_id, doc_number, doc_date, notes, items }) {
    const clean = items.filter(i => i.product_id && Number(i.quantity) > 0)
    if (clean.length === 0) { setError('הוסף לפחות מוצר אחד עם כמות'); return }
    const { data, error: e1 } = await supabase.from('stock_receipts')
      .insert({ supplier_id: supplier_id || null, doc_number, doc_date, notes, created_by: user?.email || '' })
      .select('id').single()
    if (e1) { setError(e1.message); return }
    const { error: e2 } = await supabase.from('stock_receipt_items').insert(
      clean.map(i => ({ receipt_id: data.id, product_id: i.product_id, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost) || 0 }))
    )
    if (e2) {
      await supabase.from('stock_receipts').delete().eq('id', data.id)
      setError(e2.message); return
    }
    setEditing(null); load()
  }

  async function handleDelete(id) {
    if (!window.confirm('למחוק את התעודה? הכמויות שלה יורדו מהמלאי.')) return
    const { error: e } = await supabase.from('stock_receipts').delete().eq('id', id)
    if (e) { setError(e.message); return }
    setEditing(null); load()
  }

  if (receipts === null) return <div className="loading">טוען תעודות...</div>

  const total = r => r.stock_receipt_items.reduce((a, i) => a + i.quantity * (i.unit_cost || 0), 0)

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
            <tr><th>תאריך</th><th>מס׳ תעודה</th><th>ספק</th><th>פריטים</th><th>יחידות</th><th>סה״כ (לפני מע״מ)</th></tr>
          </thead>
          <tbody>
            {receipts.length === 0 && <tr><td className="empty-col" colSpan={6}>אין תעודות עדיין</td></tr>}
            {receipts.map(r => (
              <tr key={r.id} onClick={() => setEditing(r)}>
                <td>{formatDate(r.doc_date)}</td>
                <td>{r.doc_number || '—'}</td>
                <td>{r.suppliers?.name || '—'}</td>
                <td>{r.stock_receipt_items.length}</td>
                <td>{r.stock_receipt_items.reduce((a, i) => a + Number(i.quantity), 0)}</td>
                <td>{money(total(r))}</td>
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
  const readOnly = !!initial.id
  const [supplierId, setSupplierId] = useState(initial.supplier_id || '')
  const [docNumber, setDocNumber] = useState(initial.doc_number || '')
  const [docDate, setDocDate] = useState(initial.doc_date || today())
  const [notes, setNotes] = useState(initial.notes || '')
  const [items, setItems] = useState([{ text: '', product_id: '', quantity: 1, unit_cost: '' }])

  const byLabel = new Map(products.map(p => [label(p), p]))
  const setItem = (idx, patch) => setItems(list => list.map((it, i) => i === idx ? { ...it, ...patch } : it))

  function pick(idx, text) {
    const p = byLabel.get(text)
    setItem(idx, { text, product_id: p?.id || '', ...(p && !items[idx].unit_cost ? { unit_cost: p.cost || '' } : {}) })
  }

  if (readOnly) {
    return (
      <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
        <div className="modal">
          <h2>תעודה {initial.doc_number || ''} · {formatDate(initial.doc_date)}</h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>ספק: {initial.suppliers?.name || '—'}{initial.notes ? ` · ${initial.notes}` : ''}</p>
          <table className="data-table">
            <thead><tr><th>מק״ט</th><th>מוצר</th><th>כמות</th><th>עלות ליחידה</th></tr></thead>
            <tbody>
              {initial.stock_receipt_items.map(i => (
                <tr key={i.id} style={{ cursor: 'default' }}>
                  <td>{i.products?.sku || '—'}</td><td>{i.products?.name}</td><td>{i.quantity}</td><td>{money(i.unit_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="modal-actions">
            <button className="btn btn-danger" onClick={onDelete}>מחיקת תעודה</button>
            <button className="btn btn-ghost" onClick={onCancel}>סגירה</button>
          </div>
        </div>
      </div>
    )
  }

  const total = items.reduce((a, i) => a + (Number(i.quantity) || 0) * (Number(i.unit_cost) || 0), 0)

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal wide" style={{ maxWidth: 900 }}>
        <h2>תעודה חדשה</h2>
        <div className="fields-grid cols-4">
          <div className="field"><label>ספק</label>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field"><label>מס׳ תעודה</label><input type="text" value={docNumber} onChange={e => setDocNumber(e.target.value)} /></div>
          <div className="field"><label>תאריך</label><input type="date" value={docDate} onChange={e => setDocDate(e.target.value)} /></div>
          <div className="field"><label>הערות</label><input type="text" value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>

        <datalist id="receipt-products">{products.map(p => <option key={p.id} value={label(p)} />)}</datalist>
        <table className="data-table">
          <thead><tr><th style={{ width: '55%' }}>מוצר (מק״ט / שם)</th><th>כמות</th><th>עלות ליחידה (לפני מע״מ)</th><th /></tr></thead>
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
                <td><button type="button" className="btn-ghost" style={{ border: 'none', borderRadius: 8, padding: '4px 10px' }}
                  onClick={() => setItems(l => l.length > 1 ? l.filter((_, i) => i !== idx) : l)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn-add" style={{ marginTop: 10 }}
          onClick={() => setItems(l => [...l, { text: '', product_id: '', quantity: 1, unit_cost: '' }])}>+ שורה</button>

        <p style={{ marginTop: 14 }}>סה״כ תעודה: <b>{money(total)}</b> (לפני מע״מ)</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>ביטול</button>
          <button className="btn btn-primary" onClick={() => onSave({ supplier_id: supplierId, doc_number: docNumber, doc_date: docDate, notes, items })}>קליטה למלאי</button>
        </div>
      </div>
    </div>
  )
}
