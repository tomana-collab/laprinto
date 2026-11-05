// Edge Function: מושך את כל המוצרים המפורסמים מ-WooCommerce (laprinto.co.il) ומסנכרן
// לטבלת products. מעדכן רק נתוני אתר (שם, מחירים, קישור) — לעולם לא נוגע בעלות,
// הוצאות נלוות, ספק, הערות או סטטוס של מוצר קיים.
//
// מי יכול להפעיל:
//  1. משתמש מחובר ל-CRM (כפתור "סנכרן מהאתר")
//  2. קריאה אוטומטית (pg_cron / Make) עם כותרת x-sync-secret התואמת ל-SYNC_SECRET
//
// Secrets נדרשים: WC_SITE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET (הרשאת Read מספיקה),
// ו-SYNC_SECRET (רק לקריאה אוטומטית).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
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
const WC_SITE_URL = (Deno.env.get('WC_SITE_URL') || '').replace(/\/$/, '')
const WC_KEY = Deno.env.get('WC_CONSUMER_KEY')
const WC_SECRET = Deno.env.get('WC_CONSUMER_SECRET')
const SYNC_SECRET = Deno.env.get('SYNC_SECRET')

const num = (v: unknown) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v))

// HTML entities בשמות מוצרים מ-WooCommerce (&amp; וכו')
const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

async function authorized(req: Request): Promise<boolean> {
  const secretHeader = req.headers.get('x-sync-secret')
  if (SYNC_SECRET && secretHeader && secretHeader === SYNC_SECRET) return true

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return false
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await callerClient.auth.getUser()
  if (!user?.email) return false

  // רק מי שרשום ב-team_members (אותה הגבלה כמו ההרשמה ל-CRM)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: member } = await admin.from('team_members').select('id').ilike('email', user.email).maybeSingle()
  return !!member
}

async function fetchAllWcProducts() {
  const auth = 'Basic ' + btoa(`${WC_KEY}:${WC_SECRET}`)
  const all: any[] = []
  for (let page = 1; page <= 50; page++) {
    const url = `${WC_SITE_URL}/wp-json/wc/v3/products?per_page=100&page=${page}&status=publish`
    const res = await fetch(url, { headers: { Authorization: auth } })
    if (!res.ok) throw new Error(`WooCommerce החזיר ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const batch = await res.json()
    all.push(...batch)
    const totalPages = Number(res.headers.get('x-wp-totalpages') || 1)
    if (page >= totalPages) break
  }
  return all
}

type WcCat = { id: number; name: string; slug: string; parent: number }

async function fetchAllWcCategories(): Promise<Map<number, WcCat>> {
  const auth = 'Basic ' + btoa(`${WC_KEY}:${WC_SECRET}`)
  const map = new Map<number, WcCat>()
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${WC_SITE_URL}/wp-json/wc/v3/products/categories?per_page=100&page=${page}`, {
      headers: { Authorization: auth },
    })
    if (!res.ok) throw new Error(`WooCommerce (קטגוריות) החזיר ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const batch: WcCat[] = await res.json()
    batch.forEach(c => map.set(c.id, c))
    if (page >= Number(res.headers.get('x-wp-totalpages') || 1)) break
  }
  return map
}

// בוחר את הקטגוריה העמוקה ביותר של המוצר ומחזיר אותה + השורש שלה
function resolveCategory(wcCats: any[] | undefined, catMap: Map<number, WcCat>) {
  const depth = (id: number) => {
    let d = 0
    for (let c = catMap.get(id); c && c.parent && d < 10; c = catMap.get(c.parent)) d++
    return d
  }
  const real = (wcCats || []).filter(c => c.slug !== 'uncategorized')
  if (!real.length) return { category: '', subcategory: '' }
  const deepest = real.reduce((a, b) => (depth(b.id) > depth(a.id) ? b : a))
  let root = catMap.get(deepest.id)
  for (let i = 0; root && root.parent && catMap.get(root.parent) && i < 10; i++) root = catMap.get(root.parent)
  const rootName = decode(root?.name || deepest.name)
  const deepName = decode(deepest.name)
  return { category: rootName, subcategory: deepName === rootName ? '' : deepName }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!(await authorized(req))) return json({ error: 'לא מורשה' }, 401)

  if (!WC_SITE_URL || !WC_KEY || !WC_SECRET) {
    return json({ error: 'חסרים WC_SITE_URL / WC_CONSUMER_KEY / WC_CONSUMER_SECRET ב-secrets של הפרויקט' }, 500)
  }

  let wcProducts: any[]
  let catMap: Map<number, WcCat>
  try {
    wcProducts = await fetchAllWcProducts()
    catMap = await fetchAllWcCategories()
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: existing, error: existingErr } = await admin.from('products').select('id, name, wc_product_id')
  if (existingErr) return json({ error: existingErr.message }, 500)

  const byWcId = new Map<number, any>()
  const unlinkedByName = new Map<string, any>()
  for (const p of existing || []) {
    if (p.wc_product_id) byWcId.set(Number(p.wc_product_id), p)
    else unlinkedByName.set(p.name.trim().toLowerCase(), p)
  }

  const now = new Date().toISOString()
  const toInsert: any[] = []
  const toUpdate: { id: string; data: any }[] = []

  for (const wc of wcProducts) {
    const name = decode(String(wc.name || '')).trim()
    if (!name) continue
    const siteData = {
      wc_product_id: wc.id,
      name,
      product_url: wc.permalink || '',
      ...resolveCategory(wc.categories, catMap),
      price: num(wc.price) ?? 0, // המחיר הנוכחי באתר (מבצע אם פעיל), כולל מע"מ
      regular_price: num(wc.regular_price),
      sale_price: num(wc.sale_price),
      synced_at: now,
    }
    const match = byWcId.get(wc.id) || unlinkedByName.get(name.toLowerCase())
    if (match) toUpdate.push({ id: match.id, data: siteData })
    else toInsert.push({ ...siteData, status: 'לבדיקה', created_by: 'WooCommerce Sync' })
  }

  let inserted = 0
  let updated = 0
  const errors: string[] = []

  if (toInsert.length) {
    const { error } = await admin.from('products').insert(toInsert)
    if (error) errors.push(`הוספה: ${error.message}`)
    else inserted = toInsert.length
  }

  for (let i = 0; i < toUpdate.length; i += 20) {
    const chunk = toUpdate.slice(i, i + 20)
    const results = await Promise.all(chunk.map(u => admin.from('products').update(u.data).eq('id', u.id)))
    results.forEach((r, idx) => {
      if (r.error) errors.push(`${chunk[idx].data.name}: ${r.error.message}`)
      else updated++
    })
  }

  return json({ ok: errors.length === 0, total: wcProducts.length, inserted, updated, errors })
})
