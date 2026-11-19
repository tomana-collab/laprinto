// נוסחת רווחיות למוצר. חייבת להישאר זהה לעמודות המחושבות ב-DB
// (supabase/migrations/2026-11-05-supplier-link-discount.sql) — כאן היא משמשת
// לתצוגה חיה בטופס העריכה לפני השמירה.

export const VAT_RATE = 0.18        // מע"מ
export const CLEARING_RATE = 0.0075 // עמלת סליקה: 0.75% מהמחיר שנסלק, ועליה מע"מ

const r2 = n => Math.round(n * 100) / 100

// עלות משלוח להזמנה (₪) מההגדרות (טבלת app_settings, מפתח shipping_cost). נטענת פעם אחת אחרי ההתחברות (SettingsLoader)
let SHIPPING_COST = 0
export const setShippingCost = n => { SHIPPING_COST = Number(n) || 0 }
export const getShippingCost = () => SHIPPING_COST
// הזמנה מהאתר שנשלחת ללקוח (כל שיטת משלוח חוץ מאיסוף עצמי, כולל משלוח חינם) — עולה לי משלוח
export const orderShips = order => !!order.wc_order_id && !/איסוף/.test(order.shipping_method || '')

export function calcProduct({ cost, supplier_discount_percent, extra_expenses, price }) {
  const c = Number(cost) || 0
  const d = Number(supplier_discount_percent) || 0
  const extra = Number(extra_expenses) || 0
  const p = Number(price) || 0

  const costAfterDiscount = r2(c * (1 - d / 100))
  const costWithVat = r2(c * (1 - d / 100) * (1 + VAT_RATE))
  const clearingFee = r2(p * CLEARING_RATE * (1 + VAT_RATE))
  const profit = r2(p - c * (1 - d / 100) * (1 + VAT_RATE) - p * CLEARING_RATE * (1 + VAT_RATE) - extra)
  const margin = p > 0 ? Math.round((profit / p) * 1000) / 10 : 0

  return { costAfterDiscount, costWithVat, clearingFee, extra, profit, margin }
}

// עלות שורת פריט אחת (עלות כולל מע"מ + הוצאות נלוות, כפול כמות), או null אם חסרה עלות.
// העלות נלקחת מהמוצר כפי שהיא היום (cost_with_vat מחושב ב-DB אחרי הנחת ספק) — לא עלות היסטורית.
// שורה שסומנה "לא לספק" (למשל מוצר שהוחלף) לא יוצאת מהמלאי, ולכן אין לה עלות.
export function lineCost(line) {
  if (line.not_supplied) return 0
  // שורה שנוספה ידנית בטקסט חופשי ("אחר"), בלי מוצר מקושר: אין לה עלות
  if (line.manual_line && !line.product_id) return 0
  const p = line.products
  if (!p || !(Number(p.cost_with_vat) > 0)) return null
  return r2((Number(p.cost_with_vat) + (Number(p.extra_expenses) || 0)) * (Number(line.quantity) || 0))
}

// רווחיות להזמנה שלמה (order.lines = כל שורות הפריט; בלי lines — שורה בודדת).
//   מכירה לפני הנחה  = מכירה בפועל + הנחת קופון
//   מכירה בפועל      = סכום השורות כפי ששולם (כבר אחרי קופון), בלי משלוח
//   סכום ששולם       = מכירה בפועל + דמי המשלוח שהלקוח שילם (= סה"כ ההזמנה באתר)
//   רווח נטו         = סכום ששולם - עלות (כולל מע"מ והוצאות נלוות) - עמלת סליקה על הסכום ששולם - עלות משלוח (מההגדרות)
// cost/profit = null אם לפחות מוצר אחד לא מקושר או שלא הוזנה לו עלות (כדי לא להציג רווח מטעה).
// שורה שהוחלפה במוצר אחר (מסומנת "לא לספק" ויש שורה עם replaces_line_id אליה): המכירה וההנחה עברו לשורה המחליפה
export function replacedLineIds(lines) {
  const ids = new Set((lines || []).map(l => l.replaces_line_id).filter(Boolean))
  return new Set((lines || []).filter(l => l.not_supplied && ids.has(l.id)).map(l => l.id))
}
// replaced = מזהי שורות שהוחלפו (כשמחשבים שורה בודדת מתוך הזמנה). ברירת מחדל: מחושב מהשורות עצמן
export function calcOrder(order, replaced) {
  const all = order.lines || [order]
  // (בודק שזה Set: calcOrder נקרא גם דרך .map, שמעביר אינדקס כפרמטר שני)
  const skip = replaced instanceof Set ? replaced : replacedLineIds(all)
  const sold = all.filter(l => !skip.has(l.id))
  const lines = all
  const sale = r2(sold.reduce((a, l) => a + (Number(l.total_amount) || 0), 0))
  const discount = r2(sold.reduce((a, l) => a + (Number(l.discount_amount) || 0), 0))
  const shipping = r2(Number(order.shipping_total) || 0)
  const paid = r2(sale + shipping)
  const fee = r2(paid * CLEARING_RATE * (1 + VAT_RATE))
  const shipCost = orderShips(order) ? SHIPPING_COST : 0
  const costs = lines.map(lineCost)
  const missing = lines.filter((_, i) => costs[i] === null).map(l => l.products?.name || l.product_name || '?')
  const cost = missing.length ? null : r2(costs.reduce((a, c) => a + c, 0))
  return {
    sale, discount, before: r2(sale + discount), shipping, paid, fee, shipCost, cost, missing,
    profit: cost === null ? null : r2(paid - cost - fee - shipCost),
  }
}

// הוצאות לפי קליטת תעודות ספק: כמות × עלות ליחידה אחרי הנחת ספק, כולל מע"מ (כמו בסה"כ שבמסך התעודות).
// receipts = stock_receipts עם stock_receipt_items(quantity, unit_cost, discount_percent); from = 'YYYY-MM-DD' (כולל)
export function receiptsTotalWithVat(receipts, from = '') {
  let sum = 0
  for (const r of receipts || []) {
    if (from && String(r.doc_date || r.created_at || '').slice(0, 10) < from) continue
    for (const i of r.stock_receipt_items || []) {
      sum += (Number(i.quantity) || 0) * (Number(i.unit_cost) || 0) * (1 - (Number(i.discount_percent) || 0) / 100)
    }
  }
  return r2(sum * (1 + VAT_RATE))
}
