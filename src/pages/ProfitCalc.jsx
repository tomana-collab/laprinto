import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { calcProduct, VAT_RATE, CLEARING_RATE } from '../lib/pricing'

// מחשבון רווח: מחיר מכירה → כמה נשאר אחרי עלות הקנייה (כולל מע"מ, אחרי הנחת ספק), הוצאות נלוות ועמלת סליקה.
// בלי משלוח. אפשר לבחור מוצר (העלות נמשכת ממנו) או להזין עלות ידנית. אותה נוסחה כמו ברווחיות המוצרים (lib/pricing)
const r2 = n => Math.round(n * 100) / 100
const ils = n => `₪${r2(n).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

export default function ProfitCalc() {
  const [products, setProducts] = useState([])
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(null)
  const [price, setPrice] = useState('')
  const [coupon, setCoupon] = useState('')
  const [cost, setCost] = useState('')
  const [disc, setDisc] = useState('')
  const [extra, setExtra] = useState('')

  useEffect(() => {
    supabase.from('products').select('id, name, sku, cost, supplier_discount_percent, extra_expenses, price, wc_product_id, wc_parent_id')
      .eq('status', 'פעיל').order('name')
      .then(({ data }) => {
        const parents = new Set((data || []).map(p => p.wc_parent_id).filter(Boolean)) // מוצר ראשי של וריאציות — רק הוריאציות
        setProducts((data || []).filter(p => !parents.has(p.wc_product_id)))
      })
  }, [])

  const needle = q.trim().toLowerCase()
  const matches = needle ? products.filter(p => p.name.toLowerCase().includes(needle) || (p.sku || '').toLowerCase().includes(needle)).slice(0, 8) : []
  function pick(p) {
    setPicked(p); setQ('')
    setCost(p.cost ? String(p.cost) : '')
    setDisc(p.supplier_discount_percent ? String(p.supplier_discount_percent) : '')
    setExtra(p.extra_expenses ? String(p.extra_expenses) : '')
    setPrice(p.price ? String(p.price) : '')
  }
  function clear() { setPicked(null); setPrice(''); setCoupon(''); setCost(''); setDisc(''); setExtra('') }

  const sale = Number(price) || 0
  const couponAmt = r2(sale * (Number(coupon) || 0) / 100)
  const paid = r2(sale - couponAmt) // מה שהלקוח משלם בפועל (כולל מע"מ)
  const c = useMemo(() => calcProduct({ cost, supplier_discount_percent: disc, extra_expenses: extra, price: paid }), [cost, disc, extra, paid])
  // מחיר מינימלי בלי הפסד: המחיר שבו הרווח 0 (העמלה היא אחוז מהמחיר)
  const breakEven = r2((c.costWithVat + c.extra) / (1 - CLEARING_RATE * (1 + VAT_RATE)))
  const ready = sale > 0 && Number(cost) > 0

  const row = (label, value, cls, bold) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontWeight: bold ? 700 : 400, fontSize: bold ? 17 : undefined }}>
      <span>{label}</span><b className={cls}>{value}</b>
    </div>
  )
  const hr = <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '6px 0' }} />

  return (
    <div>
      <div className="module-head"><h2>🧮 מחשבון רווח</h2></div>
      <div className="cmp-sub" style={{ marginBottom: 14 }}>
        מכניסים מחיר מכירה ורואים כמה נשאר אחרי עלות הקנייה, הוצאות נלוות ועמלת סליקה. בלי משלוח. אפשר לבחור מוצר כדי למשוך את העלות שלו, או להזין ידנית.
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="summary-card" style={{ display: 'block', flex: '1 1 320px', maxWidth: 460 }}>
          <div className="field">
            <label>מוצר (לא חובה)</label>
            {picked ? (
              <div className="free-picked">
                <span>{picked.name}{picked.sku ? ` · ${picked.sku}` : ''}</span>
                <button type="button" className="link-btn" onClick={clear}>נקה</button>
              </div>
            ) : (
              <>
                <input placeholder="חפש מוצר לפי שם או מק״ט" value={q} onChange={e => setQ(e.target.value)} />
                {matches.map(p => (
                  <button key={p.id} type="button" className="free-option" onClick={() => pick(p)}>
                    {p.name} <span className="cmp-sub">{p.sku} · עלות {p.cost ? `₪${p.cost}` : '—'}</span>
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="field"><label>מחיר מכירה (₪, כולל מע״מ)</label><input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
          <div className="field"><label>הנחת קופון (%, לא חובה)</label><input type="number" min="0" max="100" step="0.1" value={coupon} onChange={e => setCoupon(e.target.value)} /></div>
          <div className="field"><label>עלות קנייה ליחידה (₪, לפני מע״מ)</label><input type="number" min="0" step="0.01" value={cost} onChange={e => setCost(e.target.value)} /></div>
          <div className="field"><label>הנחת ספק (%)</label><input type="number" min="0" max="100" step="0.1" value={disc} onChange={e => setDisc(e.target.value)} /></div>
          <div className="field"><label>הוצאות נלוות ליחידה (₪, אריזה וכו׳)</label><input type="number" min="0" step="0.01" value={extra} onChange={e => setExtra(e.target.value)} /></div>
        </div>

        <div className="summary-card" style={{ display: 'block', flex: '1 1 320px', maxWidth: 460 }}>
          {row('מחיר מכירה (כולל מע״מ)', ils(sale))}
          {couponAmt > 0 && row(`הנחת קופון (${Number(coupon)}%)`, `−${ils(couponAmt)}`, 'neg')}
          {couponAmt > 0 && row('הלקוח משלם', ils(paid))}
          {hr}
          {row('עלות קנייה אחרי הנחת ספק (לפני מע״מ)', `−${ils(c.costAfterDiscount)}`, 'neg')}
          {row('עלות קנייה כולל מע״מ 18%', `−${ils(c.costWithVat)}`, 'neg')}
          {c.extra > 0 && row('הוצאות נלוות', `−${ils(c.extra)}`, 'neg')}
          {row('עמלת סליקה (0.75% + מע״מ)', `−${ils(c.clearingFee)}`, 'neg')}
          {hr}
          {row('רווח (כולל מע״מ)', ready ? ils(c.profit) : '—', ready ? (c.profit >= 0 ? 'pos' : 'neg') : '', true)}
          {row('מרווח מהמחיר', ready ? `${c.margin}%` : '—', ready ? (c.profit >= 0 ? 'pos' : 'neg') : '')}
          {Number(cost) > 0 && row('מחיר מינימלי בלי הפסד', ils(breakEven))}
          {picked && picked.price > 0 && Number(price) !== Number(picked.price) && <div className="cmp-sub" style={{ marginTop: 6 }}>המחיר באתר היום: {ils(picked.price)}</div>}
        </div>
      </div>
    </div>
  )
}
