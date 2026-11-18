import { useEffect, useRef, useState } from 'react'
import { exportCsv } from '../lib/exportCsv'
import { exportPdf } from '../lib/exportPdf'

// כפתור "ייצוא" אחד עדין: לחיצה פותחת תפריט קטן (אקסל / PDF), ומה שבוחרים הוא מה שקורה.
// sets: רשימת סטים לייצוא [{ name, title, label, getData }]; getData מחזיר { headers, rows } של מה שמוצג כרגע במסך.
export default function ExportButtons({ name, title, getData, label, sets }) {
  const all = sets || [{ name, title, label, getData }]
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const stamp = new Date().toISOString().slice(0, 10)
  function run(set, kind) {
    setOpen(false)
    const data = set.getData()
    if (!data.rows.length) { alert('אין שורות לייצוא'); return }
    // מספור רץ (1, 2, 3...) בעמודה הראשונה — בצד ימין בקובץ מימין לשמאל
    const headers = ['#', ...data.headers]
    const rows = data.rows.map((r, i) => [i + 1, ...r])
    if (kind === 'excel') { exportCsv(`${set.name}-${stamp}.csv`, headers, rows); return }
    const res = exportPdf({ title: set.title, headers, rows })
    if (res === 'blocked') alert('הדפדפן חסם את החלון. אפשר חלונות קופצים לאתר ונסה שוב.')
  }
  return (
    <span className="export-menu" ref={ref}>
      <button type="button" className={`btn-soft${open ? ' on' : ''}`} onClick={() => setOpen(o => !o)}>⬇ ייצוא ▾</button>
      {open && (
        <div className="export-pop">
          {all.map(set => (
            <div key={set.name}>
              {all.length > 1 && <div className="export-title">{set.label || set.title}</div>}
              <button type="button" onClick={() => run(set, 'excel')}>אקסל</button>
              <button type="button" onClick={() => run(set, 'pdf')}>PDF</button>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
