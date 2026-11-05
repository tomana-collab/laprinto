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
    g.personalization = g.lines
      .filter(l => l.personalization)
      .map(l => `${nameOf(l)}:\n${l.personalization}`)
      .join('\n\n')
  }
  return out
}
