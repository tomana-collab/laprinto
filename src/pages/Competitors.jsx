import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useNav } from '../contexts/NavContext'
import { formatDateTime } from '../lib/format'

// השוואת מתחרים — תצוגה בלבד. הנתונים (חנויות, התאמות, בדיקות מחיר) נכתבים למסד
// מבחוץ; העמוד רק קורא את v_competitor_matrix + competitor_stores + competitor_price_checks.

const ils = n => n == null ? '—' : '₪' + Number(n).toLocaleString('he-IL', { maximumFractionDigits: 2 })
const pct = n => n == null ? '—' : Number(n).toLocaleString('he-IL', { maximumFractionDigits: 1 }) + '%'
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + ils(Math.abs(n))
const hasCost = p => Number(p.cost) > 0
const num = v => (v == null || v === '' ? null : Number(v))

const MATCH = {
  exact: { label: 'זהה', cls: 'm-exact' },
  variant: { label: 'וריאציה', cls: 'm-variant' },
  similar: { label: 'דומה', cls: 'm-similar' },
}
const matchInfo = t => MATCH[t] || { label: t || 'לא אומת', cls: 'm-similar' }

// פער מול המחיר שלי: שלילי = המתחרה זול ממני
function gap(offer, myPrice) {
  if (offer?.price == null || !(myPrice > 0)) return null
  const diff = offer.price - myPrice
  return { diff, pct: (diff / myPrice) * 100 }
}
const gapCls = (g, offer) => !g || offer.match_type === 'similar' ? 'c-none' : g.diff < 0 ? 'c-cheaper' : g.diff > 0 ? 'c-pricier' : 'c-equal'

