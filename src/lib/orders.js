import { supabase } from '../supabaseClient'
import { replacedLineIds } from './pricing'
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
// איחוד הזמנות (ב-CRM בלבד): שורה עם merged_into_wc_order_id מצטרפת להזמנה הזו.
export const orderKey = r => r.merged_into_wc_order_id || r.wc_order_id || null
export function groupOrders(rows) {
  const byOrder = new Map()
  let out = []
  for (const r of rows) {
    const key = orderKey(r)
    if (!key) { out.push({ ...r, lines: [r], line_ids: [r.id] }); continue }
    let g = byOrder.get(key)
    if (!g) { g = { ...r, lines: [], line_ids: [], _key: key }; byOrder.set(key, g); out.push(g) }
    g.lines.push(r)
    g.line_ids.push(r.id)
  }
  // הזמנה מאוחדת: פרטי ההזמנה מההזמנה הראשית, השורות שלה ראשונות, ודמי משלוח וסה"כ באתר מסוכמים מכל ההזמנות
  out = out.map(g => {
    if (!g._key) return g
    const mergedIn = g.lines.filter(l => l.merged_into_wc_order_id)
    if (!mergedIn.length) { delete g._key; return g }
    const isMain = l => !l.merged_into_wc_order_id && l.wc_order_id === g._key
    const lines = [...g.lines.filter(isMain), ...g.lines.filter(l => !isMain(l))]
    const main = lines.find(isMain) || lines[0]
    const perOrder = new Map()
    for (const l of lines) { const k = l.wc_order_id || 'm' + l.id; if (!perOrder.has(k)) perOrder.set(k, l) }
    const firsts = [...perOrder.values()]
    const sum = f => firsts.some(l => l[f] != null) ? Math.round(firsts.reduce((a, l) => a + (Number(l[f]) || 0), 0) * 100) / 100 : null
    return { ...main, wc_order_id: g._key, lines, line_ids: lines.map(l => l.id),
      merged_orders: firsts.map(l => l.order_number ? `#${l.order_number}` : 'ידנית'),
      shipping_total: sum('shipping_total'), order_total: sum('order_total') }
  })
  for (const g of out) {
    if (g.lines.length < 2) continue
    const nameOf = l => l.products?.name || l.product_name || ''
    // שדות מאוחדים — כדי שחיפוש וסינון כלליים יעבדו על כל ההזמנה
    g.product_name = g.lines.map(nameOf).join(' | ')
    g.sku = g.lines.map(l => l.sku).filter(Boolean).join(' | ')
    // כמות = רק מוצרים שיסופקו (שורה שסומנה "לא לספק" לא נספרת)
    g.quantity = g.lines.filter(l => !l.not_supplied).reduce((a, l) => a + (Number(l.quantity) || 0), 0)
    // מכירה והנחה: בלי שורה שהוחלפה (הסכום עבר לשורה המחליפה)
    const skip = replacedLineIds(g.lines)
    g.total_amount = g.lines.filter(l => !skip.has(l.id)).reduce((a, l) => a + (Number(l.total_amount) || 0), 0)
    g.discount_amount = g.lines.filter(l => !skip.has(l.id)).reduce((a, l) => a + (Number(l.discount_amount) || 0), 0)
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
