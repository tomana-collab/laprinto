// ייצוא טבלה ל-PDF: נפתח חלון הדפסה מעוצב (עברית RTL, לוגו, כותרת, טבלה) ושם בוחרים "שמירה כ-PDF".
// אותו עיצוב כמו ההזמנה לספק במסך השלמת מוצרים.
const LOGO_URL = 'https://laprinto.co.il/wp-content/uploads/2026/08/logolaprinto.png'
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// מחזיר true / 'blocked' (חלון קופץ נחסם) / false (אין שורות)
export function exportPdf({ title, headers, rows, note }) {
  if (!rows.length) return false
  const date = new Date().toLocaleDateString('he-IL')
  const wide = headers.length > 7
  const w = window.open('', '_blank')
  if (!w) return 'blocked'
  w.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 12mm }
    body { font-family: Arial, 'Segoe UI', sans-serif; color: #1c1c28; margin: 0 }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1c1c28; padding-bottom: 10px }
    header img { height: 52px } .meta { text-align: left; font-size: 13px; color: #555 }
    h1 { font-size: 22px; margin: 14px 0 6px } .note { font-size: 12px; color: #555; margin: 0 0 10px }
    table { width: 100%; border-collapse: collapse; font-size: ${wide ? 10.5 : 13}px }
    th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: right; vertical-align: top } th { background: #f0f0f4 }
    thead { display: table-header-group } tr { page-break-inside: avoid }
  </style></head><body>
    <header><img src="${LOGO_URL}" alt="Laprinto" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'Laprinto'}))"><div class="meta">${esc(title)}<br>${esc(date)}</div></header>
    <h1>${esc(title)}</h1>${note ? `<p class="note">${esc(note)}</p>` : ''}
    <table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
  </body></html>`)
  w.document.close()
  const go = () => { w.focus(); w.print() }
  Promise.all([...w.document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r }))).then(() => setTimeout(go, 200))
  return true
}
