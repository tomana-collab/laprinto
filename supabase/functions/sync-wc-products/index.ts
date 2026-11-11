// Edge Function: מסנכרן מ-WooCommerce (laprinto.co.il) לטבלאות products ו-orders.
// גוף הבקשה: { target: 'products' | 'orders' | 'all' } (ברירת מחדל: products).
//
// מוצרים: מושך את כל המוצרים המפורסמים ומסנכרן לטבלת products. מעדכן רק נתוני אתר (שם, מחירים, קישור, תמונה) — לעולם לא נוגע בעלות,
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

// אימות דו-שלבי: למשתמש עם גורם אימות מאומת, טוקן של שלב ראשון בלבד (aal1) לא מספיק
function mfaSatisfied(user: any, bearer: string): boolean {
  const hasMfa = (user?.factors || []).some((f: any) => f.status === 'verified')
  if (!hasMfa) return true
  try {
    const payload = JSON.parse(atob(bearer.replace(/^Bearer\s+/i, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.aal === 'aal2'
  } catch { return false }
}

// קריאה מתוזמנת (pg_cron) מזוהה לפי סוד פנימי שנבדק מול ה-Vault במסד
async function isCron(req: Request): Promise<boolean> {
  const s = req.headers.get('x-cron-secret')
  if (!s) return false
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data } = await admin.rpc('verify_cron_secret', { p: s })
  return data === true
}

async function authorized(req: Request): Promise<boolean> {
  const secretHeader = req.headers.get('x-sync-secret')
  if (SYNC_SECRET && secretHeader && secretHeader === SYNC_SECRET) return true

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return false
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await callerClient.auth.getUser()
  if (!user?.email) return false
  if (!mfaSatisfied(user, authHeader)) return false

  // רק מי שרשום ב-team_members (אותה הגבלה כמו ההרשמה ל-CRM)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: member } = await admin.from('team_members').select('id').ilike('email', user.email).maybeSingle()
  return !!member
}

async function fetchAllWcProducts() {
  const auth = 'Basic ' + btoa(`${WC_KEY}:${WC_SECRET}`)
  const all: any[] = []
  for (let page = 1; page <= 50; page++) {
    const url = `${WC_SITE_URL}/wp-json/wc/v3/products?per_page=100&page=${page}&status=any`
    const res = await fetch(url, { headers: { Authorization: auth } })
    if (!res.ok) throw new Error(`WooCommerce החזיר ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const batch = await res.json()
    all.push(...batch)
    const totalPages = Number(res.headers.get('x-wp-totalpages') || 1)
    if (page >= totalPages) break
  }
  return all
}

// וריאציות של מוצר משתנה (variable). רק וריאציות מפורסמות.
async function fetchVariations(parentId: number) {
  const auth = 'Basic ' + btoa(`${WC_KEY}:${WC_SECRET}`)
  const all: any[] = []
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${WC_SITE_URL}/wp-json/wc/v3/products/${parentId}/variations?per_page=100&page=${page}`, {
      headers: { Authorization: auth },
    })
    if (!res.ok) throw new Error(`WooCommerce (וריאציות ${parentId}) החזיר ${res.status}: ${(await res.text()).slice(0, 200)}`)
    all.push(...(await res.json()))
    if (page >= Number(res.headers.get('x-wp-totalpages') || 1)) break
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

// כתובת התמונה הראשית כפי שהיא בחנות (לא מורידים ולא משכפלים).
// וריאציה: התמונה של הווריאציה אם הוגדרה, אחרת התמונה הראשית של מוצר האב.
const imageSrc = (img: any): string | null => (img && typeof img.src === 'string' && img.src.trim()) ? img.src.trim() : null
function mainImage(wc: any, parent: any | null): string | null {
  if (parent) return imageSrc(wc.image) ?? imageSrc(parent.images?.[0])
  return imageSrc(wc.images?.[0])
}

const plainText = (html: unknown) => decode(String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')).trim()
const hasDims = (d: any) => !!d && [d.length, d.width, d.height].some(v => v !== '' && v != null)

type Stats = { total: number; inserted: number; updated: number; errors: string[] }

async function syncProducts(admin: ReturnType<typeof createClient>): Promise<Stats> {
  const wcProducts = await fetchAllWcProducts()
  const catMap = await fetchAllWcCategories()

  const { data: existing, error: existingErr } = await admin.from('products').select('id, name, wc_product_id, wc_removed_at, cost, supplier_id, supplier_url, supplier_discount_percent, extra_expenses')
  if (existingErr) throw new Error(existingErr.message)

  const byWcId = new Map<number, any>()
  const unlinkedByName = new Map<string, any>()
  for (const p of existing || []) {
    if (p.wc_product_id) byWcId.set(Number(p.wc_product_id), p)
    else unlinkedByName.set(p.name.trim().toLowerCase(), p)
  }

  const now = new Date().toISOString()
  const toInsert: any[] = []
  const toUpdate: { id: string; data: any }[] = []

  // מוצר משתנה עם וריאציות → כל וריאציה הופכת למוצר נפרד (עם המק"ט שלה), והמוצר הראשי לא נכנס.
  const variableProducts = wcProducts.filter(p => p.type === 'variable' && (p.variations || []).length > 0)
  const variationsByParent = new Map<number, any[]>()
  const errors: string[] = []
  for (let i = 0; i < variableProducts.length; i += 5) {
    const chunk = variableProducts.slice(i, i + 5)
    const results = await Promise.allSettled(chunk.map(p => fetchVariations(p.id)))
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled') variationsByParent.set(chunk[idx].id, res.value)
      else errors.push(String(res.reason?.message || res.reason))
    })
  }

  const items: any[] = []
  for (const wc of wcProducts) {
    const vars = variationsByParent.get(wc.id)
    if (!vars || vars.length === 0) { items.push({ wc, name: decode(String(wc.name || '')).trim(), parent: null }); continue }
    // שורת מוצר האב (אם קיימת מסנכרון ישן) מקבלת רק את התמונה הראשית — שאר השדות שלה לא נוגעים
    const parentRow = byWcId.get(wc.id)
    const parentImg = mainImage(wc, null)
    if (parentRow && parentImg) toUpdate.push({ id: parentRow.id, data: { image_url: parentImg } })
    const parentName = decode(String(wc.name || '')).trim()
    for (const v of vars) {
      const opts = (v.attributes || []).map((a: any) => decode(String(a.option || ''))).filter(Boolean)
      items.push({
        wc: { ...v, categories: wc.categories, permalink: v.permalink || wc.permalink, status: wc.status === 'publish' ? (v.status || 'publish') : wc.status },
        name: opts.length ? `${parentName} – ${opts.join(', ')}` : `${parentName} (${v.sku || v.id})`,
        parent: wc,
      })
    }
  }

  const seenWcIds = new Set<number>(wcProducts.map((p: any) => Number(p.id)))
  for (const { wc, name, parent } of items) {
    if (!name) continue
    const siteData = {
      wc_parent_id: parent ? parent.id : null,
      wc_product_id: wc.id,
      name,
      sku: wc.sku || '',
      product_url: wc.permalink || '',
      image_url: mainImage(wc, parent),
      ...resolveCategory(wc.categories, catMap),
      price: num(wc.price) ?? 0, // המחיר הנוכחי באתר (מבצע אם פעיל), כולל מע"מ
      regular_price: num(wc.regular_price),
      sale_price: num(wc.sale_price),
      synced_at: now,
      status: wc.status === 'publish' ? 'פעיל' : 'לא פעיל', // פעיל = מפורסם באתר
      // פרטים למחקר מתחרים (תיאור, מידות, מאפיינים, תמונות, מלאי באתר)
      description: plainText(wc.description || parent?.description).slice(0, 6000),
      short_description: plainText(wc.short_description || parent?.short_description).slice(0, 2000),
      images: [imageSrc(wc.image), ...((wc.images || parent?.images || []).map(imageSrc))].filter((v, i, a) => v && a.indexOf(v) === i),
      attributes: (wc.attributes || []).map((a: any) => ({ name: decode(String(a.name || '')), value: a.option != null ? decode(String(a.option)) : (a.options || []).map((o: any) => decode(String(o))) })),
      dimensions: hasDims(wc.dimensions) ? wc.dimensions : (hasDims(parent?.dimensions) ? parent.dimensions : null),
      weight: String(wc.weight || parent?.weight || ''),
      stock_status: wc.stock_status || null,
      stock_quantity: num(wc.stock_quantity),
      wc_type: parent ? 'variation' : String(wc.type || ''),
      wc_categories: (wc.categories || []).map((c: any) => decode(String(c.name || ''))).filter(Boolean),
      wc_modified_at: wc.date_modified_gmt ? `${wc.date_modified_gmt}Z` : null,
      wc_removed_at: null,
    }
    seenWcIds.add(Number(wc.id))
    const match = byWcId.get(wc.id) || unlinkedByName.get(name.toLowerCase())
    if (match) toUpdate.push({ id: match.id, data: siteData })
    else {
      // וריאציה חדשה יורשת עלות/ספק מהמוצר הראשי אם כבר הוזנו שם
      const pr = parent ? byWcId.get(parent.id) : null
      const inherit = pr && Number(pr.cost) > 0
        ? { cost: pr.cost, supplier_id: pr.supplier_id, supplier_url: pr.supplier_url, supplier_discount_percent: pr.supplier_discount_percent, extra_expenses: pr.extra_expenses }
        : {}
      toInsert.push({ ...siteData, ...inherit, created_by: 'WooCommerce Sync' })
    }
  }

  let inserted = 0
  let updated = 0

  if (toInsert.length) {
    const { error } = await admin.from('products').insert(toInsert)
    if (error) errors.push(`הוספה: ${error.message}`)
    else inserted = toInsert.length
  }

  for (let i = 0; i < toUpdate.length; i += 20) {
    const chunk = toUpdate.slice(i, i + 20)
    const results = await Promise.all(chunk.map(u => admin.from('products').update(u.data).eq('id', u.id)))
    results.forEach((r, idx) => {
      if (r.error) errors.push(`${chunk[idx].data.name || chunk[idx].id}: ${r.error.message}`)
      else updated++
    })
  }

  // מוצר שכבר לא קיים בחנות: מסומן כהוסר בלבד. לא נמחק, וכל ההיסטוריה וההתאמות שלו נשמרות
  if (wcProducts.length > 0) {
    const gone = (existing || []).filter((p: any) => p.wc_product_id && !seenWcIds.has(Number(p.wc_product_id)) && !p.wc_removed_at).map((p: any) => p.id)
    for (let i = 0; i < gone.length; i += 100) {
      const { error } = await admin.from('products').update({ wc_removed_at: now }).in('id', gone.slice(i, i + 100))
      if (error) errors.push(`סימון מוצרים שהוסרו: ${error.message}`)
    }
  }

  return { total: items.length, inserted, updated, errors }
}

async function fetchAllWcOrders() {
  const auth = 'Basic ' + btoa(`${WC_KEY}:${WC_SECRET}`)
  const all: any[] = []
  for (let page = 1; page <= 50; page++) {
    const url = `${WC_SITE_URL}/wp-json/wc/v3/orders?per_page=100&page=${page}&status=any&orderby=date&order=desc`
    const res = await fetch(url, { headers: { Authorization: auth } })
    if (!res.ok) throw new Error(`WooCommerce (הזמנות) החזיר ${res.status}: ${(await res.text()).slice(0, 200)}`)
    all.push(...(await res.json()))
    if (page >= Number(res.headers.get('x-wp-totalpages') || 1)) break
  }
  return all
}

// כל שורת פריט בהזמנת אתר הופכת לשורה בטבלת orders (מזהה ייחודי: wc_line_item_id).
// ההזמנה נשמרת עם הסטטוס שלה באתר, כדי שביטולים/החזרים יתעדכנו בסנכרון הבא.
// הערות ו"מי קיבל" שמולאו ידנית ב-CRM לא נדרסים. נשמרים גם פרטי המזמין, כתובת המשלוח,
// אמצעי התשלום, הערת הלקוח וההתאמה האישית (מטא של שורת הפריט).
const stripTags = (v: string) => decode(v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())

// התאמה אישית ושאר שדות שהלקוח מילא נשמרים כ-meta של שורת הפריט (מפתחות שמתחילים ב-_ הם פנימיים)
function lineItemMetaText(li: any): string {
  return (li.meta_data || [])
    .filter((m: any) => !String(m.key).startsWith('_'))
    .map((m: any) => {
      const key = stripTags(String(m.display_key ?? m.key))
      const raw = m.display_value ?? m.value
      const val = stripTags(typeof raw === 'string' ? raw : JSON.stringify(raw))
      return `${key}: ${val}`
    })
    .join('\n')
}

function addressText(a: any): string {
  return [a?.address_1, a?.address_2, a?.city, a?.postcode].filter(Boolean).join(', ')
}

async function syncOrders(admin: ReturnType<typeof createClient>): Promise<Stats> {
  const wcOrders = await fetchAllWcOrders()

  const { data: products, error: pErr } = await admin.from('products').select('id, wc_product_id').not('wc_product_id', 'is', null)
  if (pErr) throw new Error(pErr.message)
  const productByWcId = new Map<number, string>()
  for (const p of products || []) productByWcId.set(Number(p.wc_product_id), p.id)

  // ב-CRM מוצגות רק הזמנות בטיפול / שהושלמו. אחרות (ממתינה לתשלום, מבוטלת...) לא נשמרות;
  // הזמנה קיימת שהשתנה סטטוס שלה רק מעדכנת את הסטטוס (ומוסתרת מהתצוגה), כדי שלא תישאר "בטיפול" בטעות
  const KEEP = ['processing', 'completed']
  const droppedByStatus = new Map<string, number[]>()
  for (const o of wcOrders) {
    if (KEEP.includes(o.status)) continue
    droppedByStatus.set(o.status, [...(droppedByStatus.get(o.status) || []), o.id])
  }
  for (const [st, ids] of droppedByStatus) {
    for (let i = 0; i < ids.length; i += 100) {
      await admin.from('orders').update({ wc_status: st }).in('wc_order_id', ids.slice(i, i + 100))
    }
  }

  const { data: existingRows } = await admin.from('orders').select('wc_line_item_id').not('wc_line_item_id', 'is', null)
  const existingIds = new Set((existingRows || []).map((r: any) => Number(r.wc_line_item_id)))

  // פרטים ברמת ההזמנה — כתובת משלוח אם קיימת, אחרת כתובת החיוב
  const orderInfo = (o: any) => {
    const ship = o.shipping?.address_1 ? o.shipping : o.billing
    const b = o.billing || {}
    return {
      customer_name: `${b.first_name || ''} ${b.last_name || ''}`.trim() || `${ship?.first_name || ''} ${ship?.last_name || ''}`.trim(),
      customer_phone: b.phone || ship?.phone || '',
      customer_email: b.email || '',
      shipping_address: [
        `${ship?.first_name || ''} ${ship?.last_name || ''}`.trim(),
        addressText(ship),
      ].filter(Boolean).join(' · '),
      shipping_method: (o.shipping_lines || []).map((l: any) => l.method_title).filter(Boolean).join(', '),
      payment_method: o.payment_method_title || o.payment_method || '',
      customer_note: o.customer_note || '',
      coupons: (o.coupon_lines || []).map((c: any) => c.code).join(', '),
      shipping_total: Math.round((Number(o.shipping_total || 0) + Number(o.shipping_tax || 0)) * 100) / 100,
      order_total: Number(o.total) || 0,
    }
  }

  const rows: any[] = []
  for (const o of wcOrders) {
    if (!KEEP.includes(o.status)) continue
    for (const li of o.line_items || []) {
      const qty = Number(li.quantity) || 1
      rows.push({
        wc_order_id: o.id,
        wc_line_item_id: li.id,
        order_number: String(o.number ?? o.id),
        order_date: o.date_created_gmt ? `${o.date_created_gmt}Z` : o.date_created,
        wc_status: o.status,
        product_name: decode(String(li.name || '')),
        sku: li.sku || '',
        ...orderInfo(o),
        personalization: lineItemMetaText(li),
        product_id: (li.variation_id ? productByWcId.get(li.variation_id) : undefined) ?? productByWcId.get(li.product_id) ?? null,
        quantity: qty,
        // מחיר ליחידה כולל מע"מ, אחרי הנחות/קופונים (li.total הוא אחרי קופון; li.subtotal לפני)
        price: Math.round(((Number(li.total) + Number(li.total_tax || 0)) / qty) * 100) / 100,
        // הנחת הקופון בש"ח לכל השורה (כולל מע"מ)
        discount_amount: Math.max(0, Math.round(
          ((Number(li.subtotal || li.total) + Number(li.subtotal_tax || li.total_tax || 0))
            - (Number(li.total) + Number(li.total_tax || 0))) * 100) / 100),
        created_by: 'WooCommerce Sync',
      })
    }
  }

  const errors: string[] = []
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from('orders').upsert(rows.slice(i, i + 200), { onConflict: 'wc_line_item_id' })
    if (error) errors.push(error.message)
  }

  const inserted = rows.filter(r => !existingIds.has(r.wc_line_item_id)).length
  return { total: rows.length, inserted, updated: rows.length - inserted, errors }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const cron = await isCron(req)
  if (!cron && !(await authorized(req))) return json({ error: 'לא מורשה' }, 401)

  if (!WC_SITE_URL || !WC_KEY || !WC_SECRET) {
    return json({ error: 'חסרים WC_SITE_URL / WC_CONSUMER_KEY / WC_CONSUMER_SECRET ב-secrets של הפרויקט' }, 500)
  }

  const body = await req.json().catch(() => ({}))
  const target = body?.target || 'products'
  if (!['products', 'orders', 'all'].includes(target)) return json({ error: 'target לא תקין' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // תיעוד הריצה ביומן המשימות + מניעת ריצה כפולה (אינדקס ייחודי על ריצה פעילה)
  await admin.from('job_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ error: 'נתקעה ולא הסתיימה' }] })
    .eq('job_type', 'wc_sync').eq('status', 'running').lt('started_at', new Date(Date.now() - 20 * 60 * 1000).toISOString())
  const { data: run, error: runErr } = await admin.from('job_runs')
    .insert({ job_type: 'wc_sync', trigger: cron ? 'cron' : 'manual', status: 'running', meta: { target } }).select('id').single()
  if (runErr) {
    if (runErr.code === '23505') return json({ error: 'סנכרון אחר כבר רץ כרגע. נסה שוב בעוד כמה דקות.' }, 409)
    return json({ error: runErr.message }, 500)
  }

  const work = async () => {
    const result: Record<string, Stats> = {}
    let fatal = ''
    try {
      // מוצרים קודם, כדי שהזמנות יקושרו למוצרים חדשים באותה ריצה
      if (target === 'products' || target === 'all') result.products = await syncProducts(admin)
      if (target === 'orders' || target === 'all') result.orders = await syncOrders(admin)
    } catch (e) {
      fatal = (e as Error).message
    }
    const all = Object.values(result)
    const errs = [...all.flatMap(r => r.errors), ...(fatal ? [fatal] : [])]
    const total = all.reduce((a, r) => a + r.total, 0)
    await admin.from('job_runs').update({
      status: fatal ? 'failed' : errs.length ? 'partial' : 'success',
      finished_at: new Date().toISOString(),
      records_total: total,
      success_count: Math.min(total, all.reduce((a, r) => a + r.inserted + r.updated, 0)),
      failure_count: errs.length,
      errors: errs.slice(0, 50).map(e => ({ error: String(e).slice(0, 300) })),
    }).eq('id', run.id)
    return { result, fatal }
  }

  // ריצה מתוזמנת: עונים מיד והעבודה ממשיכה ברקע (ה-cron לא מחכה לתשובה)
  if (cron) {
    const p = work().catch(e => console.error('wc_sync', e))
    // @ts-ignore EdgeRuntime קיים בסביבת Supabase
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p)
    return json({ ok: true, background: true, run_id: run.id }, 202)
  }

  const { result, fatal } = await work()
  if (fatal) return json({ error: fatal }, 502)
  const ok = Object.values(result).every(r => r.errors.length === 0)
  return json({ ok, ...result })
})
