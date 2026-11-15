// חיווי "המסך חי": נקודה ירוקה כשהחיבור לעדכונים מיידיים פעיל, שעת העדכון האחרון וכפתור רענון.
export default function LiveStatus({ live, lastUpdated, onRefresh }) {
  const time = lastUpdated ? lastUpdated.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem' }) : ''
  return (
    <span className="live-status" title={live ? 'מחובר: המסך מתעדכן מיד כשיש שינוי (תעודה, הזמנה, מוצר)' : 'עדכון אוטומטי כל דקה ובחזרה ללשונית'}>
      <span className={`live-dot ${live ? 'on' : ''}`} /> {live ? 'חי' : 'מתעדכן אוטומטית'} · עודכן <span dir="ltr">{time}</span>
      <button type="button" className="link-btn" onClick={onRefresh}>⟳ רענן</button>
    </span>
  )
}
