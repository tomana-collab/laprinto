// Postgres מחזיר תאריכים כ-'YYYY-MM-DD' (ללא שעה/timezone) — פיצול מחרוזת פשוט
// כדי להימנע מהזזת יום שיכולה לקרות עם new Date() באזורי זמן שליליים.
export function formatDate(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// timestamptz (תאריך+שעה) → "05/11/2026, 14:30" לפי שעון ישראל
export function formatDateTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' })
}

// סטטוסי הזמנה מהאתר (WooCommerce). רק "בטיפול" ו"הושלמה" נספרות כמכירה בסיכומים.
export const ORDER_STATUS_LABELS = {
  processing: 'בטיפול',
  completed: 'הושלמה',
  'on-hold': 'בהמתנה',
  pending: 'ממתינה לתשלום',
  cancelled: 'בוטלה',
  refunded: 'הוחזרה',
  failed: 'נכשלה',
}
const COUNTED_ORDER_STATUSES = ['processing', 'completed']

// הזמנה ידנית (בלי סטטוס אתר) נספרת תמיד
export const isCountedOrder = row => !row.wc_status || COUNTED_ORDER_STATUSES.includes(row.wc_status)
