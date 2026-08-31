import { useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'

export default function GenericModule({ config }) {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // row being edited, or {} for new, or null for closed
  const [statusFilter, setStatusFilter] = useState('הכל')
  const [search, setSearch] = useState('')
  const [filterValues, setFilterValues] = useState({})

  function setFilter(key, val) { setFilterValues(v => ({ ...v, [key]: val })) }

  async function load() {
    setError('')
    const { data, error } = await supabase
      .from(config.table)
      .select(config.selectQuery || '*')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setRows(data)
  }

  useEffect(() => { load() }, [config.table])

  function emptyForm() {
    const f = {}
    config.fields.forEach(fld => { f[fld.key] = fld.default || '' })
    return f
  }

  async function handleSave(form) {
    const payload = { ...form }
    config.fields.forEach(fld => {
      if (fld.type === 'number') payload[fld.key] = payload[fld.key] === '' ? 0 : Number(payload[fld.key])
      if (fld.type === 'date' && payload[fld.key] === '') payload[fld.key] = null
      if (fld.type === 'file' && payload[fld.key] === '') payload[fld.key] = null
      if (fld.type === 'relation' && payload[fld.key] === '') payload[fld.key] = null
    })

    for (const fld of config.fields) {
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
      const { error } = await supabase.from(config.table).update(payload).eq('id', editing.id)
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

  async function handleDelete(id) {
    const { error } = await supabase.from(config.table).delete().eq('id', id)
    if (error) { setError(error.message); return }
    setEditing(null)
    load()
  }

  async function handleStatusChange(id, status) {
    const { error } = await supabase.from(config.table).update({ [config.statusField]: status }).eq('id', id)
    if (error) { setError(error.message); return }
    load()
  }

  if (rows === null) return <div className="loading">טוען {config.label}...</div>

  let filtered = (config.statusField && statusFilter !== 'הכל')
    ? rows.filter(r => r[config.statusField] === statusFilter)
    : rows

  if (config.searchField && search.trim()) {
    const q = search.trim().toLowerCase()
    filtered = filtered.filter(r => (r[config.searchField] || '').toLowerCase().includes(q))
  }

  for (const f of config.filters || []) {
    const val = filterValues[f.key]
    if (!val) continue
    if (f.type === 'month') filtered = filtered.filter(r => (r[f.key] || '').startsWith(val))
    else filtered = filtered.filter(r => r[f.key] === val)
  }

  return (
    <div>
      <div className="module-head">
        <h2>{config.icon} {config.label}</h2>
        <button className="btn-add" onClick={() => setEditing(emptyForm())}>+ חדש</button>
      </div>

      {error && <div className="err-inline">{error}</div>}

      {config.isProduct && <ProductsSummary rows={rows} />}
      {config.isExpense && <ExpensesSummary rows={rows} />}

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
            {filtered.map(row => (
              <tr key={row.id} onClick={() => setEditing(row)}>
                {config.columns.map(c => <td key={c.key}>{c.render ? c.render(row) : (row[c.key] ?? '—')}</td>)}
                {config.statusField && (
                  <td onClick={e => e.stopPropagation()}>
                    <select value={row[config.statusField]} onChange={e => handleStatusChange(row.id, e.target.value)}>
                      {config.statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                )}
              </tr>
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

function EditModal({ config, initial, onCancel, onSave, onDelete }) {
  const [form, setForm] = useState(() => {
    const f = {}
    config.fields.forEach(fld => { f[fld.key] = initial[fld.key] ?? fld.default ?? '' })
    return f
  })

  function set(key, val) { setForm(f => ({ ...f, [key]: val })) }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal">
        <h2>{initial.id ? 'עריכה' : `${config.label.slice(0, -1) || config.label} חדש`}</h2>

        {config.fields.map(fld => (
          <div className="field" key={fld.key}>
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
