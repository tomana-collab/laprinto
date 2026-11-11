import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'

// אימות דו-שלבי (TOTP, אפליקציית Authenticator) דרך המנגנון הרשמי של Supabase Auth.
// השער מציג את המערכת רק אחרי שההתחברות הגיעה לרמת aal2:
//   - אין עדיין גורם אימות → מסך רישום (סריקת QR + קוד ראשון).
//   - יש גורם אימות אבל ההתחברות הנוכחית רק בסיסמה → מסך הזנת קוד.
// זה רק הממשק. האכיפה האמיתית בצד השרת: policies במסד (supabase/migrations/2026-11-14-mfa-*.sql)
// ובדיקה ב-Edge Functions, כך שאי אפשר לעקוף את המסך הזה עם API או JWT של שלב ראשון.

export default function MfaGate({ children }) {
  const { session, signOut } = useAuth()
  const [state, setState] = useState('loading') // loading | enroll | challenge | ok | error
  const [factorId, setFactorId] = useState(null)
  const [error, setError] = useState('')

  async function evaluate() {
    const [aal, factors] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ])
    if (aal.error || factors.error) { setError((aal.error || factors.error).message); setState('error'); return }
    const verified = (factors.data?.totp || []).find(f => f.status === 'verified')
    if (aal.data.currentLevel === 'aal2') setState('ok')
    else if (verified) { setFactorId(verified.id); setState('challenge') }
    else setState('enroll')
  }
  useEffect(() => { evaluate() }, [session?.user?.id])

  if (state === 'ok') return children
  if (state === 'loading') return <div className="loading">טוען...</div>
  return (
    <div className="auth-screen">
      <div className="auth-box">
        <div className="mark">L</div>
        <h1>Laprinto CRM</h1>
        {state === 'error' && <><div className="auth-error">{error}</div><button className="btn btn-primary" style={{ width: '100%' }} onClick={evaluate}>נסה שוב</button></>}
        {state === 'challenge' && <Challenge factorId={factorId} onDone={evaluate} />}
        {state === 'enroll' && <Enroll onDone={evaluate} />}
        <div className="auth-hint"><button type="button" className="link-btn" onClick={signOut}>התנתקות</button></div>
      </div>
    </div>
  )
}

function CodeInput({ value, onChange }) {
  return (
    <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} dir="ltr" autoFocus
      style={{ textAlign: 'center', letterSpacing: '0.4em', fontSize: 20 }}
      value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
  )
}

// הודעות שגיאה של Supabase (קוד שגוי / יותר מדי ניסיונות) בעברית
const mfaError = e => /rate|too many/i.test(e?.message || '') ? 'יותר מדי ניסיונות. המתן דקה ונסה שוב.'
  : /invalid|expired/i.test(e?.message || '') ? 'הקוד שגוי או שפג תוקפו. הזן את הקוד העדכני מהאפליקציה.'
  : (e?.message || 'האימות נכשל')

function Challenge({ factorId, onDone }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (code.length !== 6) return
    setBusy(true); setError('')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (error) { setError(mfaError(error)); setCode(''); return }
    onDone()
  }

  return (
    <form onSubmit={submit}>
      <p>אימות דו-שלבי</p>
      <div className="field">
        <label>קוד בן 6 ספרות מאפליקציית האימות</label>
        <CodeInput value={code} onChange={setCode} />
      </div>
      {error && <div className="auth-error">{error}</div>}
      <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6} style={{ width: '100%' }}>{busy ? '...' : 'אימות וכניסה'}</button>
    </form>
  )
}

function Enroll({ onDone }) {
  const [factor, setFactor] = useState(null) // { id, qr, secret }
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start() {
    setError('')
    // גורם אימות שהרישום שלו לא הושלם בעבר נמחק, כדי לא להיתקע עם "כבר קיים"
    const { data: list } = await supabase.auth.mfa.listFactors()
    for (const f of (list?.all || []).filter(f => f.factor_type === 'totp' && f.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id })
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Laprinto CRM ${new Date().toISOString().slice(0, 10)}` })
    if (error) { setError(error.message); return }
    setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }
  useEffect(() => { start() }, [])

  async function submit(e) {
    e.preventDefault()
    if (!factor || code.length !== 6) return
    setBusy(true); setError('')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
    setBusy(false)
    if (error) { setError(mfaError(error)); setCode(''); return }
    onDone()
  }

  return (
    <form onSubmit={submit}>
      <p>הגדרת אימות דו-שלבי</p>
      <div className="auth-hint" style={{ textAlign: 'start' }}>
        1. התקן אפליקציית אימות בטלפון (Google Authenticator, Microsoft Authenticator או Authy).<br />
        2. סרוק את הקוד באפליקציה.<br />
        3. הזן כאן את הקוד בן 6 הספרות שהאפליקציה מציגה.
      </div>
      {factor && (
        <div style={{ textAlign: 'center', margin: '12px 0' }}>
          <img src={factor.qr} alt="קוד QR לסריקה באפליקציית האימות" width={180} height={180} style={{ background: '#fff', padding: 8, borderRadius: 8 }} />
          <div className="auth-hint">לא מצליח לסרוק? הזן באפליקציה את המפתח:<br /><code dir="ltr" style={{ wordBreak: 'break-all' }}>{factor.secret}</code></div>
        </div>
      )}
      <div className="field">
        <label>קוד מהאפליקציה</label>
        <CodeInput value={code} onChange={setCode} />
      </div>
      {error && <div className="auth-error">{error}</div>}
      <button className="btn btn-primary" type="submit" disabled={busy || !factor || code.length !== 6} style={{ width: '100%' }}>{busy ? '...' : 'הפעלת האימות וכניסה'}</button>
    </form>
  )
}
