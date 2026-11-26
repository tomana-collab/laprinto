import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { useLiveReload } from '../lib/useLive'
import { useNav } from '../contexts/NavContext'
import { formatDateDots } from '../lib/format'
import { useSort, sortRows, SortTh } from '../lib/sort'
import { loadSimpleStock } from './SimpleStock'

// פחת: מוצר שנשבר / נפל / נפגם / אבד. כל רישום יורד מהמלאי (בכל המסכים, דרך product_stock ו"במלאי"),
// ושווי ההפסד נשמר לפי עלות המוצר כולל מע"מ ברגע הרישום. מחיקת רישום מחזירה את היחידות למלאי.
const REASONS = ['נשבר', 'נפל', 'פגום מהספק', 'אבד', 'שימוש עצמי / מתנה']
const ils = n => `₪${(Math.round(n * 100) / 100).toLocaleString('he-IL')}`

// kind: 'פחת' (הפסד לפי עלות) או 'נלקח בעלות' (לקחנו מהמלאי ושילמנו מחיר עלות: יורד מהמלאי ונספר כהכנסה ברווח)
export const TAKEN = 'נלקח בעלות'
const TAKEN_REASONS = ['לשימוש אישי', 'מתנה', 'לעסק']
export const TAKERS = ['אמיר', 'רועי', 'נטלי', 'לינוי', 'שונות']

