// שווי הסחורה שבמלאי לפי מה ששולם בפועל לפי תעודות הקליטה (לפני מע"מ, אחרי הנחת ספק).
// היחידות שנשארו במלאי הן הנקלטות האחרונות (הכי ישנות נמכרו קודם): לוקחים את התעודות מהחדשה לישנה עד שמכסים את כמות המלאי.
// יחידות שאין להן תעודה (מלאי פתיחה) מוערכות לפי עלות המוצר עצמו. תעודה שעוד לא סופקה לא נספרת.
// items = שורות stock_receipt_items עם stock_receipts(status, doc_date, created_at)
export function buildLots(items) {
  const lots = new Map()
  for (const i of items || []) {
    if ((i.stock_receipts?.status || 'סופק') !== 'סופק') continue
    const q = Number(i.quantity) || 0
    if (q <= 0) continue
    const net = (Number(i.unit_cost) || 0) * (1 - (Number(i.discount_percent) || 0) / 100)
    const date = String(i.stock_receipts?.doc_date || i.stock_receipts?.created_at || '')
    if (!lots.has(i.product_id)) lots.set(i.product_id, [])
    lots.get(i.product_id).push({ q, net, date })
  }
  for (const list of lots.values()) list.sort((a, b) => b.date.localeCompare(a.date)) // מהחדשה לישנה
  return lots
}

// עלות כוללת של `units` יחידות שעל המדף. fallbackUnit = עלות המוצר ליחידה ליחידות בלי תעודה.
export function shelfCost(lotList, units, fallbackUnit) {
  let left = Math.max(0, Number(units) || 0)
  let cost = 0
  for (const l of lotList || []) {
    if (left <= 0) break
    const take = Math.min(left, l.q)
    cost += take * l.net
    left -= take
  }
  if (left > 0) cost += left * (Number(fallbackUnit) || 0)
  return Math.round(cost * 100) / 100
}
