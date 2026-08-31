// Edge Function: יוצר/מעדכן סיסמת התחברות (Supabase Auth) עבור מייל נתון.
// חייב לרוץ בצד שרת — משתמש ב-service_role שלא יוצא מכאן החוצה. הקורא חייב
// להיות אדמין (נבדק כאן, לא רק ב-UI) לפני שמותר לו ליצור/לאפס סיסמה לאחר.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'לא מחובר' }, 401)

  // לקוח שמייצג את הקורא בפועל — כדי לוודא מי הוא
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !caller?.email) return json({ error: 'לא מחובר' }, 401)

  // לקוח עם service_role — לבדיקת הרשאת אדמין ולפעולת היצירה/עדכון בפועל
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: callerRow } = await adminClient
    .from('team_members')
    .select('role')
    .ilike('email', caller.email)
    .maybeSingle()

  if (callerRow?.role !== 'אדמין') {
    return json({ error: 'רק אדמין יכול להגדיר סיסמה למשתמש אחר' }, 403)
  }

  const { email, password } = await req.json().catch(() => ({}))
  if (!email || !password || String(password).length < 6) {
    return json({ error: 'צריך מייל וסיסמה בת 6 תווים לפחות' }, 400)
  }

  const { error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (!createErr) return json({ ok: true, action: 'created' })

  // כנראה כבר יש משתמש עם המייל הזה — נעדכן לו את הסיסמה במקום
  const { data: listData, error: listErr } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listErr) return json({ error: listErr.message }, 500)

  const existing = listData.users.find(u => (u.email || '').toLowerCase() === String(email).toLowerCase())
  if (!existing) return json({ error: createErr.message }, 500)

  const { error: updateErr } = await adminClient.auth.admin.updateUserById(existing.id, { password })
  if (updateErr) return json({ error: updateErr.message }, 500)

  return json({ ok: true, action: 'updated' })
})
