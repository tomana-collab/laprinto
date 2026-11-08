import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useNav } from '../contexts/NavContext'
import { formatDateTime } from '../lib/format'

// השוואת מתחרים. הנתונים (חנויות, התאמות, בדיקות מחיר) נכתבים למסד מבחוץ;
// לשונית ההשוואה רק קוראת (v_competitor_matrix + competitor_stores + competitor_price_checks),
// כתיבה מהממשק: review_status / review_notes ב-competitor_offers (אישור/דחייה),
// הוספת חנות ל-competitor_stores, והוספת קישור ידני ל-competitor_offers (entry_method = 'manual').
// רק התאמה מאושרת (approved) נחשבת סופית: היא היחידה שנכנסת לחישובי "הזול ביותר", לפערים ולסיכומים.
// אישור אוטומטי לפי מק״ט נעשה במסד (approval_method = 'verified_supplier_sku') — הממשק רק מציג אותו.

const ils = n => n == null ? '—' : '₪' + Number(n).toLocaleString('he-IL', { maximumFractionDigits: 2 })
const pct = n => n == null ? '—' : Number(n).toLocaleString('he-IL', { maximumFractionDigits: 1 }) + '%'
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + ils(Math.abs(n))
const hasCost = p => Number(p.cost) > 0
const num = v => (v == null || v === '' ? null : Number(v))

const MATCH = {
  exact: { label: 'זהה', cls: 'm-exact' },
  variant: { label: 'וריאציה', cls: 'm-variant' },
  similar: { label: 'דומה', cls: 'm-similar' },
  candidate: { label: 'מועמד', cls: 'm-similar' },
}
const REVIEW = {
  pending: { label: 'ממתין לאישור', cls: 'r-pending' },
  approved: { label: 'מאושר', cls: 'r-approved' },
  rejected: { label: 'נדחה', cls: 'r-rejected' },
}
const isFinal = o => o.review_status === 'approved'
const isAutoApproved = o => o.review_status === 'approved' && !!o.approval_method && o.approval_method !== 'manual'
const approvalLabel = o => o.review_status !== 'approved' ? null
  : o.approval_method === 'verified_supplier_sku' ? 'מאושר אוטומטית לפי מק״ט'
  : isAutoApproved(o) ? `מאושר אוטומטית (${o.approval_method})` : 'אושר ידנית'
const SKU_SOURCE = {
  url: 'המק״ט אומת מכתובת העמוד אצל המתחרה',
  page: 'המק״ט אומת מתוכן עמוד המוצר',
  json_ld: 'המק״ט אומת מהנתונים המובנים בעמוד',
  structured_data: 'המק״ט אומת מהנתונים המובנים בעמוד',
  manual: 'המק״ט אומת ידנית',
  unverified: 'המק״ט לא אומת',
}
const skuSourceLabel = v => !v ? null : SKU_SOURCE[v] || `מקור אימות מק״ט: ${v}`

// שמירת אישור/דחייה ובדיקה מול המסד שהעדכון נקלט (השורה המוחזרת מה-update)
const DECISION_COLS = 'id, review_status, review_notes, reviewed_at, approval_method, sku_verification_source, sku_verified_at'
async function saveDecision(offerId, review_status, review_notes) {
  const patch = { review_status }
  if (review_status === 'rejected') patch.review_notes = review_notes
  const { data, error } = await supabase.from('competitor_offers').update(patch).eq('id', offerId).select(DECISION_COLS).maybeSingle()
  if (error || !data || data.review_status !== review_status) return { error: error?.message || 'העדכון לא נשמר במסד (ייתכן שאין הרשאה)' }
  return { data }
}

// כתובת → דומיין נקי (בלי פרוטוקול, www ונתיב)
function cleanDomain(v) {
  const t = (v || '').trim().toLowerCase()
  if (!t) return ''
  try { return new URL(/^https?:\/\//.test(t) ? t : 'https://' + t).hostname.replace(/^www\./, '') } catch { return '' }
}
const matchInfo = t => MATCH[t] || { label: t || 'לא אומת', cls: 'm-similar' }

// פער מול המחיר שלי: שלילי = המתחרה זול ממני
function gap(offer, myPrice) {
  if (offer?.price == null || !(myPrice > 0)) return null
  const diff = offer.price - myPrice
  return { diff, pct: (diff / myPrice) * 100 }
}
const gapCls = (g, offer) => !g || !isFinal(offer) ? 'c-none' : g.diff < 0 ? 'c-cheaper' : g.diff > 0 ? 'c-pricier' : 'c-equal'

export default function Competitors() {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('cmp-tab') || 'compare' } catch { return 'compare' } })
  const [pending, setPending] = useState(null)
  const choose = t => { setTab(t); try { localStorage.setItem('cmp-tab', t) } catch {} }

  async function countPending() {
    const { count } = await supabase.from('competitor_offers').select('id', { count: 'exact', head: true }).eq('review_status', 'pending')
    setPending(count ?? null)
  }
  useEffect(() => { countPending() }, [])

  return (
    <div className="cmp-page">
      <div className="module-head"><h2>🔎 השוואת מתחרים</h2></div>
      <div className="cmp-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'compare'} className={tab === 'compare' ? 'on' : ''} onClick={() => choose('compare')}>השוואת מחירים</button>
        <button role="tab" aria-selected={tab === 'review'} className={tab === 'review' ? 'on' : ''} onClick={() => choose('review')}>
          אישור התאמות {pending > 0 && <span className="cmp-tab-count">{pending}</span>}
        </button>
      </div>
      {tab === 'compare'
        ? <ComparisonView onChanged={countPending} />
        : <ReviewQueue onChanged={countPending} />}
    </div>
  )
}

