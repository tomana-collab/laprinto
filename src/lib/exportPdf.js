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

// דף ליקוט למחסן להזמנה אחת: מספר הזמנה, פרטי לקוח, כתובת וטלפון, ומה יש בהזמנה (בלי מחירים).
// שורה שסומנה "לא לספק" לא מודפסת. נפתח חלון הדפסה ושם בוחרים "שמירה כ-PDF".
export function printPackingSlip(order, { engravingText, variationText }) {
  const lines = (order.lines || [order]).filter(l => !l.not_supplied)
  const w = window.open('', '_blank')
  if (!w) return 'blocked'
  const title = `הזמנה ${order.order_number || ''}`.trim()
  const date = order.order_date ? new Date(order.order_date).toLocaleDateString('he-IL') : ''
  const info = (label, value) => value ? `<div class="i"><span>${esc(label)}</span><b>${esc(value)}</b></div>` : ''
  const rows = lines.map((l, i) => {
    const eng = l.has_engraving ? engravingText(l.engraving) : ''
    const vari = variationText(l.personalization)
    return `<tr><td class="n">${i + 1}</td><td><b>${esc(l.products?.name || l.product_name || '')}</b>${
      vari ? `<div class="sub">${esc(vari)}</div>` : ''}${eng ? `<div class="sub eng">✒️ חריטה: ${esc(eng)}</div>` : ''}</td>
      <td dir="ltr">${esc(l.sku || '')}</td><td class="q">${esc(l.quantity)}</td><td class="chk"></td></tr>`
  }).join('')
  w.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4 portrait; margin: 12mm }
    body { font-family: Arial, 'Segoe UI', sans-serif; color: #1c1c28; margin: 0; font-size: 14px }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1c1c28; padding-bottom: 10px }
    header img { height: 52px } .meta { text-align: left; font-size: 13px; color: #555 }
    h1 { font-size: 26px; margin: 14px 0 10px }
    .box { border: 1px solid #bbb; border-radius: 6px; padding: 10px 14px; margin-bottom: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px }
    .i span { display: block; font-size: 12px; color: #666 } .i b { white-space: pre-wrap; font-size: 15px }
    .full { grid-column: 1 / -1 }
    table { width: 100%; border-collapse: collapse }
    th, td { border: 1px solid #bbb; padding: 7px 8px; text-align: right; vertical-align: top } th { background: #f0f0f4 }
    td.n, td.q { text-align: center; width: 40px; font-weight: bold } td.q { font-size: 17px } td.chk { width: 40px }
    .sub { font-size: 12.5px; color: #444; margin-top: 3px; white-space: pre-wrap } .eng { color: #1c1c28; font-weight: bold }
    thead { display: table-header-group } tr { page-break-inside: avoid }
    .total { margin-top: 8px; font-size: 13px; color: #555 }
  </style></head><body>
    <header><img src="${LOGO_URL}" alt="Laprinto" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'Laprinto'}))"><div class="meta">דף ליקוט למחסן<br>${esc(date)}</div></header>
    <h1>${esc(title)}</h1>
    <div class="box">
      ${info('שם הלקוח', order.customer_name)}
      ${info('טלפון', order.customer_phone)}
      <div class="full">${info('כתובת למשלוח', order.shipping_address)}</div>
      ${info('שיטת משלוח', order.shipping_method)}
      <div class="full">${info('הערת הלקוח', order.customer_note)}</div>
    </div>
    <table><thead><tr><th>#</th><th>מוצר</th><th>מק"ט</th><th>כמות</th><th>✓</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="total">סה"כ פריטים: ${lines.reduce((a, l) => a + (Number(l.quantity) || 0), 0)}</div>
  </body></html>`)
  w.document.close()
  const go = () => { w.focus(); w.print() }
  Promise.all([...w.document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r }))).then(() => setTimeout(go, 200))
  return true
}
