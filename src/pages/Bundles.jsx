import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'

export default function Bundles() {
  const { user } = useAuth()
  const [bundles, setBundles] = useState(null)
  const [products, setProducts] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // {} חדש, שורה קיימת, או null סגור

  async function load() {
    setError('')
    const [b, p] = await Promise.all([
      supabase.from('bundles').select('*, bundle_products(product_id, products(id, name, cost, extra_expenses))').order('created_at', { ascending: false }),
      supabase.from('products').select('id, name, cost, extra_expenses').order('name'),
    ])
    if (b.error) { setError(b.error.message); return }
    if (p.error) { setError(p.error.message); return }
    setBundles(b.data)
    setProducts(p.data)
  }

  useEffect(() => { load() }, [])

  function bundleCost(bundle) {
    return bundle.bundle_products.reduce((a, bp) => a + (bp.products?.cost || 0) + (bp.products?.extra_expenses || 0), 0)
  }

  async function handleSave({ name, price, notes, productIds }) {
    if (!name.trim()) { setError('צריך שם למארז'); return }

    let bundleId = editing.id
    if (bundleId) {
      const { error } = await supabase.from('bundles').update({ name, price, notes }).eq('id', bundleId)
      if (error) { setError(error.message); return }
      const { error: delErr } = await supabase.from('bundle_products').delete().eq('bundle_id', bundleId)
      if (delErr) { setError(delErr.message); return }
    } else {
      const { data, error } = await supabase.from('bundles')
        .insert({ name, price, notes, created_by: user?.email || '' })
        .select('id').single()
      if (error) { setError(error.message); return }
      bundleId = data.id
    }

    if (productIds.length > 0) {
      const { error: insErr } = await supabase.from('bundle_products')
        .insert(productIds.map(product_id => ({ bundle_id: bundleId, product_id })))
      if (insErr) { setError(insErr.message); return }
    }

    setEditing(null)
    load()
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('bundles').delete().eq('id', id)
    if (error) { setError(error.message); return }
    setEditing(null)
    load()
  }

  if (bundles === null || products === null) return <div className="loading">טוען מארזים...</div>

  return (
    <div>
      <div className="module-head">
        <h2>🎁 מארזים</h2>
        <button className="btn-add" onClick={() => setEditing({})}>+ חדש</button>
      </div>

      {error && <div className="err-inline">{error}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>שם המארז</th>
              <th>מוצרים</th>
              <th>עלות</th>
              <th>מחיר מכירה</th>
              <th>רווח</th>
              <th>מרווח</th>
            </tr>
          </thead>
          <tbody>
            {bundles.length === 0 && (
              <tr><td className="empty-col" colSpan={6}>אין מארזים עדיין</td></tr>
            )}
            {bundles.map(bundle => {
              const cost = bundleCost(bundle)
              const price = bundle.price || 0
              const profit = price - cost
              const margin = price > 0 ? Math.round((profit / price) * 100) : 0
              return (
                <tr key={bundle.id} onClick={() => setEditing(bundle)}>
                  <td>{bundle.name}</td>
                  <td>{bundle.bundle_products.map(bp => bp.products?.name).filter(Boolean).join(', ') || '—'}</td>
                  <td>₪{cost.toFixed(0)}</td>
                  <td>₪{price.toFixed(0)}</td>
                  <td><span className={profit >= 0 ? 'pos' : 'neg'}>₪{profit.toFixed(0)}</span></td>
                  <td>{margin}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <BundleModal
          products={products}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
          onDelete={editing.id ? () => handleDelete(editing.id) : null}
        />
      )}
    </div>
  )
}

function BundleModal({ products, initial, onCancel, onSave, onDelete }) {
  const [name, setName] = useState(initial.name || '')
  const [price, setPrice] = useState(initial.price ?? 0)
  const [notes, setNotes] = useState(initial.notes || '')
  const [selected, setSelected] = useState(() => new Set((initial.bundle_products || []).map(bp => bp.product_id)))

  function toggle(id) {
    setSelected(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const cost = products.reduce((a, p) => selected.has(p.id) ? a + (p.cost || 0) + (p.extra_expenses || 0) : a, 0)
  const profit = Number(price || 0) - cost
  const margin = price > 0 ? Math.round((profit / price) * 100) : 0

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal">
        <h2>{initial.id ? 'עריכת מארז' : 'מארז חדש'}</h2>

        <div className="field">
          <label>שם המארז</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div className="field">
          <label>מוצרים במארז</label>
          <div className="bundle-product-list">
            {products.map(p => (
              <label key={p.id} className="bundle-product-row">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <span>{p.name}</span>
                <span className="bundle-product-cost">₪{((p.cost || 0) + (p.extra_expenses || 0)).toFixed(0)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>מחיר מכירה (₪)</label>
          <input type="number" value={price} onChange={e => setPrice(e.target.value)} />
        </div>

        <div className="field">
          <label>הערות</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="summary-row" style={{ marginBottom: 0 }}>
          <div className="summary-card"><span>עלות המארז</span><b>₪{cost.toFixed(0)}</b></div>
          <div className="summary-card"><span>רווח</span><b className={profit >= 0 ? 'pos' : 'neg'}>₪{profit.toFixed(0)}</b></div>
          <div className="summary-card"><span>מרווח</span><b>{margin}%</b></div>
        </div>

        <div className="modal-actions">
          {onDelete && <button className="btn btn-danger" onClick={onDelete}>מחיקה</button>}
          <button className="btn btn-ghost" onClick={onCancel}>ביטול</button>
          <button className="btn btn-primary" onClick={() => onSave({ name, price: Number(price) || 0, notes, productIds: [...selected] })}>שמירה</button>
        </div>
      </div>
    </div>
  )
}
