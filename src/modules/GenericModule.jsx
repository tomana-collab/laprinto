import { Fragment, useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { calcProduct, calcOrder } from '../lib/pricing'
import { groupOrders } from '../lib/orders'
import { isCountedOrder, ORDER_STATUS_LABELS } from '../lib/format'
import { useNav } from '../contexts/NavContext'
import { wpOrderEditUrl, wpProductEditUrl } from '../lib/site'

export default function GenericModule({ config, focusId = null }) {
  const { user } = useAuth()
  const nav = useNav()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // row being edited, or {} for new, or null for closed
  const [statusFilter, setStatusFilter] = useState('הכל')
  const [search, setSearch] = useState('')
  const [filterValues, setFilterValues] = useState({})
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  function setFilter(key, val) { setFilterValues(v => ({ ...v, [key]: val })) }

  async function load() {
    setError('')
    const { data, error } = await supabase
      .from(config.table)
      .select(config.selectQuery || '*')
      .order(config.orderBy || 'created_at', { ascending: false })
    if (error) setError(error.message)
    else setRows(data)
  }

  useEffect(() => { load() }, [config.table])

  // מעבר ממודול אחר (למשל הזמנה → מוצר): פותח את הרשומה לעריכה ברגע שהנתונים נטענו
  useEffect(() => {
    if (!focusId || !rows) return
    const row = rows.find(r => r.id === focusId)
    if (row) setEditing(row)
  }, [focusId, rows === null])

  // שדות manualOnly (מסונכרנים מהאתר) לא ניתנים לעריכה בהזמנת אתר
  const fieldsFor = rec => config.fields.filter(f => !(f.manualOnly && rec?.wc_order_id))

  function emptyForm() {
    const f = {}
    config.fields.forEach(fld => { f[fld.key] = fld.default || '' })
    return f
  }

  async function handleSave(form) {
    const payload = { ...form }
    fieldsFor(editing).forEach(fld => {
      if (fld.type === 'number') payload[fld.key] = payload[fld.key] === '' ? 0 : Number(payload[fld.key])
      if (fld.type === 'date' && payload[fld.key] === '') payload[fld.key] = null
      if (fld.type === 'file' && payload[fld.key] === '') payload[fld.key] = null
      if (fld.type === 'relation' && payload[fld.key] === '') payload[fld.key] = null
    })

    for (const fld of fieldsFor(editing)) {
      if (fld.type === 'file' && payload[fld.key] instanceof File) {
        const file = payload[fld.key]
        // ל-Storage מותרים רק תווי ASCII ב-key, אז שם הקובץ המקורי (שיכול לכלול עברית) לא
        // נכנס לנתיב — רק הסיומת שלו, כדי למנוע "Invalid key" בהעלאות עם שם עברי/מיוחד
        const extMatch = file.name.match(/\.([a-zA-Z0-9]+)$/)
        const ext = extMatch ? `.${extMatch[1]}` : ''
        const path = `${config.table}/${fld.key}/${crypto.randomUUID()}${ext}`
        const { error: upErr } = await supabase.storage.from('attachments').upload(path, file)
        if (upErr) { setError(upErr.message); return }
        payload[fld.key] = path
      }
    }

    if (editing && editing.id) {
      // הזמנה מאוחדת: העדכון חל על כל שורות הפריט שלה
      const ids = editing.line_ids || [editing.id]
      const { error } = await supabase.from(config.table).update(payload).in('id', ids)
      if (error) { setError(error.message); return }
    } else {
      payload.created_by = user?.email || ''
      if (config.statusField && !payload[config.statusField]) {
        payload[config.statusField] = config.statusOptions[0]
      }
      const { error } = await supabase.from(config.table).insert(payload)
      if (error) { setError(error.message); return }
    }
    setEditing(null)
    load()
  }

  async function handleSync() {
    setSyncing(true)
    setSyncMsg('')
    setError('')
    const { data, error } = await supabase.functions.invoke(config.syncFunction, { body: config.syncBody || {} })
    setSyncing(false)
    if (error) {
      let msg = error.message
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null)
        if (body?.error) msg = body.error
      }
      setError(msg)
      return
    }
    const r = data?.[config.syncBody?.target || 'products'] || {}
    setSyncMsg(`סונכרנו ${r.total ?? 0} ${config.syncNoun || 'רשומות'} מהאתר: ${r.inserted ?? 0} חדשות, ${r.updated ?? 0} עודכנו${r.errors?.length ? `, ${r.errors.length} שגיאות (${r.errors[0]})` : ''}`)
    load()
  }

  async function handleDelete(id) {
    const ids = editing?.line_ids || [id]
    const { error } = await supabase.from(config.table).delete().in('id', ids)
    if (error) { setError(error.message); return }
    setEditing(null)
    load()
  }

  async function handleStatusChange(id, status) {
    const { error } = await supabase.from(config.table).update({ [config.statusField]: status }).eq('id', id)
    if (error) { setError(error.message); return }
    load()
  }

  if (rows === null && error) return <div className="err-inline">שגיאה בטעינת {config.label}: {error}</div>
  if (rows === null) return <div className="loading">טוען {config.label}...</div>

  // הזמנות: שורות פריט מאותה הזמנת אתר מאוחדות להזמנה אחת
  const viewRows = config.groupOrders ? groupOrders(rows) : rows

  let filtered = (config.statusField && statusFilter !== 'הכל')
    ? viewRows.filter(r => r[config.statusField] === statusFilter)
    : viewRows

  if (config.searchField && search.trim()) {
    const q = search.trim().toLowerCase()
    const searchFields = [].concat(config.searchField)
    filtered = filtered.filter(r => searchFields.some(f => String(r[f] || '').toLowerCase().includes(q)))
  }

  for (const f of config.filters || []) {
    const val = filterValues[f.key]
    if (!val) continue
    if (f.type === 'month') filtered = filtered.filter(r => (r[f.key] || '').startsWith(val))
    else filtered = filtered.filter(r => r[f.key] === val)
  }

  // חילוק לקבוצות (למשל מוצרים לפי קטגוריה): קבוצות ממוינות לפי שם, "ללא קטגוריה" בסוף
  let groups = [{ title: null, rows: filtered }]
  if (config.groupBy) {
    const { key, empty } = config.groupBy
    const byKey = new Map()
    for (const r of filtered) {
      const k = r[key] || empty
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(r)
    }
    groups = [...byKey.entries()]
      .sort(([a], [b]) => (a === empty) - (b === empty) || a.localeCompare(b, 'he'))
      .map(([title, rs]) => ({ title, rows: rs }))
  }

  return (
    <div>
      <div className="module-head">
        <h2>{config.icon} {config.label}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {config.syncFunction && (
            <button className="btn-add" onClick={handleSync} disabled={syncing}>
              {syncing ? 'מסנכרן...' : (config.syncButtonLabel || '↻ סנכרן מהאתר')}
            </button>
          )}
          <button className="btn-add" onClick={() => setEditing(emptyForm())}>+ חדש</button>
        </div>
      </div>

      {syncMsg && <div className="summary-row" style={{ padding: '8px 12px' }}>{syncMsg}</div>}

      {error && <div className="err-inline">{error}</div>}

      {config.isProduct && <ProductsSummary rows={viewRows} />}
      {config.isExpense && <ExpensesSummary rows={viewRows} />}
      {config.isExpense && <PaidBySummary rows={viewRows} />}
      {config.isOrder && <OrdersSummary rows={viewRows} />}

      {config.statusField && (
        <div className="status-filter">
          {['הכל', ...config.statusOptions].map(s => (
            <button
              key={s}
              className={statusFilter === s ? 'active' : ''}
              onClick={() => setStatusFilter(s)}
            >{s}</button>
          ))}
        </div>
      )}

      {(config.searchField || config.filters) && (
        <div className="filter-bar">
          {config.searchField && (
            <input
              type="text"
              className="search-input"
              placeholder={config.searchLabel || 'חיפוש'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          )}
          {(config.filters || []).map(f => (
            f.type === 'relation' ? (
              <RelationField
                key={f.key}
                value={filterValues[f.key] || ''}
                onChange={v => setFilter(f.key, v)}
                relation={f.relation}
                placeholder={f.label}
              />
            ) : f.type === 'values' ? (
              <select
                key={f.key}
                value={filterValues[f.key] || ''}
                onChange={e => setFilter(f.key, e.target.value)}
              >
                <option value="">{f.label}</option>
                {[...new Set(viewRows.map(r => r[f.key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')).map(v => (
                  <option key={v} value={v}>{f.labels?.[v] || v}</option>
                ))}
              </select>
            ) : f.type === 'month' ? (
              <input
                key={f.key}
                type="month"
                value={filterValues[f.key] || ''}
                onChange={e => setFilter(f.key, e.target.value)}
              />
            ) : null
          ))}
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {config.columns.map(c => <th key={c.key}>{c.label}</th>)}
              {config.statusField && <th>סטטוס</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td className="empty-col" colSpan={config.columns.length + (config.statusField ? 1 : 0)}>אין רשומות עדיין</td></tr>
            )}
            {groups.map(g => (
              <Fragment key={g.title ?? 'all'}>
                {g.title !== null && (
                  <tr className="group-row">
                    <td colSpan={config.columns.length + (config.statusField ? 1 : 0)}>
                      <b>{g.title}</b> <span style={{ opacity: 0.6 }}>({g.rows.length})</span>
                    </td>
                  </tr>
                )}
                {g.rows.map(row => (
                  <tr key={row.id} onClick={() => setEditing(row)}>
                    {config.columns.map(c => <td key={c.key}>{c.render ? c.render(row, nav) : (row[c.key] ?? '—')}</td>)}
                    {config.statusField && (
                      <td onClick={e => e.stopPropagation()}>
                        <select value={row[config.statusField]} onChange={e => handleStatusChange(row.id, e.target.value)}>
                          {config.statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    )}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditModal
          config={config}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
          onDelete={editing.id ? () => handleDelete(editing.id) : null}
        />
      )}
    </div>
  )
}

function ProductsSummary({ rows }) {
  const totalCost = rows.reduce((a, r) => a + (r.cost || 0) + (r.extra_expenses || 0), 0)
  const totalRevenue = rows.reduce((a, r) => a + (r.price || 0), 0)
  const totalProfit = rows.reduce((a, r) => a + (r.profit || 0), 0)
  return (
    <div className="summary-row">
      <div className="summary-card"><span>סה"כ עלויות ליחידה</span><b>₪{totalCost.toFixed(0)}</b></div>
      <div className="summary-card"><span>סה"כ מחירי מכירה</span><b>₪{totalRevenue.toFixed(0)}</b></div>
      <div className="summary-card"><span>סה"כ רווח פוטנציאלי</span><b className={totalProfit >= 0 ? 'pos' : 'neg'}>₪{totalProfit.toFixed(0)}</b></div>
    </div>
  )
}

function ExpensesSummary({ rows }) {
  const total = rows.reduce((a, r) => a + (r.amount || 0), 0)
  const paid = rows.filter(r => r.status === 'שולם').reduce((a, r) => a + (r.amount || 0), 0)
  const pending = total - paid
  return (
    <div className="summary-row">
      <div className="summary-card"><span>סה"כ הוצאות</span><b>₪{total.toFixed(0)}</b></div>
      <div className="summary-card"><span>שולם</span><b className="pos">₪{paid.toFixed(0)}</b></div>
      <div className="summary-card"><span>ממתין לתשלום</span><b className="neg">₪{pending.toFixed(0)}</b></div>
    </div>
  )
}

function OrdersSummary({ rows: allRows }) {
  // ביטולים/החזרים/ממתינות לתשלום לא נספרים כמכירה
  const rows = allRows.filter(isCountedOrder)
  const totalRevenue = rows.reduce((a, r) => a + (r.total_amount || 0), 0)
  const totalQuantity = rows.reduce((a, r) => a + (r.quantity || 0), 0)
  // רווח נטו רק על שורות עם עלות ידועה (מקושרות למוצר שהוזנה לו עלות)
  const lines = rows.map(calcOrder)
  const known = lines.filter(l => l.profit !== null)
  const totalProfit = known.reduce((a, l) => a + l.profit, 0)
  const unknownCount = lines.length - known.length
  const totalDiscount = lines.reduce((a, l) => a + l.discount, 0)
  return (
    <div className="summary-row">
      <div className="summary-card"><span>סה"כ הזמנות</span><b>{rows.length}</b></div>
      <div className="summary-card"><span>סה"כ יחידות</span><b>{totalQuantity}</b></div>
      <div className="summary-card"><span>סה"כ הכנסות (אחרי קופונים)</span><b className="pos">₪{totalRevenue.toFixed(0)}</b></div>
      {totalDiscount > 0 && <div className="summary-card"><span>הנחות קופונים</span><b className="neg">−₪{totalDiscount.toFixed(0)}</b></div>}
      <div className="summary-card">
        <span>רווח נטו{unknownCount > 0 ? ` (${unknownCount} הזמנות בלי עלות)` : ''}</span>
        <b className={totalProfit >= 0 ? 'pos' : 'neg'}>₪{totalProfit.toFixed(0)}</b>
      </div>
    </div>
  )
}

function PaidBySummary({ rows }) {
  const totals = {}
  for (const r of rows) {
    const name = r.team_members?.full_name || 'לא צוין'
    totals[name] = (totals[name] || 0) + (r.amount || 0)
  }
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null

  return (
    <div className="table-wrap paid-by-summary">
      <table className="data-table">
        <thead>
          <tr><th>מי שילם</th><th>סה"כ ששילם</th></tr>
        </thead>
        <tbody>
          {entries.map(([name, total]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>₪{total.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FileField({ value, onChange }) {
  const [busy, setBusy] = useState(false)
  const isExisting = typeof value === 'string' && value
  const isPending = value instanceof File

  async function handleView() {
    setBusy(true)
    const { data, error } = await supabase.storage.from('attachments').createSignedUrl(value, 120)
    setBusy(false)
    if (!error && data) window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="file-field">
      {isExisting && (
        <div className="file-current">
          <button type="button" onClick={handleView} disabled={busy}>{busy ? 'טוען...' : '📎 צפייה בקובץ הקיים'}</button>
          <button type="button" className="file-remove" onClick={() => onChange(null)}>הסרה</button>
        </div>
      )}
      {isPending && <div className="file-current"><span>📎 {value.name} (חדש)</span></div>}
      {!isExisting && (
        <input type="file" accept="image/*,application/pdf" onChange={e => onChange(e.target.files[0] || null)} />
      )}
    </div>
  )
}

function RelationField({ value, onChange, relation, placeholder = '— ללא —' }) {
  const [options, setOptions] = useState(null)

  useEffect(() => {
    supabase.from(relation.table).select(`id, ${relation.labelField}`).order(relation.labelField)
      .then(({ data }) => setOptions(data || []))
  }, [relation.table, relation.labelField])

  if (options === null) return <div className="loading">טוען...</div>

  return (
    <select value={value || ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.id} value={o.id}>{o[relation.labelField]}</option>)}
    </select>
  )
}

function SetPasswordAction({ email }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function handleSet() {
    setMsg(null)
    if (!email) { setMsg({ type: 'err', text: 'יש למלא קודם מייל' }); return }
    if (password.length < 6) { setMsg({ type: 'err', text: 'סיסמה חייבת להכיל לפחות 6 תווים' }); return }
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('set-team-member-password', {
      body: { email, password },
    })
    setBusy(false)
    if (error) {
      let text = error.message
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null)
        if (body?.error) text = body.error
      }
      setMsg({ type: 'err', text })
      return
    }
    setMsg({ type: 'ok', text: data?.action === 'created' ? 'נוצר חשבון התחברות חדש' : 'הסיסמה עודכנה' })
    setPassword('')
  }

  return (
    <div className="field">
      <label>סיסמת התחברות (יוצר/מאפס login בפועל למייל שלמעלה)</label>
      <div className="password-action-row">
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="סיסמה חדשה" />
        <button type="button" className="btn btn-ghost" onClick={handleSet} disabled={busy}>{busy ? '...' : 'הגדר סיסמה'}</button>
      </div>
      {msg && <div className={`settings-msg ${msg.type}`}>{msg.text}</div>}
    </div>
  )
}

function OrderPanel({ order }) {
  return (
    <>
      {order.wc_order_id && <OrderDetails order={order} />}
      <OrderLines order={order} />
      <OrderBreakdown order={order} />
    </>
  )
}

// כל הפריטים בהזמנה (מוצר ב-CRM, מק"ט באתר, כמות, מכירה, עלות ורווח לכל פריט)
function OrderLines({ order }) {
  const nav = useNav()
  const lines = order.lines || [order]
  return (
    <div className="table-wrap" style={{ margin: '12px 0' }}>
      <table className="data-table">
        <thead>
          <tr><th>מוצר</th><th>מק"ט</th><th>כמות</th><th>מחיר ליחידה</th><th>הנחת קופון</th><th>מכירה</th><th>עלות</th><th>רווח לפני עמלה</th></tr>
        </thead>
        <tbody>
          {lines.map(l => {
            const name = l.products?.name || l.product_name || '—'
            const c = calcOrder({ lines: [l] })
            const href = wpProductEditUrl(l.products?.wc_product_id)
            return (
              <tr key={l.id} style={{ cursor: 'default' }}>
                <td>{l.product_id
                  ? <a href="#" onClick={e => { e.preventDefault(); nav.openRecord('products', l.product_id) }}>{name}</a>
                  : name}</td>
                <td>{l.sku && href ? <a href={href} target="_blank" rel="noreferrer">{l.sku}</a> : (l.sku || '—')}</td>
                <td>{l.quantity}</td>
                <td>₪{l.price}</td>
                <td>{Number(l.discount_amount) > 0 ? <span className="neg">−₪{l.discount_amount}</span> : '—'}</td>
                <td>₪{c.sale}</td>
                <td>{c.cost === null ? <span title="המוצר לא מקושר או שלא הוזנה לו עלות">—</span> : `₪${c.cost}`}</td>
                <td>{c.cost === null ? '—' : <span className={c.sale - c.cost >= 0 ? 'pos' : 'neg'}>₪{Math.round((c.sale - c.cost) * 100) / 100}</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// חישוב הרווח שלב אחר שלב, כולל הנחת הקופון שהלקוח קיבל
function OrderBreakdown({ order }) {
  const c = calcOrder(order)
  const row = (label, value, cls, bold) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span><b className={cls}>{value}</b>
    </div>
  )
  return (
    <div className="summary-card" style={{ display: 'block', margin: '12px 0', maxWidth: 520 }}>
      {row('מחיר מכירה לפני הנחה', `₪${c.before}`)}
      {c.discount > 0 && row(`הנחת קופון${order.coupons ? ` (${order.coupons})` : ''}`, `−₪${c.discount}`, 'neg')}
      {row('מכירה בפועל (מה שהלקוח שילם על המוצרים)', `₪${c.sale}`)}
      {row('עלות כולל מע"מ והוצאות נלוות', c.cost === null ? `חסרה עלות: ${c.missing.join(', ')}` : `−₪${c.cost}`)}
      {row('עמלת סליקה (0.75% + מע"מ)', `−₪${c.fee}`)}
      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '6px 0' }} />
      {row('רווח נטו', c.profit === null ? '—' : `₪${c.profit}`, c.profit === null ? '' : (c.profit >= 0 ? 'pos' : 'neg'), true)}
    </div>
  )
}

function OrderDetails({ order }) {
  const phoneDigits = (order.customer_phone || '').replace(/\D/g, '')
  // וואטסאפ: מספר ישראלי שמתחיל ב-0 → קידומת 972
  const waNumber = phoneDigits.startsWith('0') ? `972${phoneDigits.slice(1)}` : phoneDigits
  const item = (label, value) => (
    <div style={{ padding: '4px 0' }}>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>{label}</div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{value || '—'}</div>
    </div>
  )
  return (
    <div className="summary-card" style={{ display: 'block', margin: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b>פרטי הזמנה #{order.order_number} מהאתר</b>
        <a href={wpOrderEditUrl(order.wc_order_id)} target="_blank" rel="noreferrer">פתח באתר ↗</a>
      </div>
      <div className="fields-grid cols-4" style={{ marginTop: 8 }}>
        {item('שם המזמין', order.customer_name)}
        {item('טלפון', phoneDigits
          ? <span><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a>{' · '}<a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer">וואטסאפ</a></span>
          : null)}
        {item('אימייל', order.customer_email ? <a href={`mailto:${order.customer_email}`}>{order.customer_email}</a> : null)}
        {item('סטטוס באתר', ORDER_STATUS_LABELS[order.wc_status] || order.wc_status)}
        <div className="field full" style={{ margin: 0 }}>{item('כתובת למשלוח', order.shipping_address)}</div>
        {item('שיטת משלוח', order.shipping_method)}
        {item('דמי משלוח', order.shipping_total != null ? `₪${order.shipping_total}` : null)}
        {item('אמצעי תשלום', order.payment_method)}
        {item('סה"כ ההזמנה (כולל משלוח)', order.order_total != null ? `₪${order.order_total}` : null)}
        {order.coupons && item('קופון', order.coupons)}
        <div className="field full" style={{ margin: 0 }}>{item('התאמה אישית', order.personalization)}</div>
        <div className="field full" style={{ margin: 0 }}>{item('הערת הלקוח', order.customer_note)}</div>
      </div>
    </div>
  )
}

function ProductBreakdown({ form }) {
  const c = calcProduct(form)
  const row = (label, value, cls) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span>{label}</span><b className={cls}>{value}</b>
    </div>
  )
  return (
    <div className="summary-card" style={{ display: 'block', margin: '12px 0' }}>
      {row('עלות אחרי הנחת ספק', `₪${c.costAfterDiscount}`)}
      {row('עלות כולל מע"מ 18%', `₪${c.costWithVat}`)}
      {row('עמלת סליקה (0.75% + מע"מ)', `₪${c.clearingFee}`)}
      {c.extra > 0 && row('הוצאות נלוות', `₪${c.extra}`)}
      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '6px 0' }} />
      {row('רווח סופי', `₪${c.profit} (${c.margin}%)`, c.profit >= 0 ? 'pos' : 'neg')}
    </div>
  )
}

function EditModal({ config, initial, onCancel, onSave, onDelete }) {
  // שדות manualOnly (מסונכרנים מהאתר) לא ניתנים לעריכה בהזמנת אתר
  const fieldsFor = config.fields.filter(f => !(f.manualOnly && initial.wc_order_id))
  const [form, setForm] = useState(() => {
    const f = {}
    fieldsFor.forEach(fld => { f[fld.key] = initial[fld.key] ?? fld.default ?? '' })
    return f
  })

  function set(key, val) { setForm(f => ({ ...f, [key]: val })) }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className={`modal${config.modalWide ? ' wide' : ''}`}>
        <h2>{initial.id ? (initial.order_number ? `הזמנה #${initial.order_number}` : 'עריכה') : `${config.label.slice(0, -1) || config.label} חדש`}</h2>

        {config.isOrder && initial.id && <OrderPanel order={initial} />}

        <div className="fields-grid">
        {fieldsFor.map(fld => (
          <div className={`field${fld.type === 'textarea' || fld.type === 'file' ? ' full' : ''}`} key={fld.key}>
            <label>{fld.label}</label>
            {fld.type === 'textarea' ? (
              <textarea value={form[fld.key]} onChange={e => set(fld.key, e.target.value)} />
            ) : fld.type === 'select' ? (
              <select value={form[fld.key]} onChange={e => set(fld.key, e.target.value)}>
                {fld.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : fld.type === 'file' ? (
              <FileField value={form[fld.key]} onChange={v => set(fld.key, v)} />
            ) : fld.type === 'relation' ? (
              <RelationField value={form[fld.key]} onChange={v => set(fld.key, v)} relation={fld.relation} />
            ) : (
              <input
                type={fld.type === 'number' ? 'number' : fld.type === 'date' ? 'date' : 'text'}
                value={form[fld.key]}
                onChange={e => set(fld.key, e.target.value)}
              />
            )}
          </div>
        ))}
        </div>

        {config.isProduct && <ProductBreakdown form={form} />}

        {config.hasLoginAction && <SetPasswordAction email={form.email} />}

        <div className="modal-actions">
          {onDelete && <button className="btn btn-danger" onClick={onDelete}>מחיקה</button>}
          <button className="btn btn-ghost" onClick={onCancel}>ביטול</button>
          <button className="btn btn-primary" onClick={() => onSave(form)}>שמירה</button>
        </div>
      </div>
    </div>
  )
}
