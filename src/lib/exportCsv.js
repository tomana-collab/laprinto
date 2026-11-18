// ייצוא לקובץ שנפתח באקסל: CSV עם BOM (UTF-8) כדי שעברית תוצג נכון, בלי ספריות נוספות.
const cell = v => {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportCsv(filename, headers, rows) {
  const text = [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
