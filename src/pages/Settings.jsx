import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { getStoredTheme, setTheme } from '../lib/theme'

export default function Settings() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [profileMsg, setProfileMsg] = useState(null)

  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordMsg, setPasswordMsg] = useState(null)

  const [theme, setThemeState] = useState(() => getStoredTheme() || 'light')

  useEffect(() => {
    if (!user?.email) return
    supabase.from('team_members').select('*').ilike('email', user.email).maybeSingle()
      .then(({ data }) => {
        setProfile(data)
        setFullName(data?.full_name || '')
        setPhone(data?.phone || '')
      })
  }, [user?.email])

  async function handleProfileSave(e) {
    e.preventDefault()
    setProfileMsg(null)
    const { error } = await supabase.from('team_members')
      .update({ full_name: fullName, phone })
      .ilike('email', user.email)
    setProfileMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: 'הפרטים עודכנו' })
  }

  async function handlePasswordSave(e) {
    e.preventDefault()
    setPasswordMsg(null)
    if (password.length < 6) { setPasswordMsg({ type: 'err', text: 'סיסמה חייבת להכיל לפחות 6 תווים' }); return }
    if (password !== passwordConfirm) { setPasswordMsg({ type: 'err', text: 'הסיסמאות לא תואמות' }); return }
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setPasswordMsg({ type: 'err', text: error.message }); return }
    setPasswordMsg({ type: 'ok', text: 'הסיסמה עודכנה' })
    setPassword('')
    setPasswordConfirm('')
  }

  function pickTheme(t) {
    setThemeState(t)
    setTheme(t)
  }

  return (
    <div>
      <div className="module-head"><h2>⚙️ הגדרות</h2></div>

      <div className="settings-section">
        <h3>הפרטים שלי</h3>
        <div className="settings-readonly">
          אימייל: {user?.email}{profile?.role ? ` · תפקיד: ${profile.role}` : ''}
        </div>
        <form onSubmit={handleProfileSave}>
          <div className="field">
            <label>שם מלא</label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} />
          </div>
          <div className="field">
            <label>טלפון</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit">שמירה</button>
          {profileMsg && <div className={`settings-msg ${profileMsg.type}`}>{profileMsg.text}</div>}
        </form>
      </div>

      <div className="settings-section">
        <h3>שינוי סיסמה</h3>
        <form onSubmit={handlePasswordSave}>
          <div className="field">
            <label>סיסמה חדשה</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label>אימות סיסמה</label>
            <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit">עדכון סיסמה</button>
          {passwordMsg && <div className={`settings-msg ${passwordMsg.type}`}>{passwordMsg.text}</div>}
        </form>
      </div>

      <div className="settings-section">
        <h3>תצוגה</h3>
        <div className="theme-toggle">
          <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => pickTheme('light')}>☀️ בהיר</button>
          <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => pickTheme('dark')}>🌙 כהה</button>
        </div>
      </div>
    </div>
  )
}
