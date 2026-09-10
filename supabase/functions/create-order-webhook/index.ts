// Edge Function: מקבל הזמנות מ-Make (webhook חיצוני) ומכניס אותן לטבלת orders.
// אין כאן אימות משתמש (Make לא יכול להתחבר עם Supabase Auth) — במקום זה נבדק
// כותרת x-webhook-secret מול סוד קבוע שמוגדר כ-secret בפרויקט. פועל עם
// service_role כדי לעקוף RLS (מותר לו לכתוב לטבלאות למרות ש-Make הוא "אנונימי").

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET = Deno.env.get('ORDER_WEBHOOK_SECRET')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return json({ error: 'לא מורשה' }, 401)
  }

  const body = await req.json().catch(() => null)
  if (!body || !body.product || body.price === undefined) {
    return json({ error: 'צריך לפחות product ו-price' }, 400)
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: product } = await adminClient
    .from('products')
    .select('id')
    .ilike('name', body.product)
    .maybeSingle()

  if (!product) return json({ error: `לא נמצא מוצר בשם "${body.product}"` }, 404)

  let receivedById: string | null = null
  if (body.received_by) {
    const { data: member } = await adminClient
      .from('team_members')
      .select('id')
      .ilike('full_name', body.received_by)
      .maybeSingle()
    receivedById = member?.id ?? null
  }

  const { data: order, error: insertErr } = await adminClient
    .from('orders')
    .insert({
      product_id: product.id,
      price: Number(body.price),
      quantity: body.quantity !== undefined ? Number(body.quantity) : 1,
      received_by: receivedById,
      notes: body.notes || '',
      created_by: 'Make Webhook',
    })
    .select('id')
    .single()

  if (insertErr) return json({ error: insertErr.message }, 500)

  return json({ ok: true, order_id: order.id })
})