function ComparisonView({ onChanged }) {
  const [stores, setStores] = useState(null)       // חנויות פעילות (עמודות בטבלה)
  const [allStores, setAllStores] = useState([])   // כולל לא פעילות, לניהול
  const [addingStore, setAddingStore] = useState(false)
  const [editingStore, setEditingStore] = useState(null)
  const [managingStores, setManagingStores] = useState(false)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [f, setF] = useState({ q: '', cat: '', sub: '', store: '', pricier: false, noCost: false, exact: false, withOffers: false, sort: 'name' })
  const [openId, setOpenId] = useState(null)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const open = openId ? (rows || []).find(r => r.id === openId) : null

  async function load() {
    setError('')
    const [m, s, p] = await Promise.all([
      supabase.from('v_competitor_matrix').select('*'),
      supabase.from('competitor_stores').select('id, name, domain, enabled, priority').order('priority'),
      supabase.from('products').select('id, cost, cost_with_vat, extra_expenses, price, profit, margin_percent, wc_product_id, wc_parent_id, supplier_url, image_url'),
    ])
    const err = [m, s, p].find(x => x.error)
    if (err) { setError(err.error.message); setRows([]); setStores([]); return }
    setStores(s.data.filter(x => x.enabled !== false))
    setAllStores(s.data)

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
          url: r.product_url, wc_product_id: r.wc_product_id ?? pr.wc_product_id, image: pr.image_url || null,
          cost: num(pr.cost ?? r.supplier_cost), cost_with_vat: num(pr.cost_with_vat ?? r.cost_with_vat),
          extra_expenses: num(pr.extra_expenses), price: num(pr.price ?? r.my_price),
          profit: num(pr.profit ?? r.calculated_profit), margin: num(pr.margin_percent ?? r.calculated_margin_percent),
          offers: [], rejected: [],
        }
        byProduct.set(r.product_id, row)
      }
      if (r.offer_id) (r.review_status === 'rejected' ? row.rejected : row.offers).push({
        review_status: r.review_status || 'pending', review_notes: r.review_notes,
        approval_method: r.approval_method, sku_verification_source: r.sku_verification_source, sku_verified_at: r.sku_verified_at,
        offer_id: r.offer_id, store_id: r.store_id, store_name: r.store_name, price: num(r.competitor_price),
        shipping_price: num(r.shipping_price), url: r.competitor_url || r.source_url, sku: r.competitor_sku, title: r.competitor_title,
        match_type: r.match_type, confidence: num(r.match_confidence), availability: r.availability, checked_at: r.checked_at,
        note: r.observation_note, variant_notes: r.variant_notes, engraving_notes: r.engraving_notes,
        package_notes: r.package_notes, shipping_notes: r.shipping_notes,
        collection_method: r.collection_method, price_scan_enabled: r.price_scan_enabled, entry_method: r.entry_method,
      })
    }
    const list = [...byProduct.values()].filter(r => !parents.has(r.wc_product_id) || r.offers.length)
    list.forEach(withLowest)
    setRows(list)
    setLoadedAt(new Date())
  }
  useEffect(() => { load() }, [])

  // עדכון מקומי מיידי אחרי אישור/דחייה/הוספה (בלי טעינה מחדש)
  function patchOffer(productId, offerId, patch) {
    setRows(list => list.map(r => {
      if (r.id !== productId) return r
      const all = [...r.offers, ...r.rejected]
      const prev = all.find(o => o.offer_id === offerId)
      const next = { ...prev, ...patch }
      const rest = all.filter(o => o.offer_id !== offerId).concat(next)
      return withLowest({ ...r, offers: rest.filter(o => o.review_status !== 'rejected'), rejected: rest.filter(o => o.review_status === 'rejected') })
    }))
    onChanged?.()
  }
  // חנות נערכה: מעדכנים רשימות ושם החנות בהצעות, בלי טעינה מחדש
  function storeSaved(st) {
    setAllStores(list => list.some(x => x.id === st.id) ? list.map(x => x.id === st.id ? st : x) : [...list, st])
    setStores(list => {
      const others = (list || []).filter(x => x.id !== st.id)
      return (st.enabled !== false ? [...others, st] : others).sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    })
    setRows(list => list.map(r => ({ ...r,
      offers: r.offers.map(o => o.store_id === st.id ? { ...o, store_name: st.name } : o),
      rejected: r.rejected.map(o => o.store_id === st.id ? { ...o, store_name: st.name } : o) })))
  }
  function addOffer(productId, offer) {
    setRows(list => list.map(r => r.id !== productId ? r : withLowest({ ...r, offers: [...r.offers, offer] })))
    onChanged?.()
  }
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
      if (f.pricier && !offers.some(o => gap(o, r.price)?.diff < 0 && isFinal(o))) return false
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

  const compared = rows.filter(r => r.offers.some(o => o.price != null && isFinal(o)))
  const awaiting = rows.filter(r => r.offers.some(o => o.review_status === 'pending'))
  const cheaper = rows.filter(r => r.lowestGap && r.lowestGap.diff < 0)
  const iAmCheapest = rows.filter(r => r.lowestGap && r.lowestGap.diff > 0)
  const missingCost = rows.filter(r => !hasCost(r))
  const activeStores = new Set(rows.flatMap(r => r.offers.filter(isFinal).map(o => o.store_id)))
  const anyFilter = f.q || f.cat || f.sub || f.store || f.pricier || f.noCost || f.exact || f.withOffers

  return (
    <div>
      <div className="cmp-toolbar">
        <div className="cmp-head-meta">
          {loadedAt && <span>עודכן בתצוגה {loadedAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>}
          <button className="btn-add btn-outline" onClick={() => setManagingStores(true)}>ניהול מתחרים</button>
          <button className="btn-add btn-outline" onClick={() => setAddingStore(true)}>+ הוספת מתחרה</button>
          <button className="btn-add btn-outline" onClick={load}>רענון</button>
        </div>
      </div>
      {error && <div className="err-inline">{error}</div>}

      <ScanPanel rows={rows} onDone={load} />

      <div className="cmp-kpis">
        <Kpi label="מוצרים בקטלוג" value={rows.length} />
        <Kpi label="עם השוואת מתחרים" value={compared.length} sub={awaiting.length ? `עוד ${awaiting.length} ממתינים לאישור` : rows.length ? pct(compared.length / rows.length * 100) + ' מהקטלוג' : null} />
        <Kpi label="מתחרים במעקב" value={(stores || []).length} sub={`${activeStores.size} עם התאמות מאושרות`} />
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
              {shownStores.map(s => (
                <th key={s.id} className="cmp-store-h" title={s.domain}>
                  {s.name} <button className="cmp-edit-ico" title="עריכת חנות" aria-label={`עריכת ${s.name}`} onClick={() => setEditingStore(s)}>✎</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td className="empty-col" colSpan={8 + shownStores.length}>
                {rows.length ? 'אין מוצרים שתואמים לסינון' : 'עדיין אין מוצרים במסד'}
              </td></tr>
            )}
            {shown.map(r => (
              <tr key={r.id} onClick={() => setOpenId(r.id)}>
                <td className="cmp-sticky">
                  <div className="cmp-prod">
                    <ProductThumb src={r.image} />
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
        <span><i className="sw c-none" /> התאמה שעוד לא אושרה (לא נכנסת לחישובים)</span>
        <span>הפער מחושב מול המחיר שלי באתר, לא כולל משלוח וחריטה. לחיצה על שורה פותחת פירוט והיסטוריה.</span>
      </p>

      {open && <ProductDrawer row={open} stores={stores || []} onClose={() => setOpenId(null)}
        onPatch={(offerId, patch) => patchOffer(open.id, offerId, patch)} onAdd={offer => addOffer(open.id, offer)}
        onAddStore={() => setAddingStore(true)} />}
      {addingStore && <AddStoreModal stores={allStores} onCancel={() => setAddingStore(false)}
        onSaved={st => { storeSaved(st); setAddingStore(false) }} />}
      {managingStores && <StoresModal stores={allStores} onClose={() => setManagingStores(false)} onEdit={st => setEditingStore(st)} />}
      {editingStore && <StoreEditModal store={editingStore} stores={allStores} onCancel={() => setEditingStore(null)}
        onSaved={st => { storeSaved(st); setEditingStore(null) }} />}
    </div>
  )
}

// תמונת המוצר הראשית מ-WooCommerce (products.image_url). אין תמונה / שגיאת טעינה → אייקון ניטרלי.
function ProductThumb({ src }) {
  const [failed, setFailed] = useState(false)
  const url = safeImg(src)
  useEffect(() => { setFailed(false) }, [src])
  return (
    <div className="cmp-thumb">
      {url && !failed
        ? <img src={url} alt="" width="52" height="52" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" />
          </svg>}
    </div>
  )
}

function withLowest(r) {
  const priced = r.offers.filter(o => o.price != null && isFinal(o))
  r.lowest = priced.length ? priced.reduce((a, o) => (o.price < a.price ? o : a)) : null
  r.lowestGap = gap(r.lowest, r.price)
  return r
}

// פער כסף + אחוז, מבודד כ-LTR כדי שסימן המינוס לא יקפוץ לצד הלא נכון בתוך טקסט עברי
function GapText({ g }) {
  return <span dir="ltr">{signed(g.diff)} ({g.pct > 0 ? '+' : g.pct < 0 ? '−' : ''}{pct(Math.abs(g.pct))})</span>
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
        <b>{offer.price != null ? ils(offer.price) : <span className="cmp-dash">אין מחיר עדיין</span>}</b>
        <span className={`cmp-match ${m.cls}`}>{m.label}</span>
      </div>
      {showStore && <div className="cmp-offer-store">{offer.store_name}</div>}
      {!isFinal(offer) && <div className="cmp-offer-review">ממתין לאישור התאמה</div>}
      {isAutoApproved(offer) && <div className="cmp-offer-auto">✓ אוטומטי לפי מק״ט</div>}
      {offer.collection_method === 'manual' && <div className="cmp-offer-manual">✎ עודכן ידנית</div>}
      {g && <div className="cmp-offer-gap"><GapText g={g} /></div>}
      <div className="cmp-offer-meta">
        {offer.checked_at && <span dir="ltr">{formatDateTime(offer.checked_at)}</span>}
        {offer.url && <a href={offer.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>לעמוד ↗</a>}
      </div>
    </div>
  )
}

function ProductDrawer({ row, stores, onClose, onPatch, onAdd, onAddStore }) {
  const [adding, setAdding] = useState(false)
  const { openRecord } = useNav()
  const [checks, setChecks] = useState(null)
  const [err, setErr] = useState('')
  const [mode, setMode] = useState({}) // offer_id → 'edit' | 'price'
  const [notice, setNotice] = useState({}) // offer_id → { ok, text }
  const setOfferMode = (id, m) => setMode(x => ({ ...x, [id]: m }))
  const storeName = id => stores.find(s => s.id === id)?.name || row.offers.find(o => o.store_id === id)?.store_name || '—'

  function loadChecks() {
    const ids = [...row.offers, ...row.rejected].map(o => o.offer_id)
    if (!ids.length) { setChecks([]); return }
    supabase.from('competitor_price_checks').select('id, offer_id, price, shipping_price, availability, checked_at, collection_method, note')
      .in('offer_id', ids).order('checked_at', { ascending: true })
      .then(({ data, error }) => { if (error) { setErr(error.message); setChecks([]) } else setChecks(data) })
  }
  useEffect(loadChecks, [row.id, row.offers.length + row.rejected.length])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const offerById = new Map([...row.offers, ...row.rejected].map(o => [o.offer_id, o]))
  // ממתינים קודם (דורשים פעולה), אחר כך מאושרים לפי מחיר; נדחים בסוף
  const rank = o => o.review_status === 'pending' ? 0 : o.review_status === 'approved' ? 1 : 2
  const offers = [...row.offers, ...row.rejected].sort((a, b) => rank(a) - rank(b) || (a.price ?? Infinity) - (b.price ?? Infinity))
  const pendingCount = row.offers.filter(o => o.review_status === 'pending').length

  return (
    <div className="overlay cmp-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="cmp-drawer">
        <div className="cmp-drawer-head">
          <div className="cmp-drawer-title">
            <ProductThumb src={row.image} />
            <div>
            <h2>{row.name}</h2>
            <div className="cmp-sub"><span className="cmp-sku">{row.sku || 'ללא מק״ט'}</span> · {[row.category, row.subcategory].filter(Boolean).join(' / ') || 'ללא קטגוריה'}</div>
            </div>
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

        <div className="cmp-h3-row">
          <h3>הצעות אצל מתחרים {pendingCount > 0 && <span className="cmp-tab-count">{pendingCount} ממתינים</span>}</h3>
          {!adding && <button className="btn-add btn-outline" onClick={() => setAdding(true)}>+ הוספת קישור למתחרה</button>}
        </div>
        {adding && <AddOfferForm row={row} stores={stores} onCancel={() => setAdding(false)} onAddStore={onAddStore}
          onSaved={offer => { onAdd(offer); setAdding(false) }} />}
        {offers.length === 0 ? (
          <div className="cmp-empty">עדיין לא נמצאו התאמות למוצר הזה. אפשר להוסיף קישור למוצר אצל מתחרה בכפתור למעלה.</div>
        ) : (
          <div className="cmp-offer-list">
            {offers.map(o => {
              const g = gap(o, row.price)
              const m = matchInfo(o.match_type)
              const notes = [o.variant_notes, o.engraving_notes, o.package_notes, o.shipping_notes, o.note].filter(Boolean)
              return (
                <div key={o.offer_id} className={`cmp-offer-row ${o.review_status === 'rejected' ? 'is-rejected' : gapCls(g, o)}`}>
                  <div className="cmp-offer-row-main">
                    <div>
                      <b>{o.store_name}</b> <ReviewBadge o={o} /> <span className={`cmp-match ${m.cls}`}>{m.label}{o.confidence != null ? ` · ${Math.round(o.confidence * 100)}%` : ''}</span>
                      {o.title && <div className="cmp-sub">{o.title}</div>}
                      {o.sku && <div className="cmp-sub">מק״ט אצל המתחרה: {o.sku}</div>}
                      <SkuSource o={o} />
                    </div>
                    <div className="cmp-offer-row-price">
                      <b>{o.price != null ? ils(o.price) : <span className="cmp-dash">אין מחיר עדיין</span>}</b>
                      {g && <div className="cmp-offer-gap"><GapText g={g} /></div>}
                    </div>
                  </div>
                  <div className="cmp-offer-meta">
                    {o.checked_at && <span>נבדק <span dir="ltr">{formatDateTime(o.checked_at)}</span></span>}
                    {o.shipping_price != null && <span>משלוח {ils(o.shipping_price)}</span>}
                    {o.availability && o.availability !== 'unknown' && <span>{o.availability === 'in_stock' ? 'במלאי' : o.availability === 'out_of_stock' ? 'אזל' : o.availability}</span>}
                    {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer">לעמוד המוצר ↗</a>}
                  </div>
                  {notes.length > 0 && <div className="cmp-offer-notes">{notes.join(' · ')}</div>}
                  {o.review_status === 'rejected' && o.review_notes && <div className="rv-reason">סיבת דחייה: {o.review_notes}</div>}
                  {o.price_scan_enabled === false && <div className="cmp-offer-notes">⏸ מעקב מחירים מושבת להצעה הזו</div>}
                  {notice[o.offer_id] && <div className={`rv-flash ${notice[o.offer_id].ok ? 'ok' : 'err'}`}>{notice[o.offer_id].text}</div>}
                  {mode[o.offer_id] === 'edit' ? (
                    <OfferEditForm offer={o} onCancel={() => setOfferMode(o.offer_id, null)}
                      onSaved={(patch, msg) => { onPatch(o.offer_id, patch); setOfferMode(o.offer_id, null); setNotice(x => ({ ...x, [o.offer_id]: msg })) }} />
                  ) : mode[o.offer_id] === 'price' ? (
                    <PriceForm offer={o} onCancel={() => setOfferMode(o.offer_id, null)}
                      onSaved={(patch, msg) => { onPatch(o.offer_id, patch); setOfferMode(o.offer_id, null); setNotice(x => ({ ...x, [o.offer_id]: msg })); loadChecks() }} />
                  ) : (
                    <>
                      {o.review_status === 'pending' && <DecisionControls offer={o} onDone={patch => onPatch(o.offer_id, patch)} />}
                      <div className="cmp-offer-tools">
                        <button className="cmp-tool" onClick={() => { setNotice(x => ({ ...x, [o.offer_id]: null })); setOfferMode(o.offer_id, 'edit') }}>✎ עריכה</button>
                        {o.review_status !== 'rejected' && <button className="cmp-tool" onClick={() => { setNotice(x => ({ ...x, [o.offer_id]: null })); setOfferMode(o.offer_id, 'price') }}>₪ עדכן מחיר</button>}
                      </div>
                    </>
                  )}
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
                  <thead><tr><th>תאריך</th><th>מתחרה</th><th>מחיר</th><th>שינוי</th><th>מקור</th><th>זמינות</th></tr></thead>
                  <tbody>
                    {withChange(checks).slice().reverse().map(c => (
                      <tr key={c.id}>
                        <td><span dir="ltr">{formatDateTime(c.checked_at)}</span></td>
                        <td>{storeName(offerById.get(c.offer_id)?.store_id)}</td>
                        <td>{ils(c.price)}</td>
                        <td>{c.change == null ? '—' : <span dir="ltr" className={c.change < 0 ? 'neg' : c.change > 0 ? 'pos' : ''}>{signed(c.change)}</span>}</td>
                        <td>{c.collection_method === 'manual' ? <span className="cmp-offer-manual" title={c.note || undefined}>✎ עודכן ידנית</span> : <span className="cmp-sub">סריקה</span>}</td>
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

// ---------- רכיבי אישור משותפים ----------

function ReviewBadge({ o }) {
  const st = o.review_status || 'pending'
  if (st === 'approved') {
    const auto = isAutoApproved(o)
    return <span className={`cmp-review r-approved ${auto ? 'r-auto' : ''}`} title={auto ? 'אושר על ידי מנגנון האימות במסד' : undefined}>{auto ? '✓ ' : ''}{approvalLabel(o)}</span>
  }
  return <span className={`cmp-review ${REVIEW[st]?.cls || ''}`}>{REVIEW[st]?.label || st}</span>
}

function SkuSource({ o }) {
  const label = skuSourceLabel(o.sku_verification_source)
  if (!label) return null
  const verified = o.sku_verification_source !== 'unverified'
  return (
    <div className={`cmp-skusrc ${verified ? 'ok' : ''}`}>
      {verified ? '🔒 ' : ''}{label}
      {verified && o.sku_verified_at && <> · <span dir="ltr">{formatDateTime(o.sku_verified_at)}</span></>}
    </div>
  )
}

// כפתורי אישור/דחייה להצעה בודדת (בחלונית המוצר)
function DecisionControls({ offer, onDone }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function run(status, notes) {
    setBusy(true); setErr('')
    const { data, error } = await saveDecision(offer.offer_id, status, notes)
    setBusy(false)
    if (error) { setErr(error); return }
    onDone({ ...data, offer_id: offer.offer_id })
  }
  return (
    <div className="cmp-decide" onClick={e => e.stopPropagation()}>
      {rejecting ? (
        <div className="rv-reject">
          <div className="rv-label">למה זה לא אותו מוצר?</div>
          <div className="rv-reasons">
            {REJECT_REASONS.map(r => <button key={r} className={`cmp-chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>{r}</button>)}
          </div>
          <input type="text" placeholder="או כתוב סיבה" value={reason} onChange={e => setReason(e.target.value)} />
          <div className="rv-actions">
            <button className="rv-btn rv-reject-btn" disabled={busy || !reason.trim()} onClick={() => run('rejected', reason.trim())}>{busy ? 'שומר...' : 'שמירת דחייה'}</button>
            <button className="rv-btn rv-ghost" disabled={busy} onClick={() => { setRejecting(false); setReason('') }}>ביטול</button>
          </div>
        </div>
      ) : (
        <div className="rv-actions">
          <button className="rv-btn rv-approve" disabled={busy} onClick={() => run('approved')}>{busy ? 'שומר...' : '✓ זה אותו מוצר — אשר'}</button>
          <button className="rv-btn rv-reject-btn" disabled={busy} onClick={() => setRejecting(true)}>✕ לא אותו מוצר — דחה</button>
        </div>
      )}
      {err && <div className="rv-flash err">{err}</div>}
    </div>
  )
}

// ---------- הוספה ידנית ----------

function AddOfferForm({ row, stores, onCancel, onSaved, onAddStore }) {
  const [v, setV] = useState({ store_id: '', url: '', sku: '', title: '', match_type: 'exact', approve: false })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, x) => setV(s => ({ ...s, [k]: x }))
  const sorted = [...stores].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'))
  const store = stores.find(s => s.id === v.store_id)
  let urlHost = ''
  try { urlHost = /^https?:\/\//i.test(v.url.trim()) ? new URL(v.url.trim()).hostname.replace(/^www\./, '') : '' } catch { urlHost = '' }
  const mismatch = store?.domain && urlHost && !urlHost.endsWith(cleanDomain(store.domain))

  async function save() {
    setErr('')
    const url = v.url.trim()
    if (!v.store_id) return setErr('צריך לבחור חנות מתחרה')
    if (!urlHost) return setErr('הקישור צריך להיות כתובת מלאה שמתחילה ב-https://')
    if ([...row.offers, ...row.rejected].some(o => o.store_id === v.store_id && (o.url || '').replace(/\/$/, '') === url.replace(/\/$/, '')))
      return setErr('הקישור הזה כבר קיים למוצר אצל החנות הזאת')
    setBusy(true)
    const { data, error } = await supabase.from('competitor_offers').insert({
      product_id: row.id, store_id: v.store_id, product_url: url,
      competitor_sku: v.sku.trim() || null, competitor_title: v.title.trim() || null,
      match_type: v.match_type, entry_method: 'manual',
    }).select('*').single()
    if (error || !data) { setBusy(false); return setErr(error?.message || 'ההוספה לא נשמרה במסד') }
    let review = { review_status: data.review_status || 'pending', approval_method: data.approval_method, sku_verification_source: data.sku_verification_source, sku_verified_at: data.sku_verified_at, review_notes: data.review_notes }
    if (v.approve && review.review_status !== 'approved') {
      const r = await saveDecision(data.id, 'approved')
      if (r.error) setErr('הקישור נשמר, אבל האישור לא נשמר: ' + r.error)
      else review = { ...review, ...r.data }
    }
    setBusy(false)
    onSaved({
      offer_id: data.id, store_id: data.store_id, store_name: store?.name, price: null, shipping_price: null,
      url: data.product_url, sku: data.competitor_sku, title: data.competitor_title, match_type: data.match_type,
      confidence: num(data.confidence), availability: null, checked_at: null, ...review,
    })
  }

  return (
    <div className="cmp-addform">
      <div className="fields-grid">
        <div className="field">
          <label>חנות מתחרה</label>
          <select value={v.store_id} onChange={e => set('store_id', e.target.value)}>
            <option value="">בחירת חנות…</option>
            {sorted.map(s => <option key={s.id} value={s.id}>{s.name}{s.domain ? ` · ${s.domain}` : ''}</option>)}
          </select>
          <button type="button" className="link-btn cmp-mini" onClick={onAddStore}>החנות לא ברשימה? הוספת מתחרה חדש</button>
        </div>
        <div className="field">
          <label>סוג התאמה</label>
          <select value={v.match_type} onChange={e => set('match_type', e.target.value)}>
            <option value="exact">זהה</option>
            <option value="variant">וריאציה</option>
            <option value="similar">דומה</option>
            <option value="candidate">מועמד (לא בטוח)</option>
          </select>
        </div>
        <div className="field full">
          <label>קישור למוצר אצל המתחרה</label>
          <input type="url" dir="ltr" placeholder="https://" value={v.url} onChange={e => set('url', e.target.value)} />
          {mismatch && <div className="cmp-warn">הקישור הוא מ-{urlHost}, והחנות שנבחרה היא {store.domain}. כדאי לוודא שבחרת את החנות הנכונה.</div>}
        </div>
        <div className="field">
          <label>מק״ט אצל המתחרה (לא חובה)</label>
          <input type="text" dir="ltr" value={v.sku} onChange={e => set('sku', e.target.value)} />
        </div>
        <div className="field">
          <label>שם המוצר אצל המתחרה (לא חובה)</label>
          <input type="text" value={v.title} onChange={e => set('title', e.target.value)} />
        </div>
      </div>
      <label className="cmp-check"><input type="checkbox" checked={v.approve} onChange={e => set('approve', e.target.checked)} /> זה בדיוק אותו מוצר — לאשר מיד</label>
      <p className="cmp-note">המחיר ייבדק בסריקה הבאה. עד אז ההצעה תופיע בלי מחיר.</p>
      {err && <div className="err-inline">{err}</div>}
      <div className="rv-actions">
        <button className="rv-btn rv-approve" disabled={busy} onClick={save}>{busy ? 'שומר...' : 'שמירת קישור'}</button>
        <button className="rv-btn rv-ghost" disabled={busy} onClick={onCancel}>ביטול</button>
      </div>
    </div>
  )
}

function AddStoreModal({ stores, onCancel, onSaved }) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const d = cleanDomain(domain)

  async function save() {
    setErr('')
    if (!name.trim()) return setErr('צריך שם לחנות')
    if (!d || !d.includes('.')) return setErr('צריך דומיין תקין, למשל example.co.il')
    const dup = stores.find(s => cleanDomain(s.domain) === d || (s.name || '').trim() === name.trim())
    if (dup) return setErr(`החנות כבר קיימת ברשימה: ${dup.name}`)
    setBusy(true)
    const { data, error } = await supabase.from('competitor_stores').insert({ name: name.trim(), domain: d }).select('id, name, domain, enabled, priority').single()
    setBusy(false)
    if (error || !data) return setErr(error?.message || 'החנות לא נשמרה במסד')
    onSaved(data)
  }

  return (
    <div className="overlay" style={{ zIndex: 50 }} onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <h2>הוספת חנות מתחרה</h2>
        <div className="field"><label>שם החנות</label><input value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
        <div className="field">
          <label>אתר (דומיין)</label>
          <input dir="ltr" placeholder="example.co.il" value={domain} onChange={e => setDomain(e.target.value)} />
          {domain && d && d !== domain.trim().toLowerCase() && <div className="cmp-note">יישמר כ-<b dir="ltr">{d}</b></div>}
        </div>
        <p className="cmp-note">החנות תתווסף כעמודה בטבלת ההשוואה. מחיקה או עריכה של חנות לא זמינות מתוך ה-CRM, אז כדאי לוודא שהפרטים נכונים.</p>
        {err && <div className="err-inline">{err}</div>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>ביטול</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'שומר...' : 'הוספה'}</button>
        </div>
      </div>
    </div>
  )
}

// ---------- עריכת הצעה + עדכון מחיר ידני ----------

const OFFER_EDIT_COLS = `${DECISION_COLS}, product_url, competitor_sku, competitor_title, variant_notes, engraving_notes, package_notes, shipping_notes, price_scan_enabled, manual_locked`

function OfferEditForm({ offer, onCancel, onSaved }) {
  const init = {
    url: offer.url || '', sku: offer.sku || '', title: offer.title || '',
    variant_notes: offer.variant_notes || '', engraving_notes: offer.engraving_notes || '',
    package_notes: offer.package_notes || '', shipping_notes: offer.shipping_notes || '',
    price_scan_enabled: offer.price_scan_enabled !== false,
  }
  const [v, setV] = useState(init)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, x) => setV(s => ({ ...s, [k]: x }))
  const urlChanged = v.url.trim() !== init.url.trim(), skuChanged = v.sku.trim() !== init.sku.trim()

  async function save() {
    setErr('')
    const url = v.url.trim()
    if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) return setErr('הקישור צריך להיות כתובת מלאה שמתחילה ב-https://')
    // שולחים רק שדות ששונו — עדכון של הרשומה הקיימת לפי id, לא יצירת רשומה חדשה
    const map = { product_url: ['url', url], competitor_sku: ['sku', v.sku.trim() || null], competitor_title: ['title', v.title.trim() || null],
      variant_notes: ['variant_notes', v.variant_notes.trim() || null], engraving_notes: ['engraving_notes', v.engraving_notes.trim() || null],
      package_notes: ['package_notes', v.package_notes.trim() || null], shipping_notes: ['shipping_notes', v.shipping_notes.trim() || null],
      price_scan_enabled: ['price_scan_enabled', v.price_scan_enabled] }
    const patch = {}
    for (const [col, [k, val]] of Object.entries(map)) {
      const before = typeof init[k] === 'string' ? (init[k].trim() || null) : init[k]
      if (val !== before) patch[col] = val
    }
    if (!Object.keys(patch).length) return onCancel()
    setBusy(true)
    const { data, error } = await supabase.from('competitor_offers').update(patch).eq('id', offer.offer_id).select(OFFER_EDIT_COLS).maybeSingle()
    setBusy(false)
    if (error || !data) return setErr(error?.message || 'העדכון לא נשמר במסד (ייתכן שאין הרשאה)')
    const back = {
      url: data.product_url, sku: data.competitor_sku, title: data.competitor_title,
      variant_notes: data.variant_notes, engraving_notes: data.engraving_notes, package_notes: data.package_notes, shipping_notes: data.shipping_notes,
      price_scan_enabled: data.price_scan_enabled, review_status: data.review_status, review_notes: data.review_notes,
      approval_method: data.approval_method, sku_verification_source: data.sku_verification_source, sku_verified_at: data.sku_verified_at,
    }
    const reverify = offer.review_status === 'approved' && data.review_status !== 'approved'
    onSaved(back, { ok: true, text: reverify
      ? 'נשמר. הקישור או המק״ט השתנו, ולכן ההתאמה חזרה לאימות — אשר אותה שוב כדי שתיכנס למעקב המחירים.'
      : 'השינויים נשמרו' })
  }

  return (
    <div className="cmp-addform cmp-inline-form" onClick={e => e.stopPropagation()}>
      <div className="fields-grid">
        <div className="field full">
          <label>קישור ישיר למוצר</label>
          <input type="url" dir="ltr" value={v.url} onChange={e => set('url', e.target.value)} />
        </div>
        <div className="field"><label>מק״ט אצל המתחרה</label><input dir="ltr" value={v.sku} onChange={e => set('sku', e.target.value)} /></div>
        <div className="field"><label>כותרת המוצר</label><input value={v.title} onChange={e => set('title', e.target.value)} /></div>
        <div className="field"><label>וריאציה</label><input value={v.variant_notes} onChange={e => set('variant_notes', e.target.value)} /></div>
        <div className="field"><label>חריטה</label><input value={v.engraving_notes} onChange={e => set('engraving_notes', e.target.value)} /></div>
        <div className="field"><label>מארז</label><input value={v.package_notes} onChange={e => set('package_notes', e.target.value)} /></div>
        <div className="field"><label>משלוח</label><input value={v.shipping_notes} onChange={e => set('shipping_notes', e.target.value)} /></div>
      </div>
      <label className="cmp-check"><input type="checkbox" checked={v.price_scan_enabled} onChange={e => set('price_scan_enabled', e.target.checked)} /> מעקב מחירים פעיל להצעה הזו</label>
      {(urlChanged || skuChanged) && offer.review_status === 'approved' && (
        <div className="cmp-warn">שינוי קישור או מק״ט מחזיר את ההתאמה לאימות. אחרי השמירה תצטרך לאשר אותה שוב.</div>
      )}
      {err && <div className="err-inline">{err}</div>}
      <div className="rv-actions">
        <button className="rv-btn rv-approve" disabled={busy} onClick={save}>{busy ? 'שומר...' : 'שמירת שינויים'}</button>
        <button className="rv-btn rv-ghost" disabled={busy} onClick={onCancel}>ביטול</button>
      </div>
    </div>
  )
}

function PriceForm({ offer, onCancel, onSaved }) {
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    setErr('')
    const p = Number(String(price).replace(/[^\d.]/g, ''))
    if (!(p > 0)) return setErr('צריך מחיר גדול מאפס')
    setBusy(true)
    // תצפית חדשה בלבד — מחירים קודמים לא נמחקים ולא נדרסים
    const { data, error } = await supabase.from('competitor_price_checks').insert({
      offer_id: offer.offer_id, price: p, collection_method: 'manual', source_url: offer.url || null, note: note.trim() || null,
    }).select('id, price, checked_at, collection_method').single()
    setBusy(false)
    if (error || !data) return setErr(error?.message || 'המחיר לא נשמר במסד')
    onSaved({ price: Number(data.price), checked_at: data.checked_at, collection_method: 'manual' }, { ok: true, text: `המחיר עודכן ידנית ל-${ils(data.price)}` })
  }
  return (
    <div className="cmp-addform cmp-inline-form" onClick={e => e.stopPropagation()}>
      <div className="fields-grid">
        <div className="field"><label>מחיר חדש (₪, כולל מע״מ)</label>
          <input type="number" inputMode="decimal" min="0" step="0.01" dir="ltr" value={price} onChange={e => setPrice(e.target.value)} autoFocus placeholder={offer.price != null ? String(offer.price) : ''} /></div>
        <div className="field"><label>הערה (לא חובה)</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="למשל: מבצע סוף שבוע" /></div>
      </div>
      <p className="cmp-note">נשמרת תצפית מחיר חדשה עם הקישור הנוכחי. ההיסטוריה הקודמת נשארת.</p>
      {err && <div className="err-inline">{err}</div>}
      <div className="rv-actions">
        <button className="rv-btn rv-approve" disabled={busy} onClick={save}>{busy ? 'שומר...' : 'שמירת מחיר'}</button>
        <button className="rv-btn rv-ghost" disabled={busy} onClick={onCancel}>ביטול</button>
      </div>
    </div>
  )
}

// ---------- ניהול ועריכת חנויות ----------

function StoresModal({ stores, onClose, onEdit }) {
  const [counts, setCounts] = useState(null)
  useEffect(() => {
    supabase.from('competitor_offers').select('store_id').then(({ data }) =>
      setCounts((data || []).reduce((a, x) => { a[x.store_id] = (a[x.store_id] || 0) + 1; return a }, {})))
  }, [])
  const sorted = [...stores].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <h2>ניהול מתחרים</h2>
        <div className="table-wrap cmp-hist">
          <table className="data-table">
            <thead><tr><th>עדיפות</th><th>חנות</th><th>אתר</th><th>הצעות</th><th>סטטוס</th><th></th></tr></thead>
            <tbody>
              {sorted.map(s => (
                <tr key={s.id} onClick={() => onEdit(s)}>
                  <td>{s.priority ?? '—'}</td>
                  <td><b>{s.name}</b></td>
                  <td dir="ltr" className="cmp-sub">{s.domain}</td>
                  <td>{counts ? counts[s.id] || 0 : '…'}</td>
                  <td>{s.enabled === false ? <span className="cmp-review r-rejected">לא פעיל</span> : <span className="cmp-review r-approved">פעיל</span>}</td>
                  <td><button className="cmp-tool">✎ עריכה</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>סגירה</button></div>
      </div>
    </div>
  )
}

function StoreEditModal({ store, stores, onCancel, onSaved }) {
  const [v, setV] = useState({ name: store.name || '', priority: store.priority ?? '', enabled: store.enabled !== false, domain: store.domain || '' })
  const [offerCount, setOfferCount] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, x) => setV(s => ({ ...s, [k]: x }))
  useEffect(() => {
    supabase.from('competitor_offers').select('id', { count: 'exact', head: true }).eq('store_id', store.id)
      .then(({ count, error }) => setOfferCount(error ? -1 : count ?? 0))
  }, [store.id])
  // דומיין אפשר לשנות רק לחנות שאין לה מוצרים משויכים
  const domainLocked = offerCount !== 0

  async function save() {
    setErr('')
    if (!v.name.trim()) return setErr('צריך שם לחנות')
    const pr = v.priority === '' ? null : Number(v.priority)
    if (pr !== null && !Number.isFinite(pr)) return setErr('עדיפות צריכה להיות מספר')
    const patch = {}
    if (v.name.trim() !== store.name) patch.name = v.name.trim()
    if (pr !== (store.priority ?? null)) patch.priority = pr
    if (v.enabled !== (store.enabled !== false)) patch.enabled = v.enabled
    if (!domainLocked) {
      const d = cleanDomain(v.domain)
      if (!d || !d.includes('.')) return setErr('צריך דומיין תקין')
      if (d !== store.domain) {
        if (stores.some(s => s.id !== store.id && cleanDomain(s.domain) === d)) return setErr('יש כבר חנות עם הדומיין הזה')
        patch.domain = d
      }
    }
    if (!Object.keys(patch).length) return onCancel()
    setBusy(true)
    const { data, error } = await supabase.from('competitor_stores').update(patch).eq('id', store.id).select('id, name, domain, enabled, priority').maybeSingle()
    setBusy(false)
    if (error || !data) return setErr(error?.message || 'העדכון לא נשמר במסד (ייתכן שאין הרשאה)')
    onSaved(data)
  }

  return (
    <div className="overlay" style={{ zIndex: 55 }} onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <h2>עריכת חנות מתחרה</h2>
        <div className="field"><label>שם החנות</label><input value={v.name} onChange={e => set('name', e.target.value)} /></div>
        <div className="field"><label>עדיפות (מספר נמוך = עמודה ראשונה)</label><input type="number" dir="ltr" value={v.priority} onChange={e => set('priority', e.target.value)} /></div>
        <div className="field">
          <label>אתר (דומיין)</label>
          <input dir="ltr" value={v.domain} disabled={domainLocked} onChange={e => set('domain', e.target.value)} />
          {offerCount === null ? <div className="cmp-note">בודק מוצרים משויכים…</div>
            : domainLocked ? <div className="cmp-note">אי אפשר לשנות דומיין לחנות שכבר משויכים אליה מוצרים ({offerCount > 0 ? offerCount : 'לא ידוע כמה'}). אם האתר עבר כתובת, צריך להוסיף חנות חדשה.</div>
            : null}
        </div>
        <label className="cmp-check"><input type="checkbox" checked={v.enabled} onChange={e => set('enabled', e.target.checked)} /> חנות פעילה (מוצגת כעמודה בטבלה)</label>
        {err && <div className="err-inline">{err}</div>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>ביטול</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'שומר...' : 'שמירה'}</button>
        </div>
      </div>
    </div>
  )
}

// ---------- סנכרון מחירים ידני ----------
// מפעיל את competitor-price-scan הקיימת בקבוצות קטנות לפי next_after. הסריקה עצמה רק מוסיפה תצפיות מחיר
// על קישורים מאושרים (v_competitor_price_targets) — הממשק לא נוגע ב-competitor_offers בזמן סנכרון.

const SCAN_BATCH = 4
const RESULT_LABEL = { success: 'הצליח', failed: 'נכשל', error: 'שגיאה', blocked: 'נחסם', no_price: 'לא זוהה מחיר', not_found: 'העמוד לא נמצא', timeout: 'פג זמן' }

function ScanPanel({ rows, onDone }) {
  const [total, setTotal] = useState(null)
  const [lastAt, setLastAt] = useState(null)
  const [run, setRun] = useState(null) // { running, scanned, success, failed, updated, error, startedAt, finishedAt }
  const [failures, setFailures] = useState([])
  const [cancel, setCancel] = useState(false)
  const cancelRef = useRef(false)

  async function loadMeta() {
    const [t, a] = await Promise.all([
      supabase.from('v_competitor_price_targets').select('offer_id', { count: 'exact', head: true }),
      supabase.from('competitor_scan_attempts').select('attempted_at').order('attempted_at', { ascending: false }).limit(1),
    ])
    if (!t.error) setTotal(t.count ?? 0)
    if (!a.error) setLastAt(a.data?.[0]?.attempted_at || null)
  }
  useEffect(() => { loadMeta() }, [])

  async function start() {
    cancelRef.current = false; setCancel(false); setFailures([])
    const prev = new Map((rows || []).flatMap(r => [...r.offers, ...r.rejected]).map(o => [o.offer_id, o.price]))
    const startedAt = new Date().toISOString()
    const st = { running: true, scanned: 0, success: 0, failed: 0, updated: 0, error: '', startedAt, finishedAt: null }
    setRun({ ...st })
    let after = null
    for (let i = 0; i < 200; i++) {
      if (cancelRef.current) { st.error = 'הסריקה הופסקה ידנית'; break }
      const { data, error } = await supabase.functions.invoke('competitor-price-scan', { body: after ? { limit: SCAN_BATCH, after } : { limit: SCAN_BATCH } })
      if (error) {
        let msg = error.message
        try { const b = await error.context?.json?.(); if (b?.error || b?.message) msg = b.error || b.message } catch {}
        st.error = `הסריקה נעצרה: ${msg}`
        break
      }
      const results = Array.isArray(data?.results) ? data.results : []
      for (const r of results) {
        st.scanned++
        if (r.result === 'success' && r.price != null) {
          st.success++
          const was = prev.get(r.offer_id)
          if (was == null || Number(was) !== Number(r.price)) st.updated++
        } else st.failed++
      }
      setRun({ ...st })
      if (!data?.scanned || !data?.next_after || data.next_after === after) break
      after = data.next_after
    }
    st.running = false; st.finishedAt = new Date().toISOString()
    setRun({ ...st })
    // שגיאות אמיתיות מתוך competitor_scan_attempts של הריצה הזו
    const [att, tg] = await Promise.all([
      supabase.from('competitor_scan_attempts').select('id, offer_id, attempted_at, result, http_status, details, parsed_price')
        .gte('attempted_at', startedAt).neq('result', 'success').order('attempted_at', { ascending: false }),
      supabase.from('v_competitor_price_targets').select('offer_id, store_name, my_sku, competitor_url'),
    ])
    const names = new Map((tg.data || []).map(x => [x.offer_id, x]))
    if (!att.error) setFailures(att.data.map(x => ({ ...x, ...names.get(x.offer_id) })))
    loadMeta()
    onDone?.() // רענון נתוני הטבלה בלי טעינת העמוד
  }

  const r = run
  const tone = !r ? '' : r.running ? 'is-running' : r.error || r.failed > 0 || r.success === 0 ? 'is-warn' : 'is-ok'
  return (
    <div className={`cmp-scan ${tone}`}>
      <div className="cmp-scan-head">
        <div>
          <b>סנכרון מחירי מתחרים</b>
          <div className="cmp-sub">
            {total != null ? `${total} קישורים מאושרים במעקב` : '…'}
            {' · '}בדיקה אחרונה: {lastAt ? <span dir="ltr">{formatDateTime(lastAt)}</span> : 'עדיין לא בוצעה'}
          </div>
        </div>
        {r?.running
          ? <button className="btn-add btn-outline" disabled={cancel} onClick={() => { cancelRef.current = true; setCancel(true) }}>{cancel ? 'עוצר…' : 'עצירה'}</button>
          : <button className="btn-add" onClick={start} disabled={total === 0}>⟳ סנכרן מחירים עכשיו</button>}
      </div>
      {r && (
        <>
          <div className="cmp-scan-bar"><i style={{ width: `${total ? Math.min(100, (r.scanned / total) * 100) : 0}%` }} /></div>
          <div className="cmp-scan-stats">
            <span>נבדקו <b>{r.scanned}</b>{total != null ? ` מתוך ${total}` : ''}</span>
            <span className="pos">הצליחו <b>{r.success}</b></span>
            <span className={r.failed ? 'neg' : ''}>נכשלו או נחסמו <b>{r.failed}</b></span>
            <span>מחירים שהתעדכנו <b>{r.updated}</b></span>
          </div>
          {!r.running && (
            <div className={`cmp-scan-msg ${r.error || r.failed || !r.success ? 'warn' : 'ok'}`}>
              {r.error ? r.error
                : r.scanned === 0 ? 'לא נסרקו קישורים. ייתכן שאין קישורים מאושרים עם מעקב מחירים פעיל.'
                : r.success === 0 ? 'הסריקה הסתיימה, אבל לא זוהה אף מחיר.'
                : r.failed ? `הסריקה הסתיימה: ${r.success} מחירים זוהו, ${r.failed} קישורים נכשלו או נחסמו.`
                : `הסריקה הסתיימה בהצלחה: ${r.success} מחירים זוהו.`}
            </div>
          )}
          {failures.length > 0 && (
            <details className="cmp-scan-fails" open={failures.length <= 6}>
              <summary>פירוט כשלונות ({failures.length})</summary>
              <div className="table-wrap cmp-hist">
                <table className="data-table">
                  <thead><tr><th>חנות</th><th>מק״ט שלי</th><th>תוצאה</th><th>HTTP</th><th>פרטים</th></tr></thead>
                  <tbody>
                    {failures.map(x => (
                      <tr key={x.id}>
                        <td>{x.store_name || '—'}</td>
                        <td className="cmp-sku">{x.my_sku || '—'}</td>
                        <td><span className="neg">{RESULT_LABEL[x.result] || x.result}</span></td>
                        <td dir="ltr">{x.http_status ?? '—'}</td>
                        <td className="cmp-sub">{x.details || '—'}{x.competitor_url && <> · <a href={x.competitor_url} target="_blank" rel="noopener noreferrer">לעמוד ↗</a></>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}

// ---------- אישור התאמות ----------
// מקור: v_competitor_review_queue. שמירה: competitor_offers.review_status / review_notes לפי offer_id.
// reviewed_at / reviewed_by מתמלאים במסד אוטומטית.

const REJECT_REASONS = ['דגם אחר', 'מידה שונה', 'צבע / גימור שונה', 'כמות או מארז שונים', 'מוצר לא קשור']
const safeImg = u => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null)

function ReviewQueue({ onChanged }) {
  const [items, setItems] = useState(null)
  const [images, setImages] = useState({}) // product_id → image_url
  const [error, setError] = useState('')
  const [status, setStatus] = useState('pending')
  const [store, setStore] = useState('')
  const [q, setQ] = useState('')
  const [flash, setFlash] = useState(null) // { id, text, ok }
  // כרטיס שהוחלט עליו נשאר על המסך עד שמחליפים סינון, כדי לראות שהשמירה הצליחה ולתקן טעות
  const [justDecided, setJustDecided] = useState(() => new Set())
  const pickStatus = k => { setStatus(k); setJustDecided(new Set()) }

  async function load() {
    setError('')
    const [{ data, error: e }, img] = await Promise.all([
      supabase.from('v_competitor_review_queue').select('*'),
      supabase.from('products').select('id, image_url').not('image_url', 'is', null),
    ])
    if (e) { setError(e.message); setItems([]); return }
    if (!img.error) setImages(Object.fromEntries(img.data.map(p => [p.id, p.image_url])))
    setItems(data)
  }
  useEffect(() => { load() }, [])

  // שומר ומוודא מול המסד שהעדכון נקלט (השורה המוחזרת מה-update)
  async function decide(item, review_status, review_notes) {
    const { data, error: e } = await saveDecision(item.offer_id, review_status, review_notes)
    if (e) { setFlash({ id: item.offer_id, ok: false, text: e }); return false }
    setItems(list => list.map(x => x.offer_id === item.offer_id ? { ...x, ...data, offer_id: x.offer_id } : x))
    setJustDecided(d => new Set(d).add(item.offer_id))
    setFlash({ id: item.offer_id, ok: true, text: review_status === 'approved' ? 'אושר ונשמר' : 'נדחה ונשמר' })
    onChanged?.()
    return true
  }

  const counts = useMemo(() => (items || []).reduce((a, x) => { const k = x.review_status || 'pending'; a[k] = (a[k] || 0) + 1; a.all++; return a }, { all: 0, pending: 0, approved: 0, rejected: 0 }), [items])
  const stores = useMemo(() => [...new Map((items || []).map(x => [x.store_id, x.store_name])).entries()].sort((a, b) => (a[1] || '').localeCompare(b[1] || '', 'he')), [items])

  // מקובץ לפי מוצר שלי, כדי לראות את כל המועמדים של אותו מוצר יחד
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = (items || []).filter(x =>
      (status === 'all' || (x.review_status || 'pending') === status || justDecided.has(x.offer_id)) &&
      (!store || x.store_id === store) &&
      (!t || (x.product_name || '').toLowerCase().includes(t) || (x.product_sku || '').toLowerCase().includes(t) || (x.competitor_sku || '').toLowerCase().includes(t)))
    const m = new Map()
    for (const x of list) {
      if (!m.has(x.product_id)) m.set(x.product_id, { product: x, offers: [] })
      m.get(x.product_id).offers.push(x)
    }
    for (const g of m.values()) g.offers.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    return [...m.values()].sort((a, b) => (a.product.product_name || '').localeCompare(b.product.product_name || '', 'he'))
  }, [items, status, store, q, justDecided])

  if (items === null) return <div className="loading">טוען התאמות לאישור...</div>

  return (
    <div>
      {error && <div className="err-inline">{error}</div>}
      <p className="cmp-intro">כל כרטיס הוא מוצר שנמצא אצל מתחרה. אשר רק כשזה בדיוק אותו מוצר: רק התאמות מאושרות נכנסות למעקב המחירים ולחישובי ההשוואה.</p>

      <div className="cmp-filters">
        <div className="cmp-seg">
          {[['pending', 'ממתינים'], ['approved', 'מאושרים'], ['rejected', 'נדחים'], ['all', 'הכל']].map(([k, l]) => (
            <button key={k} className={status === k ? 'on' : ''} onClick={() => pickStatus(k)}>{l} <span>{counts[k] || 0}</span></button>
          ))}
        </div>
        <input className="search-input" type="search" placeholder="חיפוש מוצר או מק״ט" value={q} onChange={e => setQ(e.target.value)} />
        <select value={store} onChange={e => setStore(e.target.value)}>
          <option value="">כל המתחרים</option>
          {stores.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button className="btn-add" onClick={load}>רענון</button>
      </div>

      {groups.length === 0 && (
        <div className="cmp-empty">
          {status === 'pending' && counts.all ? 'אין התאמות שממתינות לאישור. כל הכבוד!' : 'אין התאמות להצגה בסינון הזה.'}
        </div>
      )}

      {groups.map(g => (
        <section key={g.product.product_id} className="rv-group">
          <header className="rv-group-head">
            <div>
              <ProductThumb src={images[g.product.product_id]} />
              <b>{g.product.product_name}</b>
              <span className="cmp-sku">{g.product.product_sku || 'ללא מק״ט'}</span>
              <span className="cmp-sub">{[g.product.category, g.product.subcategory].filter(Boolean).join(' / ')}</span>
            </div>
            <div className="rv-my-price">המחיר שלי <b>{g.product.my_price > 0 ? ils(g.product.my_price) : '—'}</b></div>
          </header>
          <div className="rv-cards">
            {g.offers.map(x => <ReviewCard key={x.offer_id} item={x} productImage={images[x.product_id]} onDecide={decide} flash={flash?.id === x.offer_id ? flash : null} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function ReviewCard({ item, productImage, onDecide, flash }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const st = item.review_status || 'pending'
  const g = gap({ price: num(item.competitor_price) }, num(item.my_price))
  const m = matchInfo(item.match_type)
  const myImg = safeImg(item.source_image_url) || safeImg(productImage), theirImg = safeImg(item.competitor_image_url)
  const evidence = item.matching_evidence && typeof item.matching_evidence === 'object' && !Array.isArray(item.matching_evidence)
    ? Object.entries(item.matching_evidence).filter(([, v]) => v != null && v !== '') : []
  const notes = [item.variant_notes, item.engraving_notes, item.package_notes, item.shipping_notes].filter(Boolean)

  async function run(status, notesText) {
    setBusy(true)
    const ok = await onDecide(item, status, notesText)
    setBusy(false)
    if (ok) { setRejecting(false); setReason('') }
  }

  return (
    <article className={`rv-card rv-${st}`}>
      <div className="rv-top">
        <ReviewBadge o={item} />
        <span className={`cmp-match ${m.cls}`}>{m.label}</span>
        {item.confidence != null && <span className="rv-conf">ביטחון {Math.round(item.confidence * 100)}%</span>}
      </div>

      <div className="rv-compare">
        <div className="rv-side">
          <div className="rv-label">המוצר שלי</div>
          {myImg ? <img className="rv-img" src={myImg} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="rv-img rv-noimg">אין תמונה</div>}
          <div className="rv-name">{item.product_name}</div>
          <div className="cmp-sku">{item.product_sku || 'ללא מק״ט'}</div>
          <div className="rv-price">{num(item.my_price) > 0 ? ils(item.my_price) : '—'}</div>
          {item.my_product_url && <a className="rv-link" href={item.my_product_url} target="_blank" rel="noopener noreferrer">פתיחת המוצר שלי ↗</a>}
        </div>
        <div className="rv-side">
          <div className="rv-label">{item.store_name}</div>
          {theirImg ? <img className="rv-img" src={theirImg} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="rv-img rv-noimg">אין תמונה</div>}
          <div className="rv-name">{item.competitor_title || <span className="cmp-dash">ללא כותרת</span>}</div>
          <div className="cmp-sku">{item.competitor_sku || 'ללא מק״ט'}</div>
          <div className="rv-price">
            {ils(item.competitor_price)}
            {g && <span className={`rv-gap ${g.diff < 0 ? 'neg' : g.diff > 0 ? 'pos' : ''}`}> <GapText g={g} /></span>}
          </div>
          {item.competitor_url && <a className="rv-link" href={item.competitor_url} target="_blank" rel="noopener noreferrer">פתיחת המוצר אצל המתחרה ↗</a>}
        </div>
      </div>

      {(evidence.length > 0 || notes.length > 0 || item.last_price_checked_at || item.sku_verification_source) && (
        <div className="rv-meta">
          <SkuSource o={item} />
          {item.last_price_checked_at && <div>מחיר נבדק <span dir="ltr">{formatDateTime(item.last_price_checked_at)}</span>{item.store_domain ? ` · ${item.store_domain}` : ''}</div>}
          {evidence.map(([k, v]) => <div key={k}><b>{k}:</b> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>)}
          {notes.length > 0 && <div>{notes.join(' · ')}</div>}
        </div>
      )}
      {st === 'rejected' && item.review_notes && <div className="rv-reason">סיבת דחייה: {item.review_notes}</div>}

      {isAutoApproved(item) ? null : rejecting ? (
        <div className="rv-reject">
          <div className="rv-label">למה זה לא אותו מוצר?</div>
          <div className="rv-reasons">
            {REJECT_REASONS.map(r => <button key={r} className={`cmp-chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>{r}</button>)}
          </div>
          <input type="text" placeholder="או כתוב סיבה" value={reason} onChange={e => setReason(e.target.value)} />
          <div className="rv-actions">
            <button className="rv-btn rv-reject-btn" disabled={busy || !reason.trim()} onClick={() => run('rejected', reason.trim())}>{busy ? 'שומר...' : 'שמירת דחייה'}</button>
            <button className="rv-btn rv-ghost" disabled={busy} onClick={() => { setRejecting(false); setReason('') }}>ביטול</button>
          </div>
        </div>
      ) : (
        <div className="rv-actions">
          <button className="rv-btn rv-approve" disabled={busy || st === 'approved'} onClick={() => run('approved')}>
            {busy ? 'שומר...' : st === 'approved' ? '✓ מאושר' : '✓ זה אותו מוצר — אשר'}
          </button>
          <button className="rv-btn rv-reject-btn" disabled={busy || st === 'rejected'} onClick={() => { setReason(st === 'rejected' ? item.review_notes || '' : ''); setRejecting(true) }}>
            {st === 'rejected' ? '✕ נדחה' : '✕ לא אותו מוצר — דחה'}
          </button>
        </div>
      )}
      {flash && <div className={`rv-flash ${flash.ok ? 'ok' : 'err'}`}>{flash.text}</div>}
    </article>
  )
}
