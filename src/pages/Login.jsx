import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError('אימייל או סיסמה שגויים')
  }

  return (
    <div className="auth-screen">
      <form className="auth-box" onSubmit={handleSubmit}>
        <div className="mark">L</div>
        <h1>Laprinto CRM</h1>
        <p>התחברות למערכת</p>

        <div className="field">
          <label>אימייל</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label>סיסמה</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'מתחבר...' : 'התחברות'}
        </button>

        <div className="auth-hint">
          המשתמשים נוצרים מראש בלוח הבקרה של Supabase (Authentication → Users).
        </div>
      </form>
    </div>
  )
}
