import { useState } from 'react'

// מיון טבלה בלחיצה על כותרת: לחיצה ראשונה מהגדול לקטן, שנייה מהקטן לגדול, שלישית מבטלת.
export function useSort(initial = { key: null, dir: 'desc' }) {
  const [sort, setSort] = useState(initial)
  const toggle = key => setSort(s =>
    s.key !== key ? { key, dir: 'desc' } : s.dir === 'desc' ? { key, dir: 'asc' } : { key: null, dir: 'desc' })
  return [sort, toggle]
}

export function sortRows(rows, getters, sort) {
  const get = getters[sort.key]
  if (!get) return rows
  const sign = sort.dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b)
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign
    return String(x ?? '').localeCompare(String(y ?? ''), 'he') * sign
  })
}

export function SortTh({ k, sort, onSort, children, ...rest }) {
  const on = sort.key === k
  return (
    <th {...rest} onClick={() => onSort(k)} style={{ cursor: 'pointer', userSelect: 'none', ...rest.style }}>
      {children}{on ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
    </th>
  )
}
