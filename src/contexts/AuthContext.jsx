import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const AuthContext = createContext(null)
const MAX_SESSION_MS = 7 * 24 * 60 * 60 * 1000

// התנתקות + ניקוי מידע מקומי של האפליקציה (חוץ מהעדפת התצוגה). scope: 'local' = הדפדפן הזה, 'global' = כל המכשירים
async function signOutEverywhere(scope = 'local') {
  await supabase.auth.signOut({ scope }).catch(() => {})
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') || k.startsWith('cmp-')) localStorage.removeItem(k)
    sessionStorage.clear()
  } catch { /* private mode */ }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // התחברות תקפה 7 ימים לכל היותר. האכיפה האמיתית בצד השרת (supabase/migrations/2026-11-14-session-7-days.sql):
  // סשן ישן נמחק שם ובקשות שלו נחסמות. כאן רק מנתקים את הדפדפן ומנקים מידע מקומי, כדי שהמשתמש יגיע למסך ההתחברות
  // במקום לראות מסכים ריקים.
  useEffect(() => {
    if (!session) return
    const check = async () => {
      const signedInAt = new Date(session.user?.last_sign_in_at || 0).getTime()
      const tooOld = signedInAt > 0 && Date.now() - signedInAt > MAX_SESSION_MS
      // getUser פונה לשרת: סשן שנמחק שם (פג תוקף / נותק מכל המכשירים) מחזיר שגיאה
      const revoked = !tooOld && (await supabase.auth.getUser()).error?.status === 403
      if (tooOld || revoked) await signOutEverywhere('local')
    }
    check()
    const timer = setInterval(check, 15 * 60 * 1000)
    return () => clearInterval(timer)
  }, [session?.access_token])

  const value = {
    session,
    loading: session === undefined,
    user: session?.user || null,
    signOut: () => signOutEverywhere('local'),
    signOutAllDevices: () => signOutEverywhere('global'),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
