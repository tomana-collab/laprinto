import { useState } from 'react'
import { setLineReady } from '../lib/orders'
import { formatDateDots } from '../lib/format'

// "מוכן" למוצר בהזמנה (במוצר עם חריטה: "נחרט ומוכן"). לחיצה נוספת מבטלת. לסדר בלבד: לא משנה סטטוס, מלאי או כסף
export default function ReadyButton({ line, onChanged }) {
  const [busy, setBusy] = useState(false)
  const label = line.has_engraving ? 'נחרט ומוכן' : 'מוכן'
  async function toggle(e) {
    e.stopPropagation()
    if (line.ready_at && !window.confirm(`לבטל את הסימון "${label}"?`)) return
    setBusy(true)
    const err = await setLineReady(line, !line.ready_at)
    setBusy(false)
    if (err) { window.alert('העדכון נכשל: ' + err); return }
    onChanged?.()
  }
  const when = line.ready_at ? formatDateDots(line.ready_at) : ''
  return line.ready_at
    ? <button type="button" className="cmp-tool ready-on" disabled={busy} onClick={toggle} title={`סומן ${when}${line.ready_by ? ` על ידי ${line.ready_by}` : ''}. לחיצה מבטלת`}>✓ {label}</button>
    : <button type="button" className="cmp-tool" disabled={busy} onClick={toggle} title="סימון לסדר בלבד: לא משנה סטטוס, מלאי או כסף">סמן {label}</button>
}
