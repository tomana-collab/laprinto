import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Login() {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  function switchMode(m) {
    setMode(m)
    setError('')
    setInfo('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError('אימייל או סיסמה שגויים')
    } else {
      if (password.length < 6) {
        setError('סיסמה חייבת להכיל לפחות 6 תווים')
        setLoading(false)
        return
      }
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setInfo('נרשמת בהצלחה! מתחברים...')
    }
    setLoading(false)
  }

  return (
    <div className="auth-screen">
      <form className="auth-box" onSubmit={handleSubmit}>
        <div className="mark">L</div>
        <h1>Laprinto CRM</h1>
        <p>{mode === 'login' ? 'התחברות למערכת' : 'הרשמה למערכת'}</p>

        <div className="field">
          <label>אימייל</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label>סיסמה</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>

        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}

        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? '...' : mode === 'login' ? 'התחברות' : 'הרשמה'}
        </button>

        <div className="auth-hint">
          {mode === 'login' ? (
            <>
              עובד חדש? המנהל צריך להוסיף אותך קודם ב"משתמשים", ואז{' '}
              <button type="button" className="link-btn" onClick={() => switchMode('signup')}>תירשם כאן</button>.
            </>
          ) : (
            <>
              כבר נרשמת בעבר?{' '}
              <button type="button" className="link-btn" onClick={() => switchMode('login')}>התחברות</button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