export default function Competitors() {
  const [stores, setStores] = useState(null)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [f, setF] = useState({ q: '', cat: '', sub: '', store: '', pricier: false, noCost: false, exact: false, withOffers: false, sort: 'name' })
  const [open, setOpen] = useState(null)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))

  async function load() {
    setError('')
    const [m, s, p] = await Promise.all([
      supabase.from('v_competitor_matrix').select('*'),
      supabase.from('competitor_stores').select('id, name, domain, enabled, priority').order('priority'),
      supabase.from('products').select('id, cost, cost_with_vat, extra_expenses, price, profit, margin_percent, wc_product_id, wc_parent_id, supplier_url'),
    ])
    const err = [m, s, p].find(x => x.error)
    if (err) { setError(err.error.message); setRows([]); setStores([]); return }
    setStores(s.data.filter(x => x.enabled !== false))

    // מוצר ראשי שפוצל לוריאציות לא מוצג (כמו בעמוד המלאי) — הוריאציות מוצגות במקומו,
    // אלא אם קושרה אליו התאמת מתחרה
    const prodById = new Map(p.data.map(x => [x.id, x]))
    const parents = new Set(p.data.map(x => x.wc_parent_id).filter(Boolean))
    const byProduct = new Map()
    for (const r of m.data) {
      let row = byProduct.get(r.product_id)
      if (!row) {
        const pr = prodById.get(r.product_id) || {}
        row = {
          id: r.product_id, name: r.product_name, sku: r.sku, category: r.category || '', subcategory: r.subcategory || '',
          url: r.product_url, wc_product_id: r.wc_product_id ?? pr.wc_product_id,
          cost: num(pr.cost ?? r.supplier_cost), cost_with_vat: num(pr.cost_with_vat ?? r.cost_with_vat),
          extra_expenses: num(pr.extra_expenses), price: num(pr.price ?? r.my_price),
          profit: num(pr.profit ?? r.calculated_profit), margin: num(pr.margin_percent ?? r.calculated_margin_percent),
          offers: [],
        }
        byProduct.set(r.product_id, row)
      }
      if (r.offer_id) row.offers.push({
        offer_id: r.offer_id, store_id: r.store_id, store_name: r.store_name, price: num(r.competitor_price),
        shipping_price: num(r.shipping_price), url: r.competitor_url || r.source_url, sku: r.competitor_sku, title: r.competitor_title,
        match_type: r.match_type, confidence: num(r.match_confidence), availability: r.availability, checked_at: r.checked_at,
        note: r.observation_note, variant_notes: r.variant_notes, engraving_notes: r.engraving_notes,
        package_notes: r.package_notes, shipping_notes: r.shipping_notes,
      })
    }
    const list = [...byProduct.values()].filter(r => !parents.has(r.wc_product_id) || r.offers.length)
    for (const r of list) {
      const priced = r.offers.filter(o => o.price != null && o.match_type !== 'similar')
      r.lowest = priced.length ? priced.reduce((a, o) => (o.price < a.price ? o : a)) : null
      r.lowestGap = gap(r.lowest, r.price)
    }
    setRows(list)
    setLoadedAt(new Date())
  }
  useEffect(() => { load() }, [])
  // חזרה ללשונית = רענון, כדי שמחירים חדשים שנכתבו למסד יופיעו בלי לרענן ידנית
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const cats = useMemo(() => [...new Set((rows || []).map(r => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')), [rows])
  const subs = useMemo(() => [...new Set((rows || []).filter(r => !f.cat || r.category === f.cat).map(r => r.subcategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')), [rows, f.cat])

  const shownStores = useMemo(() => (stores || []).filter(s => !f.store || s.id === f.store), [stores, f.store])

  const shown = useMemo(() => {
    const t = f.q.trim().toLowerCase()
    const list = (rows || []).filter(r => {
      if (f.cat && r.category !== f.cat) return false
      if (f.sub && r.subcategory !== f.sub) return false
      if (t && !r.name?.toLowerCase().includes(t) && !(r.sku || '').toLowerCase().includes(t)) return false
      const offers = r.offers.filter(o => (!f.store || o.store_id === f.store) && (!f.exact || o.match_type === 'exact'))
      if ((f.store || f.exact || f.withOffers) && !offers.length) return false
      if (f.pricier && !offers.some(o => gap(o, r.price)?.diff < 0 && o.match_type !== 'similar')) return false
      if (f.noCost && hasCost(r)) return false
      return true
    })
    const by = {
      // מוצרים עם השוואה קודם, ואז לפי שם
      name: (a, b) => (b.offers.length > 0) - (a.offers.length > 0) || (a.name || '').localeCompare(b.name || '', 'he'),
      price_desc: (a, b) => (b.price || 0) - (a.price || 0),
      price_asc: (a, b) => (a.price || 0) - (b.price || 0),
      // הכי "בסכנה" קודם: המתחרה הכי זול ממני באחוזים; מוצרים בלי השוואה בסוף
      gap: (a, b) => (a.lowestGap?.pct ?? Infinity) - (b.lowestGap?.pct ?? Infinity),
      gap_desc: (a, b) => (b.lowestGap?.pct ?? -Infinity) - (a.lowestGap?.pct ?? -Infinity),
      margin_asc: (a, b) => (hasCost(a) ? a.margin : Infinity) - (hasCost(b) ? b.margin : Infinity),
      margin_desc: (a, b) => (hasCost(b) ? b.margin : -Infinity) - (hasCost(a) ? a.margin : -Infinity),
    }[f.sort]
    return [...list].sort(by)
  }, [rows, f])

  if (rows === null) return <div className="loading">טוען השוואת מתחרים...</div>

  const compared = rows.filter(r => r.offers.some(o => o.price != null))
  const cheaper = rows.filter(r => r.lowestGap && r.lowestGap.diff < 0)
  const iAmCheapest = rows.filter(r => r.lowestGap && r.lowestGap.diff > 0)
  const missingCost = rows.filter(r => !hasCost(r))
  const activeStores = new Set(rows.flatMap(r => r.offers.map(o => o.store_id)))
  const anyFilter = f.q || f.cat || f.sub || f.store || f.pricier || f.noCost || f.exact || f.withOffers

  return (
    <div className="cmp-page">
      <div className="module-head">
        <h2>🔎 השוואת מתחרים</h2>
        <div className="cmp-head-meta">
          {loadedAt && <span>עודכן בתצוגה {loadedAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>}
          <button className="btn-add" onClick={load}>רענון</button>
        </div>
      </div>
      {error && <div className="err-inline">{error}</div>}

      <div className="cmp-kpis">
        <Kpi label="מוצרים בקטלוג" value={rows.length} />
        <Kpi label="עם השוואת מתחרים" value={compared.length} sub={rows.length ? pct(compared.length / rows.length * 100) + ' מהקטלוג' : null} />
        <Kpi label="מתחרים במעקב" value={(stores || []).length} sub={`${activeStores.size} עם התאמות`} />
        <Kpi label="מתחרה זול ממני" value={cheaper.length} tone={cheaper.length ? 'neg' : ''} onClick={() => setF(s => ({ ...s, pricier: true, sort: 'gap' }))} />
        <Kpi label="המחיר שלי הכי נמוך" value={iAmCheapest.length} tone={iAmCheapest.length ? 'pos' : ''} />
        <Kpi label="חסרה עלות רכישה" value={missingCost.length} tone={missingCost.length ? 'warn' : ''} onClick={() => set('noCost', true)} />
      </div>

      <div className="cmp-filters">
        <input className="search-input" type="search" placeholder="חיפוש שם מוצר או מק״ט" value={f.q} onChange={e => set('q', e.target.value)} />
        <select value={f.cat} onChange={e => setF(s => ({ ...s, cat: e.target.value, sub: '' }))}>
          <option value="">כל הקטגוריות</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={f.sub} onChange={e => set('sub', e.target.value)} disabled={!subs.length}>
          <option value="">כל תתי־הקטגוריות</option>
          {subs.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={f.store} onChange={e => set('store', e.target.value)}>
          <option value="">כל המתחרים</option>
          {(stores || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={f.sort} onChange={e => set('sort', e.target.value)}>
          <option value="name">מיון: שם מוצר</option>
          <option value="gap">מיון: מתחרה הכי זול ממני</option>
          <option value="gap_desc">מיון: אני הכי זול</option>
          <option value="price_desc">מיון: מחיר שלי (גבוה לנמוך)</option>
          <option value="price_asc">מיון: מחיר שלי (נמוך לגבוה)</option>
          <option value="margin_asc">מיון: רווחיות (נמוכה קודם)</option>
          <option value="margin_desc">מיון: רווחיות (גבוהה קודם)</option>
        </select>
        <div className="cmp-chips">
          <Chip on={f.withOffers} onClick={() => set('withOffers', !f.withOffers)}>רק עם השוואה</Chip>
          <Chip on={f.pricier} onClick={() => set('pricier', !f.pricier)}>אני יקר יותר</Chip>
          <Chip on={f.exact} onClick={() => set('exact', !f.exact)}>התאמות מדויקות בלבד</Chip>
          <Chip on={f.noCost} onClick={() => set('noCost', !f.noCost)}>ללא עלות ספק</Chip>
          {anyFilter && <button className="link-btn" onClick={() => setF(s => ({ q: '', cat: '', sub: '', store: '', pricier: false, noCost: false, exact: false, withOffers: false, sort: s.sort }))}>ניקוי סינון</button>}
        </div>
      </div>

      <div className="cmp-count">{shown.length} מוצרים{shown.length !== rows.length ? ` מתוך ${rows.length}` : ''}</div>

      <div className="table-wrap cmp-wrap">
        <table className="data-table cmp-table">
          <thead>
            <tr>
              <th className="cmp-sticky">מוצר</th>
              <th>קטגוריה</th>
              <th className="n">עלות ספק</th>
              <th className="n">עלות כולל מע״מ</th>
              <th className="n">המחיר שלי</th>
              <th className="n">רווח משוער</th>
              <th className="n">רווחיות</th>
              <th className="cmp-lowest-h">הזול ביותר אצל מתחרה</th>
              {shownStores.map(s => <th key={s.id} className="cmp-store-h" title={s.domain}>{s.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td className="empty-col" colSpan={8 + shownStores.length}>
                {rows.length ? 'אין מוצרים שתואמים לסינון' : 'עדיין אין מוצרים במסד'}
              </td></tr>
            )}
            {shown.map(r => (
              <tr key={r.id} onClick={() => setOpen(r)}>
                <td className="cmp-sticky">
                  <div className="cmp-prod">
                    <div className="cmp-thumb">{(r.name || '?').trim()[0]}</div>
                    <div>
                      <div className="cmp-name">{r.name}</div>
                      <div className="cmp-sku">{r.sku || 'ללא מק״ט'}</div>
                    </div>
                  </div>
                </td>
                <td><div className="cmp-cat">{r.category || '—'}</div>{r.subcategory && <div className="cmp-sub">{r.subcategory}</div>}</td>
                <td className="n">{hasCost(r) ? ils(r.cost) : <span className="cmp-missing">עלות חסרה</span>}</td>
                <td className="n">{hasCost(r) ? ils(r.cost_with_vat) : '—'}</td>
                <td className="n"><b>{r.price > 0 ? ils(r.price) : '—'}</b></td>
                <td className="n">{hasCost(r) ? <span className={r.profit < 0 ? 'neg' : ''}>{ils(r.profit)}</span> : '—'}</td>
                <td className="n">{hasCost(r) ? <span className={r.margin < 0 ? 'neg' : ''}>{pct(r.margin)}</span> : '—'}</td>
                <td className="cmp-lowest">
                  {r.lowest ? <OfferCell offer={r.lowest} myPrice={r.price} showStore /> : <span className="cmp-dash">—</span>}
                </td>
                {shownStores.map(s => {
                  const offers = r.offers.filter(o => o.store_id === s.id && (!f.exact || o.match_type === 'exact'))
                  return (
                    <td key={s.id} className="cmp-cell-td">
                      {offers.length ? offers.map(o => <OfferCell key={o.offer_id} offer={o} myPrice={r.price} />) : <span className="cmp-dash">—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cmp-legend">
        <span><i className="sw c-cheaper" /> המתחרה זול ממני</span>
        <span><i className="sw c-pricier" /> המתחרה יקר ממני</span>
        <span><i className="sw c-none" /> אין נתון / התאמה לא מאומתת</span>
        <span>הפער מחושב מול המחיר שלי באתר, לא כולל משלוח וחריטה. לחיצה על שורה פותחת פירוט והיסטוריה.</span>
      </p>

      {open && <ProductDrawer row={open} stores={stores || []} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Kpi({ label, value, sub, tone = '', onClick }) {
  return (
    <div className={`summary-card cmp-kpi ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <span>{label}</span>
      <b className={tone}>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return <button className={`cmp-chip ${on ? 'on' : ''}`} onClick={onClick}>{children}</button>
}

function OfferCell({ offer, myPrice, showStore }) {
  const g = gap(offer, myPrice)
  const m = matchInfo(offer.match_type)
  return (
    <div className={`cmp-offer ${gapCls(g, offer)}`}>
      <div className="cmp-offer-top">
        <b>{ils(offer.price)}</b>
        <span className={`cmp-match ${m.cls}`}>{m.label}</span>
      </div>
      {showStore && <div className="cmp-offer-store">{offer.store_name}</div>}
      {g && <div className="cmp-offer-gap">{signed(g.diff)} · {g.pct > 0 ? '+' : ''}{pct(g.pct)}</div>}
      <div className="cmp-offer-meta">
        {offer.checked_at && <span>{formatDateTime(offer.checked_at)}</span>}
        {offer.url && <a href={offer.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>לעמוד ↗</a>}
      </div>
    </div>
  )
}

function ProductDrawer({ row, stores, onClose }) {
  const { openRecord } = useNav()
  const [checks, setChecks] = useState(null)
  const [err, setErr] = useState('')
  const storeName = id => stores.find(s => s.id === id)?.name || row.offers.find(o => o.store_id === id)?.store_name || '—'

  useEffect(() => {
    const ids = row.offers.map(o => o.offer_id)
    if (!ids.length) { setChecks([]); return }
    supabase.from('competitor_price_checks').select('id, offer_id, price, shipping_price, availability, checked_at, collection_method, note')
      .in('offer_id', ids).order('checked_at', { ascending: true })
      .then(({ data, error }) => { if (error) { setErr(error.message); setChecks([]) } else setChecks(data) })
  }, [row.id])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const offerById = new Map(row.offers.map(o => [o.offer_id, o]))
  const offers = [...row.offers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))

  return (
    <div className="overlay cmp-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="cmp-drawer">
        <div className="cmp-drawer-head">
          <div>
            <h2>{row.name}</h2>
            <div className="cmp-sku">{row.sku || 'ללא מק״ט'} · {[row.category, row.subcategory].filter(Boolean).join(' / ') || 'ללא קטגוריה'}</div>
          </div>
          <button className="cmp-close" onClick={onClose} aria-label="סגירה">✕</button>
        </div>

        <div className="cmp-links">
          <button className="link-btn" onClick={() => { onClose(); openRecord('products', row.id) }}>פתיחת המוצר ב־CRM</button>
          {row.url && <a href={row.url} target="_blank" rel="noopener noreferrer">המוצר באתר ↗</a>}
        </div>

        <div className="cmp-facts">
          <Fact label="המחיר שלי" value={row.price > 0 ? ils(row.price) : '—'} strong />
          <Fact label="עלות ספק" value={hasCost(row) ? ils(row.cost) : 'עלות חסרה'} warn={!hasCost(row)} />
          <Fact label="עלות כולל מע״מ" value={hasCost(row) ? ils(row.cost_with_vat) : '—'} />
          <Fact label="רווח משוער" value={hasCost(row) ? ils(row.profit) : '—'} />
          <Fact label="רווחיות" value={hasCost(row) ? pct(row.margin) : '—'} />
          <Fact label="הזול אצל מתחרה" value={row.lowest ? `${ils(row.lowest.price)} · ${row.lowest.store_name}` : '—'} />
        </div>
        {!hasCost(row) && <p className="cmp-note">לא הוזנה עלות רכישה למוצר, ולכן לא מוצג רווח. אפשר להזין עלות בכרטיס המוצר.</p>}

        <h3>הצעות אצל מתחרים</h3>
        {offers.length === 0 ? (
          <div className="cmp-empty">עדיין לא נמצאו התאמות למוצר הזה. כשיתווספו התאמות למסד, הן יופיעו כאן אוטומטית.</div>
        ) : (
          <div className="cmp-offer-list">
            {offers.map(o => {
              const g = gap(o, row.price)
              const m = matchInfo(o.match_type)
              const notes = [o.variant_notes, o.engraving_notes, o.package_notes, o.shipping_notes, o.note].filter(Boolean)
              return (
                <div key={o.offer_id} className={`cmp-offer-row ${gapCls(g, o)}`}>
                  <div className="cmp-offer-row-main">
                    <div>
                      <b>{o.store_name}</b> <span className={`cmp-match ${m.cls}`}>{m.label}{o.confidence != null ? ` · ${Math.round(o.confidence * 100)}%` : ''}</span>
                      {o.title && <div className="cmp-sub">{o.title}</div>}
                      {o.sku && <div className="cmp-sub">מק״ט אצל המתחרה: {o.sku}</div>}
                    </div>
                    <div className="cmp-offer-row-price">
                      <b>{ils(o.price)}</b>
                      {g && <div className="cmp-offer-gap">{signed(g.diff)} · {g.pct > 0 ? '+' : ''}{pct(g.pct)}</div>}
                    </div>
                  </div>
                  <div className="cmp-offer-meta">
                    {o.checked_at && <span>נבדק {formatDateTime(o.checked_at)}</span>}
                    {o.shipping_price != null && <span>משלוח {ils(o.shipping_price)}</span>}
                    {o.availability && o.availability !== 'unknown' && <span>{o.availability === 'in_stock' ? 'במלאי' : o.availability === 'out_of_stock' ? 'אזל' : o.availability}</span>}
                    {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer">לעמוד המוצר ↗</a>}
                  </div>
                  {notes.length > 0 && <div className="cmp-offer-notes">{notes.join(' · ')}</div>}
                </div>
              )
            })}
          </div>
        )}

        <h3>היסטוריית מחירים</h3>
        {err && <div className="err-inline">{err}</div>}
        {checks === null ? <div className="loading">טוען היסטוריה...</div>
          : checks.length === 0 ? <div className="cmp-empty">אין עדיין בדיקות מחיר למוצר הזה.</div>
          : (
            <>
              <PriceChart checks={checks} offerById={offerById} storeName={storeName} myPrice={row.price} />
              <div className="table-wrap cmp-hist">
                <table className="data-table">
                  <thead><tr><th>תאריך</th><th>מתחרה</th><th>מחיר</th><th>שינוי</th><th>זמינות</th></tr></thead>
                  <tbody>
                    {withChange(checks).slice().reverse().map(c => (
                      <tr key={c.id}>
                        <td>{formatDateTime(c.checked_at)}</td>
                        <td>{storeName(offerById.get(c.offer_id)?.store_id)}</td>
                        <td>{ils(c.price)}</td>
                        <td>{c.change == null ? '—' : <span className={c.change < 0 ? 'neg' : c.change > 0 ? 'pos' : ''}>{signed(c.change)}</span>}</td>
                        <td>{c.availability === 'in_stock' ? 'במלאי' : c.availability === 'out_of_stock' ? 'אזל' : 'לא ידוע'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
      </aside>
    </div>
  )
}

function Fact({ label, value, strong, warn }) {
  return (
    <div className="cmp-fact">
      <span>{label}</span>
      <b className={warn ? 'cmp-missing' : strong ? 'cmp-strong' : ''}>{value}</b>
    </div>
  )
}

// שינוי מחיר מול הבדיקה הקודמת של אותה הצעה
function withChange(checks) {
  const last = new Map()
  return checks.map(c => {
    const prev = last.get(c.offer_id)
    last.set(c.offer_id, c.price)
    return { ...c, change: prev == null || c.price == null ? null : Number(c.price) - Number(prev) }
  })
}

const SERIES = ['var(--violet)', 'var(--chart-teal)', 'var(--amber)', 'var(--coral)', '#3B82C4', '#9B5DE5', '#6B7A3A', '#C2185B']

function PriceChart({ checks, offerById, storeName, myPrice }) {
  const series = new Map()
  for (const c of checks) {
    if (c.price == null) continue
    if (!series.has(c.offer_id)) series.set(c.offer_id, [])
    series.get(c.offer_id).push({ t: new Date(c.checked_at).getTime(), p: Number(c.price) })
  }
  const lines = [...series.entries()].filter(([, pts]) => pts.length >= 2)
  if (!lines.length) {
    return <div className="cmp-empty">גרף שינויים יוצג כשיהיו לפחות שתי בדיקות מחיר לאותו מתחרה. כרגע יש בדיקה אחת לכל הצעה.</div>
  }
  const all = lines.flatMap(([, pts]) => pts)
  const ts = all.map(x => x.t), ps = all.map(x => x.p).concat(myPrice > 0 ? [myPrice] : [])
  const t0 = Math.min(...ts), t1 = Math.max(...ts)
  const lo = Math.min(...ps), hi = Math.max(...ps)
  const pad = (hi - lo) * 0.12 || hi * 0.05 || 1
  const y0 = lo - pad, y1 = hi + pad
  const W = 560, H = 200, L = 52, R = 12, T = 12, B = 26
  const x = t => L + (t1 === t0 ? (W - L - R) / 2 : ((t - t0) / (t1 - t0)) * (W - L - R))
  const y = p => T + (1 - (p - y0) / (y1 - y0)) * (H - T - B)
  const ticks = [0, 0.5, 1].map(k => y0 + (y1 - y0) * k)
  const fmtD = t => new Date(t).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
  return (
    <div className="cmp-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="גרף מחירי מתחרים לאורך זמן" style={{ direction: 'ltr' }}>
        {ticks.map(v => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="var(--ink-soft)">₪{Math.round(v)}</text>
          </g>
        ))}
        <text x={L} y={H - 6} fontSize="10.5" fill="var(--ink-soft)">{fmtD(t0)}</text>
        <text x={W - R} y={H - 6} textAnchor="end" fontSize="10.5" fill="var(--ink-soft)">{fmtD(t1)}</text>
        {myPrice > 0 && <line x1={L} x2={W - R} y1={y(myPrice)} y2={y(myPrice)} stroke="var(--ink)" strokeDasharray="4 4" strokeWidth="1.2" />}
        {lines.map(([id, pts], i) => (
          <g key={id}>
            <polyline fill="none" stroke={SERIES[i % SERIES.length]} strokeWidth="2" points={pts.map(q => `${x(q.t)},${y(q.p)}`).join(' ')} />
            {pts.map((q, j) => <circle key={j} cx={x(q.t)} cy={y(q.p)} r="3" fill={SERIES[i % SERIES.length]}><title>{storeName(offerById.get(id)?.store_id)} · ₪{q.p} · {fmtD(q.t)}</title></circle>)}
          </g>
        ))}
      </svg>
      <div className="cmp-chart-legend">
        {myPrice > 0 && <span><i className="sw dash" /> המחיר שלי</span>}
        {lines.map(([id], i) => <span key={id}><i className="sw" style={{ background: SERIES[i % SERIES.length] }} /> {storeName(offerById.get(id)?.store_id)}</span>)}
      </div>
    </div>
  )
}
