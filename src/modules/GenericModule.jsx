import { Fragment, useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { calcProduct, calcOrder, receiptsTotalWithVat } from '../lib/pricing'
import ExportButtons from '../components/ExportButtons'
import { groupOrders, engravingText, variationText } from '../lib/orders'
import { isCountedOrder, ORDER_STATUS_LABELS, FINANCE_START, formatDate, formatDateDots } from '../lib/format'
import { useNav } from '../contexts/NavContext'
import { useLiveReload } from '../lib/useLive'
import { wpOrderEditUrl, wpProductEditUrl } from '../lib/site'

export default function GenericModule({ config, focusId = null }) {
  const { user } = useAuth()
  const nav = useNav()
  const [rows, setRows] = useState(null)
  const [extra, setExtra] = useState(null) // נתוני עזר לעמודות (config.extraLoad), למשל מלאי להזמנות
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // row being edited, or {} for new, or null for closed
  const [statusFilter, setStatusFilter] = useState('הכל')
  const [search, setSearch] = useState('')
  const [filterValues, setFilterValues] = useState({})
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [selected, setSelected] = useState(() => new Set()) // מזהי שורות מסומנות לפעולה בכמות
  const [expanded, setExpanded] = useState(() => new Set()) // שורות פתוחות לפירוט (config.expandRender), למשל הזמנה עם כמה מוצרים
  const toggleExpand = id => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  // מיון בלחיצה על כותרת: ראשונה מהגדול לקטן, שנייה מהקטן לגדול, שלישית מבטלת
  const [sort, setSort] = useState({ key: null, dir: 'desc' })
  const toggleSort = key => setSort(s => s.key !== key ? { key, dir: 'desc' } : s.dir === 'desc' ? { key, dir: 'asc' } : { key: null, dir: 'desc' })

  function setFilter(key, val) { setFilterValues(v => ({ ...v, [key]: val })) }

  async function load() {
    setError('')
    const { data, error } = await supabase
      .from(config.table)
      .select(config.selectQuery || '*')
      .order(config.orderBy || 'created_at', { ascending: false })
    if (error) setError(error.message)
    else setRows(data)
    if (config.extraLoad) setExtra(await config.extraLoad(supabase))
  }

  useEffect(() => { load() }, [config.table])
  // מסך הזמנות: המלאי ליד כל מוצר מתעדכן מיד כשנקלטת תעודה או מגיעה הזמנה (config.liveTables)
  useLiveReload(load, config.liveTables || [])

  // אחרי הוספה/מחיקה של שורת פריט בתוך חלון ההזמנה: טוען מחדש ומשאיר את החלון פתוח על ההזמנה המעודכנת
  async function reloadOpenOrder() {
    const { data, error } = await supabase.from(config.table).select(config.selectQuery || '*').order(config.orderBy || 'created_at', { ascending: false })
    if (error) { setError(error.message); return }
    setRows(data)
    if (config.extraLoad) setExtra(await config.extraLoad(supabase))
    const base = config.rowFilter ? data.filter(config.rowFilter) : data
    const fresh = groupOrders(base).find(g => g.wc_order_id && g.wc_order_id === editing?.wc_order_id)
    if (fresh) setEditing(fresh)
  }

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
      if (fld.type === 'checkbox') payload[fld.key] = !!payload[fld.key]
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

  const idsOf = row => row.line_ids || [row.id]
  async function bulkDelete(list) {
    const n = list.length
    if (!window.confirm(`למחוק ${n} ${config.bulkNoun || 'רשומות'}? אי אפשר לבטל.${config.bulkSyncNote ? `\n${config.bulkSyncNote}` : ''}`)) return
    const { error } = await supabase.from(config.table).delete().in('id', list.flatMap(idsOf))
    if (error) { setError(error.message); return }
    setSelected(new Set()); load()
  }
  const bulkStatuses = [].concat(config.bulkStatus || [])
  async function bulkSetStatus(list, status, bs) {
    if (!status) return
    const label = bs.labels?.[status] || status
    if (!window.confirm(`לעדכן ${list.length} ${config.bulkNoun || 'רשומות'} לסטטוס "${label}"?${config.bulkSyncNote ? `\n${config.bulkSyncNote}` : ''}`)) return
    const { error } = await supabase.from(config.table).update({ [bs.field]: status === 'true' ? true : status === 'false' ? false : status }).in('id', list.flatMap(idsOf))
    if (error) { setError(error.message); return }
    setSelected(new Set()); load()
  }

  if (rows === null && error) return <div className="err-inline">שגיאה בטעינת {config.label}: {error}</div>
  if (rows === null) return <div className="loading">טוען {config.label}...</div>

  // הזמנות: שורות פריט מאותה הזמנת אתר מאוחדות להזמנה אחת
  const baseRows = config.rowFilter ? rows.filter(config.rowFilter) : rows
  const viewRows = config.groupOrders ? groupOrders(baseRows) : baseRows

  let filtered = (config.statusField && statusFilter !== 'הכל')
    ? viewRows.filter(r => r[config.statusField] === statusFilter)
    : viewRows

  if (config.searchField && search.trim()) {
    const q = search.trim().toLowerCase()
    const searchFields = [].concat(config.searchField)
    filtered = filtered.filter(r => searchFields.some(f => String(r[f] || '').toLowerCase().includes(q)))
  }

  for (const f of config.filters || []) {
    if (f.type === 'preset') {
      const opt = f.options.find(o => o.value === (filterValues[f.key] ?? f.options[0].value))
      if (opt?.test) filtered = filtered.filter(opt.test)
      continue
    }
    const val = filterValues[f.key]
    if (!val) continue
    if (f.type === 'month') filtered = filtered.filter(r => (r[f.key] || '').startsWith(val))
    else filtered = filtered.filter(r => r[f.key] === val)
  }

  if (config.sortable && sort.key) {
    const col = config.columns.find(c => c.key === sort.key)
    const get = col?.sortValue || (r => r[sort.key])
    const norm = v => (v === '' || v === undefined ? null : typeof v === 'string' && v.trim() !== '' && !isNaN(v) ? Number(v) : v)
    const sign = sort.dir === 'desc' ? -1 : 1
    filtered = [...filtered].sort((a, b) => {
      const x = norm(get(a)), y = norm(get(b))
      if (x === null && y === null) return 0
      if (x === null) return 1 // ריקים תמיד בסוף
      if (y === null) return -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign
      return String(x).localeCompare(String(y), 'he') * sign
    })
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

  const bulk = !!config.bulk
  const selectedRows = bulk ? filtered.filter(r => selected.has(r.id)) : []
  const allChecked = bulk && filtered.length > 0 && filtered.every(r => selected.has(r.id))
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(filtered.map(r => r.id)))
  const toggleOne = id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const colCount = config.columns.length + (config.statusField ? 1 : 0) + (bulk ? 1 : 0)

  return (
    <div>
      <div className="module-head">
        <h2>{config.icon} {config.label}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {config.isOrder && <ExportButtons sets={[
            { name: 'horaot', title: 'הזמנות', label: 'כל ההזמנות המוצגות', getData: () => ({
            headers: ['מס׳ הזמנה', 'תאריך כניסה', 'לקוח', 'טלפון', 'מוצר', 'מק״ט', 'כמות', 'מחיר ליחידה', 'סה״כ שורה', 'סטטוס הזמנה', 'סטטוס טיפול', 'לא לספק', 'כתובת משלוח', 'הערות'],
            rows: filtered.flatMap(o => (o.lines || [o]).map(l => [
              o.order_number || '', formatDateDots(o.order_date), o.customer_name || '', o.customer_phone || '',
              l.products?.name || l.product_name || '', l.sku || '', Number(l.quantity) || 0, Number(l.price) || 0, Number(l.total_amount) || 0,
              ORDER_STATUS_LABELS[o.wc_status] || o.wc_status || 'ידנית', o.handling_status || '', l.not_supplied ? 'לא לספק' : '', o.shipping_address || '', l.notes || o.notes || '',
            ])),
          }) },
            { name: 'harita', title: 'עבודת חריטה', label: '✒️ עבודת חריטה (רק שורות עם חריטה)', getData: () => ({
            headers: ['מס׳ הזמנה', 'תאריך כניסה', 'לקוח', 'מוצר', 'מק״ט', 'כמות', 'בחירת וריאציה', 'חריטה אישית (מה לחרוט)', 'סטטוס טיפול', 'הערות'],
            rows: filtered.flatMap(o => (o.lines || [o]).filter(l => l.has_engraving && !l.not_supplied).map(l => [
              o.order_number || '', formatDateDots(o.order_date), o.customer_name || '', l.products?.name || l.product_name || '', l.sku || '',
              Number(l.quantity) || 0, variationText(l.personalization), engravingText(l.engraving), o.handling_status || '', l.notes || o.notes || '',
            ])),
          }) },
          ]} />}
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
            f.type === 'preset' ? (
              <select key={f.key} value={filterValues[f.key] ?? f.options[0].value} onChange={e => setFilter(f.key, e.target.value)}>
                {f.options.map(o => <option key={o.value} value={o.value}>{o.label}{o.test ? ` (${viewRows.filter(o.test).length})` : ''}</option>)}
              </select>
            ) : f.type === 'relation' ? (
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

      {bulk && selectedRows.length > 0 && (
        <div className="bulk-bar">
          <b>נבחרו {selectedRows.length}</b>
          {bulkStatuses.map(bs => (
            <select key={bs.field} value="" onChange={e => bulkSetStatus(selectedRows, e.target.value, bs)}>
              <option value="">{bs.prompt || 'עדכון סטטוס ל...'}</option>
              {Object.entries(bs.labels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ))}
          <button className="btn-add" onClick={() => bulkDelete(selectedRows)}>מחיקה</button>
          <button className="btn-add" onClick={() => setSelected(new Set())}>ביטול בחירה</button>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {bulk && <th style={{ width: 32 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>}
              {config.columns.map(c => (config.sortable && !c.noSort)
                ? <th key={c.key} className="th-sort" onClick={() => toggleSort(c.key)} title="לחיצה למיון">
                    {c.label}<span className="sort-ind">{sort.key === c.key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ' ↕'}</span>
                  </th>
                : <th key={c.key}>{c.label}</th>)}
              {config.statusField && <th>סטטוס</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td className="empty-col" colSpan={colCount}>אין רשומות עדיין</td></tr>
            )}
            {groups.map(g => (
              <Fragment key={g.title ?? 'all'}>
                {g.title !== null && (
                  <tr className="group-row">
                    <td colSpan={colCount}>
                      <b>{g.title}</b> <span style={{ opacity: 0.6 }}>({g.rows.length})</span>
                    </td>
                  </tr>
                )}
                {g.rows.map(row => (
                  <Fragment key={row.id}>
                  <tr onClick={() => setEditing(row)}>
                    {bulk && <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} /></td>}
                    {config.columns.map(c => <td key={c.key}>{c.render ? c.render(row, nav, extra, { expanded: expanded.has(row.id), toggle: () => toggleExpand(row.id) }) : (row[c.key] ?? '—')}</td>)}
                    {config.statusField && (
                      <td onClick={e => e.stopPropagation()}>
                        <select value={row[config.statusField]} onChange={e => handleStatusChange(row.id, e.target.value)}>
                          {config.statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    )}
                  </tr>
                  {config.expandRender && expanded.has(row.id) && (
                    <tr className="expand-row">
                      <td colSpan={colCount}>{config.expandRender(row, nav, extra, { open: () => setEditing(row), close: () => toggleExpand(row.id), reload: load })}</td>
                    </tr>
                  )}
                  </Fragment>
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
          onOrderChanged={reloadOpenOrder}
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
  // ביטולים/החזרים/ממתינות לתשלום לא נספרים כמכירה; הסיכום נספר מ-FINANCE_START ואילך
  const rows = allRows.filter(isCountedOrder).filter(r => String(r.order_date || r.created_at || '').slice(0, 10) >= FINANCE_START)
  // הוצאות = קליטת תעודות ספק (כולל מע"מ) מאותו תאריך
  const [receipts, setReceipts] = useState(null)
  useEffect(() => {
    supabase.from('stock_receipts').select('doc_date, created_at, stock_receipt_items(quantity, unit_cost, discount_percent)')
      .then(({ data }) => setReceipts(data || []))
  }, [])
  const expenses = receipts ? receiptsTotalWithVat(receipts, FINANCE_START) : null
  const totalRevenue = rows.reduce((a, r) => a + (r.total_amount || 0), 0)
  const totalQuantity = rows.reduce((a, r) => a + (r.quantity || 0), 0)
  // רווח נטו רק על שורות עם עלות ידועה (מקושרות למוצר שהוזנה לו עלות)
  const lines = rows.map(calcOrder)
  const known = lines.filter(l => l.profit !== null)
  const totalProfit = known.reduce((a, l) => a + l.profit, 0)
  const unknownCount = lines.length - known.length
  const totalDiscount = lines.reduce((a, l) => a + l.discount, 0)
  const balance = expenses === null ? null : totalRevenue - expenses
  return (
    <div className="summary-row">
      <div className="summary-card"><span>סה"כ הזמנות (מ-{formatDate(FINANCE_START)})</span><b>{rows.length}</b></div>
      <div className="summary-card"><span>סה"כ יחידות</span><b>{totalQuantity}</b></div>
      <div className="summary-card"><span>סה"כ הכנסות (אחרי קופונים)</span><b className="pos">₪{totalRevenue.toFixed(0)}</b></div>
      <div className="summary-card"><span>הוצאות (קליטת תעודות, כולל מע"מ)</span><b className="neg">{expenses === null ? '...' : `₪${expenses.toFixed(0)}`}</b></div>
      <div className="summary-card"><span>הכנסות פחות הוצאות</span><b className={balance === null || balance >= 0 ? 'pos' : 'neg'}>{balance === null ? '...' : `₪${balance.toFixed(0)}`}</b></div>
      {totalDiscount > 0 && <div className="summary-card"><span>הנחות קופונים</span><b className="neg">−₪{totalDiscount.toFixed(0)}</b></div>}
      <div className="summary-card">
        <span>רווח נטו ממכירות{unknownCount > 0 ? ` (${unknownCount} הזמנות בלי עלות)` : ''}</span>
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

function OrderPanel({ order, onChanged }) {
  return (
    <>
      {order.wc_order_id && <OrderDetails order={order} />}
      <OrderLines order={order} onChanged={onChanged} />
      <OrderBreakdown order={order} />
    </>
  )
}

// כל הפריטים בהזמנה (מוצר ב-CRM, מק"ט באתר, כמות, מכירה, עלות ורווח לכל פריט)
function OrderLines({ order, onChanged }) {
  const nav = useNav()
  const lines = order.lines || [order]
  const [engEdit, setEngEdit] = useState(null) // { id, text }
  async function saveEngraving(l, text) {
    const t = String(text || '').trim()
    const { error } = await supabase.from('orders').update({ engraving: t, has_engraving: t !== '' }).eq('id', l.id)
    if (error) { window.alert('העדכון נכשל: ' + error.message); return }
    setEngEdit(null); onChanged?.()
  }
  const engSource = l => lines.find(x => x.id !== l.id && x.has_engraving)
  // "לא לספק": השורה נשארת בהזמנה (באדום), הכסף לא משתנה, והיא לא יורדת מהמלאי ולא נספרת כחוסר
  async function toggleSupplied(l) {
    const { error } = await supabase.from('orders').update({ not_supplied: !l.not_supplied }).eq('id', l.id)
    if (error) { window.alert('העדכון נכשל: ' + error.message); return }
    onChanged?.()
  }
  async function removeFree(l) {
    if (!window.confirm(`להסיר את "${l.products?.name || l.product_name}" מההזמנה? זה יחזיר אותו למלאי.`)) return
    const { error } = await supabase.from('orders').delete().eq('id', l.id).eq('manual_line', true)
    if (error) { window.alert('ההסרה נכשלה: ' + error.message); return }
    onChanged?.()
  }
  return (
    <>
    <div className="table-wrap" style={{ margin: '12px 0' }}>
      <table className="data-table">
        <thead>
          <tr><th>מוצר</th><th>מק"ט</th><th>כמות</th><th>מחיר ליחידה</th><th>הנחת קופון</th><th>מכירה</th><th>עלות</th><th>רווח לפני עמלה</th><th></th></tr>
        </thead>
        <tbody>
          {lines.map(l => {
            const name = l.products?.name || l.product_name || '—'
            const c = calcOrder({ lines: [l] })
            const href = wpProductEditUrl(l.products?.wc_product_id)
            return (
              <tr key={l.id} style={{ cursor: 'default' }}>
                <td>{l.product_id
                  ? <a href="#" className={l.not_supplied ? 'ns-name' : ''} onClick={e => { e.preventDefault(); nav.openRecord('products', l.product_id) }}>{name}</a>
                  : <span className={l.not_supplied ? 'ns-name' : ''}>{name}</span>}{l.not_supplied && <span className="sup-stock sup-out_of_stock" style={{ marginInlineStart: 8 }}>לא לספק</span>}{l.manual_line && <span className="sup-stock" style={{ marginInlineStart: 8 }} title="נוסף ידנית ללא חיוב">ללא חיוב</span>}<div style={{ fontSize: 12.5, marginTop: 2 }}>
                  {engEdit?.id === l.id ? (
                    <div>
                      <textarea rows={2} style={{ width: '100%' }} autoFocus placeholder="מה לחרוט על המוצר" value={engEdit.text} onChange={e => setEngEdit({ id: l.id, text: e.target.value })} />
                      <button type="button" className="cmp-tool" onClick={() => saveEngraving(l, engEdit.text)}>שמירה</button>{' '}
                      <button type="button" className="cmp-tool" onClick={() => setEngEdit(null)}>ביטול</button>
                    </div>
                  ) : (
                    <>
                      {l.has_engraving && <span>✒️ <b>חריטה אישית:</b> {engravingText(l.engraving)} </span>}
                      <button type="button" className="link-btn" onClick={() => setEngEdit({ id: l.id, text: engravingText(l.engraving) })}>{l.has_engraving ? 'ערוך חריטה' : '✒️ הוסף חריטה'}</button>
                      {!l.has_engraving && engSource(l) && <> · <button type="button" className="link-btn" title="מעתיק את החריטה מהמוצר האחר בהזמנה" onClick={() => saveEngraving(l, engravingText(engSource(l).engraving))}>העתק חריטה מ-{engSource(l).products?.name || engSource(l).product_name}</button></>}
                    </>
                  )}
                </div></td>
                <td>{l.sku && href ? <a href={href} target="_blank" rel="noreferrer">{l.sku}</a> : (l.sku || '—')}</td>
                <td>{l.quantity}</td>
                <td>₪{l.price}</td>
                <td>{Number(l.discount_amount) > 0 ? <span className="neg">−₪{l.discount_amount}</span> : '—'}</td>
                <td>₪{c.sale}</td>
                <td>{c.cost === null ? <span title="המוצר לא מקושר או שלא הוזנה לו עלות">—</span> : `₪${c.cost}`}</td>
                <td>{c.cost === null ? '—' : <span className={c.sale - c.cost >= 0 ? 'pos' : 'neg'}>₪{Math.round((c.sale - c.cost) * 100) / 100}</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="cmp-tool" title={l.not_supplied ? 'להחזיר לסטטוס רגיל: המוצר יסופק' : 'לא לספק את המוצר הזה (הכסף וההזמנה לא משתנים)'} onClick={() => toggleSupplied(l)}>{l.not_supplied ? '↺ יסופק' : '✕ לא לספק'}</button>
                  {l.manual_line && <button type="button" className="cmp-tool" style={{ marginInlineStart: 6 }} title="הסר מוצר ללא חיוב" onClick={() => removeFree(l)}>🗑 הסר</button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    {order.wc_order_id && <AddFreeProduct order={order} onChanged={onChanged} />}
    </>
  )
}

// הוספת מוצר ללא חיוב (מתנה) להזמנת אתר. נשמר כשורת פריט נוספת באותה הזמנה, במחיר 0, ויורד מהמלאי יחד עם ההזמנה.
// סנכרון ההזמנות מהאתר לא נוגע בשורה הזו (אין לה wc_line_item_id).
function AddFreeProduct({ order, onChanged }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [products, setProducts] = useState(null) // [{ id, name, sku, stock }]
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(null)
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copyEng, setCopyEng] = useState(true)
  // שורת חריטה להעתקה למוצר החדש: מוצר שסומן "לא לספק" קודם (בדרך כלל זה המוצר שהוחלף), אחרת הראשונה עם חריטה
  const engLines = (order.lines || [order]).filter(l => l.has_engraving)
  const engSrc = engLines.find(l => l.not_supplied) || engLines[0]

  useEffect(() => {
    if (!open || products) return
    Promise.all([
      supabase.from('products').select('id, name, sku, wc_product_id, wc_parent_id').eq('status', 'פעיל').is('wc_removed_at', null).order('name'),
      supabase.from('product_stock').select('product_id, stock'),
      supabase.from('product_merges').select('from_product_id'),
    ]).then(([p, st, mg]) => {
      if (p.error) { setErr(p.error.message); setProducts([]); return }
      const stock = new Map((st.data || []).map(x => [x.product_id, Number(x.stock) || 0]))
      const parents = new Set(p.data.map(x => x.wc_parent_id).filter(Boolean)) // מוצר ראשי שפוצל לוריאציות לא נבחר, רק הוריאציות
      const merged = new Set((mg.data || []).map(x => x.from_product_id)) // מוצר שאוחד למוצר אחר לא נבחר
      setProducts(p.data.filter(x => !parents.has(x.wc_product_id) && !merged.has(x.id)).map(x => ({ id: x.id, name: x.name, sku: x.sku || '', stock: stock.get(x.id) ?? 0 })))
    })
  }, [open])

  const needle = q.trim().toLowerCase()
  const matches = needle && products ? products.filter(x => x.name.toLowerCase().includes(needle) || x.sku.toLowerCase().includes(needle)).slice(0, 8) : []
  const first = order.lines?.[0] || order

  async function add() {
    if (!picked) return
    const n = Number(qty)
    if (!(n > 0)) { setErr('כמות חייבת להיות גדולה מ-0'); return }
    setBusy(true); setErr('')
    const t = (order.lines || [order]).find(l => !l.manual_line) || first
    const { error } = await supabase.from('orders').insert({
      product_id: picked.id, product_name: picked.name, sku: picked.sku, quantity: n, price: 0, discount_amount: 0, manual_line: true,
      created_by: user?.email || '',
      // פרטי ההזמנה והסטטוס מועתקים מהשורה הקיימת, כדי שהשורה תתנהג כחלק מההזמנה
      wc_order_id: t.wc_order_id, wc_line_item_id: null, order_number: t.order_number, order_date: t.order_date, wc_status: t.wc_status,
      handling_status: t.handling_status, received_by: t.received_by, delivered_notified_at: t.delivered_notified_at,
      customer_name: t.customer_name, customer_phone: t.customer_phone, customer_email: t.customer_email,
      shipping_address: t.shipping_address, shipping_method: t.shipping_method, payment_method: t.payment_method,
      customer_note: t.customer_note, coupons: t.coupons, shipping_total: t.shipping_total, order_total: t.order_total,
      ...(engSrc && copyEng ? { engraving: engSrc.engraving, has_engraving: true } : {}),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setPicked(null); setQ(''); setQty(1); setOpen(false)
    onChanged?.()
  }

  if (!open) return <button type="button" className="cmp-tool" onClick={() => setOpen(true)}>➕ הוסף מוצר ללא חיוב</button>
  return (
    <div className="free-add">
      <b>הוספת מוצר ללא חיוב</b>
      {picked ? (
        <div className="free-picked">
          <span>{picked.name}{picked.sku ? ` · ${picked.sku}` : ''} <span className="cmp-sub">(מלאי כעת: {picked.stock})</span></span>
          <button type="button" className="link-btn" onClick={() => setPicked(null)}>החלף</button>
        </div>
      ) : (
        <>
          <input autoFocus placeholder="חפש מוצר לפי שם או מק״ט" value={q} onChange={e => setQ(e.target.value)} />
          {products === null && <div className="cmp-sub">טוען מוצרים…</div>}
          {matches.map(m => (
            <button key={m.id} type="button" className="free-option" onClick={() => setPicked(m)}>
              {m.name} <span className="cmp-sub">{m.sku} · מלאי {m.stock}</span>
            </button>
          ))}
          {needle && products && matches.length === 0 && <div className="cmp-sub">לא נמצא מוצר</div>}
        </>
      )}
      {engSrc && (
        <label className="cmp-check" title="החריטה לא עוברת לבד כשמחליפים מוצר">
          <input type="checkbox" checked={copyEng} onChange={e => setCopyEng(e.target.checked)} />
          ✒️ להעתיק את החריטה מ"{engSrc.products?.name || engSrc.product_name}" למוצר החדש
        </label>
      )}
      <div className="free-row">
        <label>כמות <input type="number" min="1" style={{ width: 80 }} value={qty} onChange={e => setQty(e.target.value)} /></label>
        <button type="button" className="btn-add" disabled={!picked || busy} onClick={add}>{busy ? 'מוסיף…' : 'הוסף להזמנה'}</button>
        <button type="button" className="cmp-tool" onClick={() => { setOpen(false); setPicked(null); setQ('') }}>ביטול</button>
      </div>
      <div className="cmp-sub">
        המוצר נוסף בלי חיוב (מחיר 0), עלותו נספרת ברווח ההזמנה, והוא מוחזק במלאי יחד עם ההזמנה (יורד מהמלאי מיד).
      </div>
      {err && <div className="err-inline">{err}</div>}
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
        {item('סטטוס הזמנה', ORDER_STATUS_LABELS[order.wc_status] || order.wc_status)}
        <div className="field full" style={{ margin: 0 }}>{item('כתובת למשלוח', order.shipping_address)}</div>
        {item('שיטת משלוח', order.shipping_method)}
        {item('דמי משלוח', order.shipping_total != null ? `₪${order.shipping_total}` : null)}
        {item('אמצעי תשלום', order.payment_method)}
        {item('סה"כ ההזמנה (כולל משלוח)', order.order_total != null ? `₪${order.order_total}` : null)}
        {order.coupons && item('קופון', order.coupons)}
        <div className="field full" style={{ margin: 0 }}>{item('חריטה אישית', engravingText(order.engraving))}{variationText(order.personalization) && item('בחירת וריאציה / פרטים נוספים', variationText(order.personalization))}</div>
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

function EditModal({ config, initial, onCancel, onSave, onDelete, onOrderChanged }) {
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

        {config.isOrder && initial.id && <OrderPanel order={initial} onChanged={onOrderChanged} />}

        <div className="fields-grid">
        {fieldsFor.map(fld => (
          <div className={`field${fld.type === 'textarea' || fld.type === 'file' || fld.link ? ' full' : ''}`} key={fld.key}>
            <label>{fld.label}</label>
            {fld.type === 'textarea' ? (
              <textarea value={form[fld.key]} onChange={e => set(fld.key, e.target.value)} />
            ) : fld.type === 'select' ? (
              <select value={form[fld.key]} onChange={e => set(fld.key, e.target.value)}>
                {fld.options.map(o => <option key={o} value={o}>{o || '—'}</option>)}
              </select>
            ) : fld.type === 'checkbox' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                <input type="checkbox" checked={!!form[fld.key]} onChange={e => set(fld.key, e.target.checked)} /> כן
              </label>
            ) : fld.type === 'file' ? (
              <FileField value={form[fld.key]} onChange={v => set(fld.key, v)} />
            ) : fld.type === 'relation' ? (
              <RelationField value={form[fld.key]} onChange={v => set(fld.key, v)} relation={fld.relation} />
            ) : fld.link ? (
              <div className="link-input-row">
                <input type="text" dir="ltr" value={form[fld.key]} onChange={e => set(fld.key, e.target.value)} placeholder="https://" />
                {/^https?:\/\//i.test(String(form[fld.key] || '').trim())
                  ? <a className="btn-view-link" href={String(form[fld.key]).trim()} target="_blank" rel="noopener noreferrer">{fld.link} ↗</a>
                  : <span className="btn-view-link disabled" title="אין קישור תקין">{fld.link}</span>}
              </div>
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
