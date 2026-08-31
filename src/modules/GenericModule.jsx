import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'

export default function GenericModule({ config }) {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // row being edited, or {} for new, or null for closed
  const [statusFilter, setStatusFilter] = useState('הכל')

  async function load() {
    setError('')
    const { data, error } = await supabase
      .from(config.table)
      .select('*')
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
    })

    for (const fld of config.fields) {
      if (fld.type === 'file' && payload[fld.key] instanceof File) {
        const file = payload[fld.key]
        const path = `${config.table}/${fld.key}/${crypto.randomUUID()}-${file.name}`
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

  const filtered = (config.statusField && statusFilter !== 'הכל')
    ? rows.filter(r => r[config.statusField] === statusFilter)
    : rows

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

      <div className="list">
        {filtered.length === 0 && <div className="empty-col">אין רשומות עדיין</div>}
        {filtered.map(row => (
          <div key={row.id} className="row-card" onClick={() => setEditing(row)}>
            <div className="row-top">
              <b>{row[config.titleField]}</b>
              {config.statusField && (
                <span className={`badge badge-${slug(row[config.statusField])}`}>{row[config.statusField]}</span>
              )}
            </div>
            {row.description && <div className="row-desc">{row.description}</div>}
            {config.isProduct && (
              <div className="profit-line">
                עלות: ₪{row.cost} · מחיר: ₪{row.price} ·
                <b className={row.profit >= 0 ? 'pos' : 'neg'}> רווח: ₪{row.profit} ({row.margin_percent}%)</b>
              </div>
            )}
            <div className="row-meta">
              {config.cardMeta(row).map((m, i) => <span key={i}>{m}</span>)}
            </div>
            {config.statusField && (
              <div className="status-switch small" onClick={e => e.stopPropagation()}>
                {config.statusOptions.map(s => (
                  <button
                    key={s}
                    className={row[config.statusField] === s ? 'active' : ''}
                    onClick={() => handleStatusChange(row.id, s)}
                  >{s}</button>
                ))}
              </div>
            )}
          </div>
        ))}
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

function slug(s) {
  return (s || '').replace(/\s/g, '-')
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
            ) : (
              <input
                type={fld.type === 'number' ? 'number' : fld.type === 'date' ? 'date' : 'text'}
                value={form[fld.key]}
                onChange={e => set(fld.key, e.target.value)}
              />
            )}
          </div>
        ))}

        <div className="modal-actions">
          {onDelete && <button className="btn btn-danger" onClick={onDelete}>מחיקה</button>}
          <button className="btn btn-ghost" onClick={onCancel}>ביטול</button>
          <button className="btn btn-primary" onClick={() => onSave(form)}>שמירה</button>
        </div>
      </div>
    </div>
  )
}
