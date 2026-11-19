import { supabase } from '../supabaseClient'
// פירוק טקסט פרטי שורה ("שם: ערך" בשורות) לחריטה ולשאר הבחירות (צבע / וריאציה...).
// הזמנות ישנות נשמרו מעורבות ("צבע: שקוף\nהתאמה אישית: טקסט"), חדשות כבר מופרדות מהסנכרון.
const ENTRY = /(?:^|\n)([^\n:]{1,60}):[ \t]*([\s\S]*?)(?=\n[^\n:]{1,40}:[ \t]|$)/g
export function splitMeta(text) {
  const t = String(text || '')
  const eng = []
  const other = []
  for (const m of t.matchAll(ENTRY)) {
    if (/חריטה|התאמה אישית/.test(m[1])) eng.push(m[2].trim())
    else other.push(`${m[1].trim()}: ${m[2].trim()}`)
  }
  return { engraving: eng.join('\n'), other: other.join('\n') }
}
// מה לחרוט בפועל (בלי שם השדה ובלי בחירת הווריאציה)
export const engravingText = t => splitMeta(t).engraving || String(t || '').trim()
// בחירת הווריאציה / שאר הפרטים (צבע וכו') — בלי החריטה
export const variationText = t => splitMeta(t).other

// שורות בטבלת orders הן שורות פריט. הזמנה מהאתר עם כמה פריטים (אותו wc_order_id)
// מאוחדת כאן להזמנה אחת עם lines. הזמנה ידנית (בלי wc_order_id) נשארת שורה בודדת.
export function groupOrders(rows) {
  const byOrder = new Map()
  const out = []
  for (const r of rows) {
    if (!r.wc_order_id) { out.push({ ...r, lines: [r], line_ids: [r.id] }); continue }
    let g = byOrder.get(r.wc_order_id)
    if (!g) { g = { ...r, lines: [], line_ids: [] }; byOrder.set(r.wc_order_id, g); out.push(g) }
    g.lines.push(r)
    g.line_ids.push(r.id)
  }
  for (const g of out) {
    if (g.lines.length < 2) continue
    const nameOf = l => l.products?.name || l.product_name || ''
    // שדות מאוחדים — כדי שחיפוש וסינון כלליים יעבדו על כל ההזמנה
    g.product_name = g.lines.map(nameOf).join(' | ')
    g.sku = g.lines.map(l => l.sku).filter(Boolean).join(' | ')
    g.quantity = g.lines.reduce((a, l) => a + (Number(l.quantity) || 0), 0)
    g.total_amount = g.lines.reduce((a, l) => a + (Number(l.total_amount) || 0), 0)
    g.discount_amount = g.lines.reduce((a, l) => a + (Number(l.discount_amount) || 0), 0)
    g.has_engraving = g.lines.some(l => l.has_engraving && !l.not_supplied)
    g.engraving = g.lines
      .filter(l => l.has_engraving)
      .map(l => `${nameOf(l)}:\n${engravingText(l.engraving)}`)
      .join('\n\n')
    g.personalization = g.lines
      .filter(l => l.personalization)
      .map(l => `${nameOf(l)}:\n${l.personalization}`)
      .join('\n\n')
  }
  return out
}

// "מוכן" לכל מוצר בהזמנה (נחרט / נארז): מתי ומי סימן. לסדר בלבד, לא משנה סטטוס, מלאי או כסף.
// מחזיר הודעת שגיאה או null
export async function setLineReady(line, ready) {
  const { data } = await supabase.auth.getSession()
  const patch = ready
    ? { ready_at: new Date().toISOString(), ready_by: data?.session?.user?.email || '' }
    : { ready_at: null, ready_by: '' }
  const { error } = await supabase.from('orders').update(patch).eq('id', line.id)
  return error ? error.message : null
}
// כמה מוצרים בהזמנה מוכנים מתוך כמה (בלי מוצרים שסומנו "לא לספק")
export function readyCount(order) {
  const live = (order.lines || [order]).filter(l => !l.not_supplied)
  return { ready: live.filter(l => l.ready_at).length, total: live.length }
}
