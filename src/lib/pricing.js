// נוסחת רווחיות למוצר. חייבת להישאר זהה לעמודות המחושבות ב-DB
// (supabase/migrations/2026-11-05-supplier-link-discount.sql) — כאן היא משמשת
// לתצוגה חיה בטופס העריכה לפני השמירה.

export const VAT_RATE = 0.18        // מע"מ
export const CLEARING_RATE = 0.0075 // עמלת סליקה: 0.75% מהמחיר שנסלק, ועליה מע"מ

const r2 = n => Math.round(n * 100) / 100

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
export function lineCost(line) {
  const p = line.products
  if (!p || !(Number(p.cost_with_vat) > 0)) return null
  return r2((Number(p.cost_with_vat) + (Number(p.extra_expenses) || 0)) * (Number(line.quantity) || 0))
}

// רווחיות להזמנה שלמה (order.lines = כל שורות הפריט; בלי lines — שורה בודדת).
//   מכירה לפני הנחה  = מכירה בפועל + הנחת קופון
//   מכירה בפועל      = סכום השורות כפי ששולם (כבר אחרי קופון)
//   רווח נטו         = מכירה בפועל - עלות (כולל מע"מ והוצאות נלוות) - עמלת סליקה על הסכום ששולם
// cost/profit = null אם לפחות מוצר אחד לא מקושר או שלא הוזנה לו עלות (כדי לא להציג רווח מטעה).
export function calcOrder(order) {
  const lines = order.lines || [order]
  const sale = r2(lines.reduce((a, l) => a + (Number(l.total_amount) || 0), 0))
  const discount = r2(lines.reduce((a, l) => a + (Number(l.discount_amount) || 0), 0))
  const fee = r2(sale * CLEARING_RATE * (1 + VAT_RATE))
  const costs = lines.map(lineCost)
  const missing = lines.filter((_, i) => costs[i] === null).map(l => l.products?.name || l.product_name || '?')
  const cost = missing.length ? null : r2(costs.reduce((a, c) => a + c, 0))
  return {
    sale, discount, before: r2(sale + discount), fee, cost, missing,
    profit: cost === null ? null : r2(sale - cost - fee),
  }
}
