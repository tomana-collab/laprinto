import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { getStoredTheme, setTheme } from '../lib/theme'
import GenericModule from '../modules/GenericModule'
import { MODULES } from '../modules/moduleConfigs'

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

  const isAdmin = profile?.role === 'אדמין'
  const [hook, setHook] = useState({ is_set: false, tail: null })
  const [hookUrl, setHookUrl] = useState('')
  const [hookMsg, setHookMsg] = useState(null)
  async function loadHook() {
    const { data } = await supabase.rpc('get_make_webhook_status')
    if (data) setHook(data)
  }
  useEffect(() => { if (isAdmin) loadHook() }, [isAdmin])
  async function saveHook(url) {
    setHookMsg(null)
    const { error } = await supabase.rpc('set_make_webhook_url', { p_url: url })
    if (error) { setHookMsg({ type: 'err', text: error.message }); return }
    setHookUrl('')
    setHookMsg({ type: 'ok', text: url ? 'הכתובת נשמרה' : 'הכתובת הוסרה' })
    loadHook()
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

      {isAdmin && (
        <div className="settings-section">
          <h3>Webhook: עדכון סטטוס הזמנה באתר</h3>
          <div className="settings-readonly">
            כשסטטוס הטיפול של הזמנה משתנה ל"הגיע ללקוח", ההזמנה עוברת ל"הושלם" ב-CRM ונשלח לכתובת הזו מספר ההזמנה בלבד
            (<code dir="ltr">{'{"order_number": "12345"}'}</code>). הכתובת מיועדת לסצנריו שמעדכן את סטטוס ההזמנה באתר.
          </div>
          <div className="settings-readonly">
            מצב: {hook.is_set ? `מוגדר (מסתיים ב-${hook.tail})` : 'לא מוגדר. כל עוד אין כתובת, שום דבר לא נשלח'}
          </div>
          <form onSubmit={e => { e.preventDefault(); if (hookUrl.trim()) saveHook(hookUrl.trim()) }}>
            <div className="field">
              <label>כתובת Webhook (https://...)</label>
              <input type="url" dir="ltr" value={hookUrl} onChange={e => setHookUrl(e.target.value)} placeholder={hook.is_set ? 'הזן כתובת חדשה כדי להחליף' : 'https://hook.make.com/...'} autoComplete="off" />
            </div>
            <button className="btn btn-primary" type="submit" disabled={!hookUrl.trim()}>שמירה</button>
            {hook.is_set && <button className="btn" type="button" style={{ marginInlineStart: 8 }} onClick={() => confirm('להסיר את כתובת ה-Webhook? לא יישלח כלום עד שתוגדר כתובת חדשה.') && saveHook('')}>הסרה</button>}
            {hookMsg && <div className={`settings-msg ${hookMsg.type}`}>{hookMsg.text}</div>}
          </form>
        </div>
      )}

      {isAdmin && (
        <div className="settings-users">
          <GenericModule config={MODULES.team_members} />
        </div>
      )}
    </div>
  )
}
