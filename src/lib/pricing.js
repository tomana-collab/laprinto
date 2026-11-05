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

// רווחיות לשורת הזמנה: מכירה (כולל מע"מ) פחות עלות כולל מע"מ והוצאות נלוות, פחות עמלת סליקה.
// העלות נלקחת מהמוצר כפי שהיא היום (cost_with_vat מחושב ב-DB אחרי הנחת ספק) — לא עלות היסטורית.
// מחזיר cost/profit = null אם ההזמנה לא מקושרת למוצר או שלא הוזנה עלות, כדי לא להציג רווח מטעה.
export function calcOrderLine(row) {
  const sale = Number(row.total_amount) || 0
  const qty = Number(row.quantity) || 0
  const fee = r2(sale * CLEARING_RATE * (1 + VAT_RATE))
  const p = row.products
  if (!p || !(Number(p.cost_with_vat) > 0)) return { sale, fee, cost: null, profit: null }
  const cost = r2((Number(p.cost_with_vat) + (Number(p.extra_expenses) || 0)) * qty)
  return { sale, fee, cost, profit: r2(sale - cost - fee) }
}
