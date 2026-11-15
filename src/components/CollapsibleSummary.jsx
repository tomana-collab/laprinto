import { useState } from 'react'

// חלון סיכום שנפתח ונסגר במובייל. במסך רחב הוא תמיד פתוח (בלי כפתור); במובייל ברירת המחדל סגור.
// preview = שורת תקציר שמוצגת על הכפתור כשהסיכום סגור.
export default function CollapsibleSummary({ title, preview, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`sum-collapse ${open ? 'open' : ''}`}>
      <button type="button" className="sum-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="sum-toggle-title">{title}</span>
        {!open && preview && <span className="sum-toggle-preview">{preview}</span>}
        <span className="sum-toggle-chev">{open ? '▴ הסתר' : '▾ הצג'}</span>
      </button>
      <div className="sum-body">{children}</div>
    </div>
  )
}
