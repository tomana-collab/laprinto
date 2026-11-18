import { exportCsv } from '../lib/exportCsv'
import { exportPdf } from '../lib/exportPdf'

// כפתורי ייצוא לאקסל (CSV) ול-PDF. getData מחזיר { headers, rows } של מה שמוצג כרגע במסך.
export default function ExportButtons({ name, title, getData, label }) {
  const stamp = new Date().toISOString().slice(0, 10)
  function toPdf() {
    const { headers, rows } = getData()
    const res = exportPdf({ title, headers, rows })
    if (res === 'blocked') alert('הדפדפן חסם את החלון. אפשר חלונות קופצים לאתר ונסה שוב.')
    else if (!res) alert('אין שורות לייצוא')
  }
  function toExcel() {
    const { headers, rows } = getData()
    if (!rows.length) { alert('אין שורות לייצוא'); return }
    exportCsv(`${name}-${stamp}.csv`, headers, rows)
  }
  return (
    <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-ghost" onClick={toExcel}>⬇ ייצוא {label || ''} לאקסל</button>
      <button type="button" className="btn btn-ghost" onClick={toPdf}>📄 ייצוא {label || ''} ל-PDF</button>
    </span>
  )
}