export default function Writeoffs({ onCount, kind = 'פחת' }) {
  const taken = kind === TAKEN
  const { user } = useAuth()
  const { openRecord } = useNav()
  const [rows, setRows] = useState(null)
  const [stock, setStock] = useState([]) // מה שיש במלאי (חישוב "במלאי"), לבחירת מוצר
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(null)
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState('')
  const [takenBy, setTakenBy] = useState('') // נלקח בעלות: מי לקח
  const [price, setPrice] = useState('') // נלקח בעלות: כמה שולם ליחידה (ברירת מחדל: העלות)
  const [busy, setBusy] = useState(false)
  const [sort, onSort] = useSort({ key: 'date', dir: 'desc' })

  async function load() {
    const [w, st] = await Promise.all([
      supabase.from('stock_writeoffs').select('*, products(name, sku)').eq('kind', kind).order('created_at', { ascending: false }),
      loadSimpleStock().catch(() => []),
    ])
    if (w.error) { setError(w.error.message); setRows([]); return }
    setRows(w.data); setStock(st)
  }
  useEffect(() => { load() }, [])
  useLiveReload(load, ['stock_writeoffs', 'stock_receipts', 'stock_receipt_items', 'orders'])
  useEffect(() => { if (rows) onCount?.(rows.reduce((a, r) => a + Number(r.quantity), 0)) }, [rows])

  const inStock = useMemo(() => stock.filter(s => s.stock > 0), [stock])
  const needle = q.trim().toLowerCase()
  const matches = needle ? inStock.filter(s => s.name.toLowerCase().includes(needle) || s.sku.toLowerCase().includes(needle)).slice(0, 8) : []

  async function add() {
    setError('')
    const n = Number(qty)
    if (!picked) { setError('בחר מוצר'); return }
    if (!(n > 0)) { setError('כמות חייבת להיות גדולה מ-0'); return }
    if (n > picked.stock) { setError(`במלאי יש רק ${picked.stock} יחידות של המוצר הזה`); return }
    if (!taken && !reason.trim()) { setError('כתוב סיבה'); return }
    if (taken && !takenBy) { setError('בחר מי לקח'); return }
    if (taken && price !== '' && !(Number(price) >= 0)) { setError('המחיר ששולם לא תקין'); return }
    setBusy(true)
    // עלות ליחידה ברגע הרישום (כולל מע"מ, אחרי הנחת ספק), כדי ששווי ההפסד לא ישתנה אם המחיר יתעדכן אחר כך
    const { data: p } = await supabase.from('products').select('cost_with_vat').eq('id', picked.product_id).maybeSingle()
    const { error: e } = await supabase.from('stock_writeoffs').insert({
      product_id: picked.product_id, quantity: n, reason: reason.trim(), kind,
      unit_cost: Number(p?.cost_with_vat) || 0, created_by: user?.email || '',
      ...(taken ? { taken_by: takenBy, unit_price: price !== '' ? Number(price) : (Number(p?.cost_with_vat) || 0) } : {}),
    })
    setBusy(false)
    if (e) { setError(e.message); return }
    setOpen(false); setPicked(null); setQ(''); setQty(1); setReason(''); setPrice(''); setTakenBy('')
    load()
  }
  async function remove(r) {
    if (!window.confirm(`למחוק את הרישום של "${r.products?.name}"? ${r.quantity} יח׳ יחזרו למלאי.`)) return
    const { error: e } = await supabase.from('stock_writeoffs').delete().eq('id', r.id)
    if (e) { setError(e.message); return }
    load()
  }

  if (rows === null) return <div className="loading">טוען...</div>
  const paidOf = r => Number(r.quantity) * (r.unit_price != null ? Number(r.unit_price) : Number(r.unit_cost))
  const valueOf = r => taken ? paidOf(r) : Number(r.quantity) * Number(r.unit_cost)
  const total = rows.reduce((a, r) => a + valueOf(r), 0)
  const units = rows.reduce((a, r) => a + Number(r.quantity), 0)
  const sorted = sortRows(rows, {
    date: r => r.created_at, name: r => r.products?.name || '', qty: r => Number(r.quantity),
    reason: r => r.reason, value: valueOf, who: r => r.taken_by || '',
  }, sort)

  return (
    <>
      {error && <div className="err-inline">{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="cmp-sub">
          {taken
            ? <>מוצרים שלקחנו מהמלאי ושילמנו עליהם מחיר עלות. כל רישום יורד מהמלאי, והתשלום נספר כהכנסה ברווח בדשבורד. {units} יח׳ · שולם: <b className={total ? 'pos' : ''}>{ils(total)}</b></>
            : <>מוצר שנשבר, נפל, נפגם או אבד. כל רישום יורד מהמלאי ומהשווי בכל המערכת. {units} יח׳ בפחת · הפסד לפי עלות (כולל מע״מ): <b className={total ? 'neg' : ''}>{ils(total)}</b></>}
        </div>
        {!open && <button className="btn-add" onClick={() => setOpen(true)}>{taken ? '➕ הוסף מוצר שנלקח' : '➕ הוסף לפחת'}</button>}
      </div>

      {taken && rows.length > 0 && (
        <div className="debt-suppliers">
          <span className="cmp-sub">לפי מי לקח:</span>
          {TAKERS.concat(rows.some(r => !r.taken_by) ? ['לא צוין'] : []).map(who => {
            const list = rows.filter(r => (r.taken_by || 'לא צוין') === who)
            if (!list.length) return null
            return <span key={who} className="taker-chip">{who} · {list.reduce((a, r) => a + Number(r.quantity), 0)} יח׳ <b>{ils(list.reduce((a, r) => a + paidOf(r), 0))}</b></span>
          })}
        </div>
      )}

      {open && (
        <div className="free-add">
          <b>{taken ? 'מוצר שנלקח מהמלאי בתשלום עלות' : 'הוספה לפחת'}</b>
          {picked ? (
            <div className="free-picked">
              <span>{picked.name}{picked.sku ? ` · ${picked.sku}` : ''} <span className="cmp-sub">(במלאי: {picked.stock})</span></span>
              <button type="button" className="link-btn" onClick={() => setPicked(null)}>החלף</button>
            </div>
          ) : (
            <>
              <input autoFocus placeholder="חפש מוצר שבמלאי לפי שם או מק״ט" value={q} onChange={e => setQ(e.target.value)} />
              {matches.map(m => (
                <button key={m.sku || m.product_id} type="button" className="free-option" onClick={() => { setPicked(m); setPrice(m.cost ? String(m.cost) : '') }}>
                  {m.name} <span className="cmp-sub">{m.sku} · במלאי {m.stock}</span>
                </button>
              ))}
              {needle && matches.length === 0 && <div className="cmp-sub">לא נמצא מוצר במלאי</div>}
            </>
          )}
          {taken && <div className="free-field">מי לקח
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TAKERS.map(x => <button key={x} type="button" className={`cmp-tool ${takenBy === x ? 'ready-on' : ''}`} onClick={() => setTakenBy(x)}>{x}</button>)}
            </div>
          </div>}
          <div className="free-field">{taken ? 'הערה (לא חובה)' : 'סיבה'}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(taken ? TAKEN_REASONS : REASONS).map(x => <button key={x} type="button" className={`cmp-tool ${reason === x ? 'ready-on' : ''}`} onClick={() => setReason(x)}>{x}</button>)}
            </div>
            <input value={reason} placeholder={taken ? 'או כתוב הערה' : 'או כתוב סיבה אחרת'} onChange={e => setReason(e.target.value)} />
          </div>
          <div className="free-row">
            <label>כמות <input type="number" min="1" style={{ width: 80 }} value={qty} onChange={e => setQty(e.target.value)} /></label>
            {taken && <label title="ברירת מחדל: עלות המוצר כולל מע״מ">שולם ליחידה (₪, כולל מע״מ) <input type="number" min="0" step="0.01" style={{ width: 100 }} value={price} placeholder="עלות" onChange={e => setPrice(e.target.value)} /></label>}
            <button type="button" className="btn-add" disabled={busy} onClick={add}>{busy ? 'שומר…' : taken ? 'הוסף' : 'הוסף לפחת'}</button>
            <button type="button" className="cmp-tool" onClick={() => { setOpen(false); setPicked(null); setQ(''); setError('') }}>ביטול</button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <SortTh k="date" sort={sort} onSort={onSort}>תאריך</SortTh>
            <SortTh k="name" sort={sort} onSort={onSort}>מוצר</SortTh>
            <SortTh k="qty" sort={sort} onSort={onSort}>כמות</SortTh>
            {taken && <SortTh k="who" sort={sort} onSort={onSort}>מי לקח</SortTh>}
            <SortTh k="reason" sort={sort} onSort={onSort}>{taken ? 'הערה' : 'סיבה'}</SortTh>
            <th title="עלות ליחידה כולל מע״מ, אחרי הנחת ספק, ברגע הרישום">עלות ליחידה</th>
            {taken && <th>שולם ליחידה</th>}
            <SortTh k="value" sort={sort} onSort={onSort}>{taken ? 'שולם (הכנסה)' : 'הפסד'}</SortTh>
            <th>נרשם ע״י</th>
            <th></th>
          </tr></thead>
          <tbody>
            {sorted.length === 0 && <tr><td className="empty-col" colSpan={taken ? 10 : 8}>{taken ? 'אין מוצרים שנלקחו' : 'אין פחת'}</td></tr>}
            {sorted.map(r => (
              <tr key={r.id} style={{ cursor: 'default' }}>
                <td>{formatDateDots(r.created_at)}</td>
                <td><a href="#" onClick={e => { e.preventDefault(); openRecord('products', r.product_id) }}>{r.products?.name || '—'}</a>{r.products?.sku && <div className="cmp-sub">{r.products.sku}</div>}</td>
                <td>{Number(r.quantity)}</td>
                {taken && <td><b>{r.taken_by || '—'}</b></td>}
                <td>{r.reason || '—'}</td>
                <td>{Number(r.unit_cost) ? ils(Number(r.unit_cost)) : <span title="לא הוזנה עלות למוצר">—</span>}</td>
                {taken && <td>{ils(r.unit_price != null ? Number(r.unit_price) : Number(r.unit_cost))}</td>}
                {taken
                  ? <td className="pos">+{ils(paidOf(r))}</td>
                  : <td className="neg">{Number(r.unit_cost) ? `−${ils(Number(r.quantity) * Number(r.unit_cost))}` : '—'}</td>}
                <td className="cmp-sub">{r.created_by || '—'}</td>
                <td><button type="button" className="cmp-tool" title="מחיקת הרישום: היחידות חוזרות למלאי" onClick={() => remove(r)}>🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
