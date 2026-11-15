import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

// מסך "חי": טוען מחדש מיד כשמשהו משתנה בטבלאות (Supabase Realtime), וגם כשחוזרים ללשונית וכל דקה כרשת ביטחון.
// load = הפונקציה שטוענת את נתוני המסך. tables = הטבלאות שהמסך תלוי בהן (ריק = לא פעיל).
// שינויים רבים ברצף (למשל סנכרון) מתאחדים לטעינה אחת.
export function useLiveReload(load, tables = [], pollMs = 60000) {
  const loadRef = useRef(load)
  loadRef.current = load
  const [lastUpdated, setLastUpdated] = useState(() => new Date())
  const [live, setLive] = useState(false)
  const refreshRef = useRef(() => {})
  const key = tables.join(',')

  useEffect(() => {
    if (!tables.length) return undefined
    let timer = null
    let stopped = false
    const run = async () => {
      try { await loadRef.current() } catch { /* המסך מציג שגיאה בעצמו */ }
      if (!stopped) setLastUpdated(new Date())
    }
    const schedule = (ms = 800) => { clearTimeout(timer); timer = setTimeout(run, ms) }
    refreshRef.current = () => schedule(0)

    const ch = supabase.channel('live-' + key.replace(/,/g, '-') + '-' + Math.random().toString(36).slice(2, 8))
    for (const t of tables) ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => schedule())
    ch.subscribe(status => { if (!stopped) setLive(status === 'SUBSCRIBED') })

    const onVisible = () => { if (document.visibilityState === 'visible') schedule(300) }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const poll = setInterval(() => { if (document.visibilityState === 'visible') run() }, pollMs)

    return () => {
      stopped = true
      clearTimeout(timer); clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      supabase.removeChannel(ch)
    }
  }, [key])

  return { live, lastUpdated, refresh: () => refreshRef.current() }
}
