import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// כשנכנסים אחרי שהטוקן פג, supabase-js מחדש אותו ומיד שולח את הבקשה הראשונה. לפעמים השעון של שרת הנתונים
// מפגר בשנייה-שתיים אחרי שרת ההתחברות, והוא דוחה את הטוקן הטרי עם "JWT issued at future".
// במקרה כזה מחכים רגע ומנסים שוב, במקום להציג שגיאה במסך הראשון.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function fetchWithClockSkewRetry(input, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(input, init)
    if (res.status !== 401 || attempt >= 3) return res
    const text = await res.clone().text().catch(() => '')
    if (!/issued at future/i.test(text)) return res
    await sleep(1000 * (attempt + 1))
  }
}

export const supabase = createClient(url, anonKey, { global: { fetch: fetchWithClockSkewRetry } })
