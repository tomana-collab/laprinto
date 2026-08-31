// Postgres מחזיר תאריכים כ-'YYYY-MM-DD' (ללא שעה/timezone) — פיצול מחרוזת פשוט
// כדי להימנע מהזזת יום שיכולה לקרות עם new Date() באזורי זמן שליליים.
export function formatDate(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
