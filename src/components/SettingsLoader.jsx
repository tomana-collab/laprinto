import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { setShippingCost } from '../lib/pricing'

// טוען את הגדרות המערכת (app_settings) לפני הצגת המסכים, כדי שהחישובים (למשל עלות משלוח ברווח) יהיו נכונים מההתחלה
export default function SettingsLoader({ children }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    supabase.from('app_settings').select('key, value').then(({ data }) => {
      const get = k => (data || []).find(r => r.key === k)?.value
      setShippingCost(get('shipping_cost'))
      setReady(true) // גם אם הטעינה נכשלה: ממשיכים עם ברירת מחדל (0)
    })
  }, [])
  if (!ready) return <div className="loading">טוען...</div>
  return children
}
