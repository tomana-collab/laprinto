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

// חברות משלוח (orders.shipping_company) ועלות למשלוח מההגדרות (app_settings: ship_cost_<key>)
export const SHIPPING_COMPANIES = [
  { key: 'freddy', label: 'פרדי' },
  { key: 'hovalot', label: 'הובלות' },
  { key: 'us', label: 'אנחנו', free: true }, // אנחנו מוסרים בעצמנו: ללא עלות, לא יורד מהרווח
]
const COMPANY_COST = { freddy: 50, hovalot: 45, us: 0 }
export const setCompanyCost = (key, n) => { if (n !== undefined && n !== null) COMPANY_COST[key] = Number(n) || 0 }
export const getCompanyCost = key => SHIPPING_COMPANIES.find(c => c.key === key)?.free ? 0 : (COMPANY_COST[key] ?? 0)
const companyKey = label => SHIPPING_COMPANIES.find(c => c.label === label)?.key
// עלות המשלוח שלי להזמנה: רק אם סומנה חברת שליחויות בהזמנה (פרדי / הובלות / אנחנו, המחירים בהגדרות).
// בלי חברה (או איסוף עצמי) — לא מחשבים עלות משלוח
export const orderShipCost = order => {
  const k = companyKey(order.shipping_company)
  return k ? getCompanyCost(k) : 0
}

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
// העלות ליחידה = מחיר הקנייה שנשמר בשורה ביום המכירה (cost_at_sale, כולל מע"מ אחרי הנחת ספק).
// אם לא נשמר (למוצר לא הייתה עלות אז) — העלות הנוכחית של המוצר (cost_with_vat).
// שורה שסומנה "לא לספק" (למשל מוצר שהוחלף) לא יוצאת מהמלאי, ולכן אין לה עלות.
export function lineCost(line) {
  if (line.not_supplied) return 0
  // שורה שנוספה ידנית בטקסט חופשי ("אחר"), בלי מוצר מקושר: אין לה עלות
  if (line.manual_line && !line.product_id) return 0
  const p = line.products
  const unit = unitCostAtSale(line)
  if (!p || !(unit > 0)) return null
  return r2((unit + (Number(p.extra_expenses) || 0)) * (Number(line.quantity) || 0))
}
// מחיר קנייה ליחידה (כולל מע"מ) נכון ליום המכירה, או העלות הנוכחית אם לא נשמר
export function unitCostAtSale(line) {
  return Number(line.cost_at_sale) > 0 ? Number(line.cost_at_sale) : Number(line.products?.cost_with_vat) || 0
}

// רווחיות להזמנה שלמה (order.lines = כל שורות הפריט; בלי lines — שורה בודדת).
//   מכירה לפני הנחה  = מכירה בפועל + הנחת קופון
//   מכירה בפועל      = סכום השורות כפי ששולם (כבר אחרי קופון), בלי משלוח
//   סכום ששולם       = מכירה בפועל + דמי המשלוח שהלקוח שילם (= סה"כ ההזמנה באתר)
//   רווח כולל מע"מ         = סכום ששולם - עלות (כולל מע"מ והוצאות נלוות) - עמלת סליקה על הסכום ששולם - עלות משלוח (מההגדרות)
// cost/profit = null אם לפחות מוצר אחד לא מקושר או שלא הוזנה לו עלות (כדי לא להציג רווח מטעה).
// שורה שהוחלפה במוצר אחר (מסומנת "לא לספק" ויש שורה עם replaces_line_id אליה): המכירה וההנחה עברו לשורה המחליפה
export function replacedLineIds(lines) {
  const ids = new Set((lines || []).map(l => l.replaces_line_id).filter(Boolean))
  return new Set((lines || []).filter(l => l.not_supplied && ids.has(l.id)).map(l => l.id))
}
// קד"מ / ללא חיוב: הזמנת קד"מ, או מוצר שנוסף להזמנה בלי חיוב (לא מוצר מחליף). לא חלק מהמכירות, העלות והרווח —
// העלות שלו נספרת בנפרד ("פחת וקד״מ"), ומוחזרת כאן ב-giveCost
export const isGiveawayLine = l => !!l.is_promo || (!!l.manual_line && !l.replaces_line_id && !(Number(l.total_amount) > 0))

// replaced = מזהי שורות שהוחלפו (כשמחשבים שורה בודדת מתוך הזמנה). ברירת מחדל: מחושב מהשורות עצמן
// opts.raw = בלי להוציא קד"מ (לתצוגת הנתונים המקוריים של שורה)
export function calcOrder(order, replaced, opts = {}) {
  const all = order.lines || [order]
  // (בודק שזה Set: calcOrder נקרא גם דרך .map, שמעביר אינדקס כפרמטר שני)
  const skip = replaced instanceof Set ? replaced : replacedLineIds(all)
  const give = opts.raw ? [] : all.filter(l => isGiveawayLine(l) && !l.not_supplied)
  const giveIds = new Set(give.map(l => l.id))
  const sold = all.filter(l => !skip.has(l.id) && !giveIds.has(l.id))
  const lines = all.filter(l => !giveIds.has(l.id))
  const giveCost = r2(give.reduce((a, l) => a + (lineCost(l) || 0), 0))
  const promoOnly = give.length > 0 && lines.every(l => l.not_supplied)
  const sale = r2(sold.reduce((a, l) => a + (Number(l.total_amount) || 0), 0))
  const discount = r2(sold.reduce((a, l) => a + (Number(l.discount_amount) || 0), 0))
  const shipping = r2(Number(order.shipping_total) || 0)
  const paid = r2(sale + shipping)
  const fee = r2(paid * CLEARING_RATE * (1 + VAT_RATE))
  const shipCost = orderShipCost(order)
  const costs = lines.map(lineCost)
  const missing = lines.filter((_, i) => costs[i] === null).map(l => l.products?.name || l.product_name || '?')
  const cost = missing.length ? null : r2(costs.reduce((a, c) => a + c, 0))
  return {
    sale, discount, before: r2(sale + discount), shipping, paid, fee, shipCost, cost, missing, giveCost, promoOnly,
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
