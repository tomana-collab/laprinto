// Supabase Edge Function: competitor-research-api
// API מוגבל לסוכן מחקר המתחרים (ChatGPT Pro). אימות במפתח ייעודי (כותרת x-research-key או Authorization: Bearer),
// שנבדק בצד השרת מול hash במסד. הסוכן לא מקבל service_role ולא יכול לבחור טבלאות או עמודות:
// כל פעולה כאן מחזירה רשימת שדות קבועה. אין גישה להזמנות, לקוחות, עלויות, רווחיות או ספקים.
//
// כללים שנאכפים כאן ובטריגרים הקיימים במסד:
//  - התאמה חדשה נשמרת תמיד כ-pending (אישור אוטומטי רק לפי הכלל הקיים במסד: מק"ט מאומת זהה).
//  - התאמה קיימת (מאושרת / דחויה / ממתינה) לא נדרסת ולא נמחקת.
//  - הכתובת חייבת להיות https בדומיין של חנות מתחרה קיימת (טריגר validate_competitor_offer_url).
//  - ה-API לא מוריד שום כתובת בעצמו (אין סיכון SSRF).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

// השדות היחידים שהסוכן רואה על מוצר. בלי cost / profit / margin / supplier.
const PRODUCT_COLS = 'id, wc_product_id, wc_parent_id, name, sku, category, subcategory, wc_categories, price, regular_price, sale_price, product_url, image_url, images, description, short_description, attributes, dimensions, weight, stock_status, research_status, last_researched_at, research_notes'
const PRODUCT_LIST_COLS = 'id, name, sku, category, subcategory, price, product_url, image_url, research_status, last_researched_at, next_research_at'
const OFFER_COLS = 'id, product_id, store_id, product_url, competitor_sku, competitor_title, match_type, confidence, review_status, price_scan_enabled, created_at'

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const clampInt = (v: unknown, min: number, max: number, def: number) => Math.min(max, Math.max(min, Math.floor(Number(v)) || def))
// מונע הזרקת תנאים לסינון של PostgREST בחיפוש חופשי
const safeSearch = (v: unknown) => str(v, 80).replace(/[%,()*\\]/g, ' ').trim()

// מקור המחיר שהסוכן מדווח → collection_method לפי הסכמה הקיימת (direct_product_page | store_api | search_result | manual)
const PRICE_SOURCES: Record<string, string> = {
  product_page: 'direct_product_page',     // המחיר נראה בעמוד המוצר עצמו
  structured_data: 'direct_product_page',  // JSON-LD / meta בעמוד המוצר
  store_api: 'store_api',                  // API ציבורי של החנות
  search_result: 'search_result',          // תוצאת חיפוש / עמוד קטגוריה — פחות אמין
}
const priceNote = (b: any) => [
  'ChatGPT research',
  'source=' + String(b.price_source || 'search_result'),
  'seen_at=' + new Date().toISOString(),
  str(b.price_evidence || b.note, 300),
].filter(Boolean).join(' | ')

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

// מוצרים פעילים שאינם מוצרי אב עם וריאציות (האב לא נמכר בעצמו)
async function parentIds(): Promise<Set<number>> {
  const { data } = await admin.from('products').select('wc_parent_id').not('wc_parent_id', 'is', null)
  return new Set((data || []).map((r: any) => Number(r.wc_parent_id)))
}

const actions: Record<string, (b: any) => Promise<unknown>> = {
  async list_categories() {
    const { data, error } = await admin.from('products').select('category, subcategory, research_status').eq('status', 'פעיל').is('wc_removed_at', null)
    if (error) throw new ApiError(500, error.message)
    const map = new Map<string, { category: string; products: number; pending_research: number; subcategories: Set<string> }>()
    for (const p of data || []) {
      const c = p.category || 'ללא קטגוריה'
      const e = map.get(c) || { category: c, products: 0, pending_research: 0, subcategories: new Set<string>() }
      e.products++
      if (p.research_status === 'pending') e.pending_research++
      if (p.subcategory) e.subcategories.add(p.subcategory)
      map.set(c, e)
    }
    return { categories: [...map.values()].map(e => ({ ...e, subcategories: [...e.subcategories] })) }
  },

  // מוצרים שממתינים למחקר (ברירת מחדל) או לפי סטטוס/קטגוריה/חיפוש
  async list_products(b) {
    const limit = clampInt(b.limit, 1, 50, 25)
    const offset = clampInt(b.offset, 0, 100000, 0)
    const status = ['pending', 'partial', 'researched', 'no_competitors', 'all'].includes(b.research_status) ? b.research_status : 'pending'
    let q = admin.from('products').select(PRODUCT_LIST_COLS + ', wc_product_id', { count: 'exact' })
      .eq('status', 'פעיל').is('wc_removed_at', null).order('category').order('name')
    // "pending" = כל מה שממתין למחקר עכשיו: חדש, או שהגיע מועד המחקר החוזר שלו (30 יום)
    if (status === 'pending') q = q.or(`research_status.eq.pending,next_research_at.lte.${new Date().toISOString()}`)
    else if (status !== 'all') q = q.eq('research_status', status)
    if (str(b.category, 120)) q = q.eq('category', str(b.category, 120))
    const s = safeSearch(b.search)
    if (s) q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%`)
    const { data, error, count } = await q.range(offset, offset + limit - 1)
    if (error) throw new ApiError(500, error.message)
    const parents = await parentIds()
    const products = (data || []).filter((p: any) => !parents.has(Number(p.wc_product_id))).map(({ wc_product_id: _w, ...p }: any) => p)
    return { total: count, offset, limit, products }
  },

  async get_product(b) {
    let q = admin.from('products').select(PRODUCT_COLS)
    if (isUuid(b.product_id)) q = q.eq('id', b.product_id)
    else if (str(b.sku, 80)) q = q.eq('sku', str(b.sku, 80))
    else throw new ApiError(400, 'product_id or sku is required')
    const { data, error } = await q.limit(1).maybeSingle()
    if (error) throw new ApiError(500, error.message)
    if (!data) throw new ApiError(404, 'product not found')
    const { data: offers } = await admin.from('competitor_offers').select(OFFER_COLS).eq('product_id', data.id)
    return { product: data, existing_offers: offers || [] }
  },

  async list_stores() {
    const { data, error } = await admin.from('competitor_stores').select('id, name, domain, priority, enabled').order('priority')
    if (error) throw new ApiError(500, error.message)
    return { stores: data }
  },

  // הוספת מועמד למוצר מתחרה. תמיד pending; קיים = לא נוגעים.
  async add_candidate(b) {
    if (!isUuid(b.product_id)) throw new ApiError(400, 'product_id is required')
    const url = str(b.product_url, 2048)
    if (!/^https:\/\/[^/\s]+\/\S+/i.test(url)) throw new ApiError(400, 'product_url must be an https product page URL')

    let storeId = isUuid(b.store_id) ? b.store_id : null
    if (!storeId) {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
      const { data: st } = await admin.from('competitor_stores').select('id').eq('domain', host).maybeSingle()
      storeId = st?.id || null
    }
    if (!storeId) throw new ApiError(422, 'unknown competitor store for this URL; use propose_store and wait for admin approval')

    const { data: product } = await admin.from('products').select('id').eq('id', b.product_id).maybeSingle()
    if (!product) throw new ApiError(404, 'product not found')

    const { data: existing } = await admin.from('competitor_offers').select(OFFER_COLS)
      .eq('product_id', b.product_id).eq('store_id', storeId).eq('product_url', url).maybeSingle()
    if (existing) return { created: false, reason: 'offer already exists and was left unchanged', offer: existing }

    const matchType = ['exact', 'variant', 'similar', 'candidate'].includes(b.match_type) ? b.match_type : 'candidate'
    const skuSource = ['product_page', 'url', 'structured_data'].includes(b.sku_verification_source) ? b.sku_verification_source : 'unverified'
    const confidence = Math.min(1, Math.max(0, Number(b.confidence)))
    const { data, error } = await admin.from('competitor_offers').insert({
      product_id: b.product_id,
      store_id: storeId,
      product_url: url,
      competitor_title: str(b.competitor_title, 300) || null,
      competitor_sku: str(b.competitor_sku, 80) || null,
      competitor_image_url: /^https:\/\//i.test(str(b.competitor_image_url, 2048)) ? str(b.competitor_image_url, 2048) : null,
      match_type: matchType,
      confidence: Number.isFinite(confidence) ? confidence : 0.5,
      variant_notes: str(b.variant_notes, 500) || null,
      sku_verification_source: skuSource,
      review_status: 'pending',
      entry_method: 'discovered',
      discovered_via: ['chatgpt_research'],
      matching_evidence: { source: 'chatgpt_research', notes: str(b.notes, 2000), evidence: str(b.evidence, 2000), found_price: Number(b.price) > 0 ? Number(b.price) : null, researched_at: new Date().toISOString() },
    }).select(OFFER_COLS).single()
    if (error) throw new ApiError(422, error.message)

    await admin.from('products').update({ last_researched_at: new Date().toISOString() }).eq('id', b.product_id)

    // מחיר שנמצא במחקר נשמר כתצפית מחיר (לא משנה שום מחיר של Laprinto)
    let price_saved = false
    if (Number(b.price) > 0 && Number(b.price) < 100000) {
      const { error: pErr } = await admin.from('competitor_price_checks').insert({
        offer_id: data.id, price: Math.round(Number(b.price) * 100) / 100, availability: 'unknown',
        collection_method: PRICE_SOURCES[String(b.price_source)] || 'search_result', source_url: url, source_crawl_hint: 'chatgpt research',
        note: priceNote(b),
      })
      price_saved = !pErr
    }
    return { created: true, offer: data, price_saved }
  },

  // שמירת מחיר להתאמה קיימת (שאינה דחויה). חובה לציין מקור אימות מדויק.
  async record_price(b) {
    if (!isUuid(b.offer_id)) throw new ApiError(400, 'offer_id is required')
    const price = Number(b.price)
    if (!(price > 0 && price < 100000)) throw new ApiError(400, 'price must be a positive number (ILS, incl. VAT, without shipping)')
    const method = PRICE_SOURCES[String(b.price_source)]
    if (!method) throw new ApiError(400, 'price_source is required: ' + Object.keys(PRICE_SOURCES).join(' | '))
    const { data: offer } = await admin.from('competitor_offers').select('id, product_url, review_status, product_id').eq('id', b.offer_id).maybeSingle()
    if (!offer) throw new ApiError(404, 'offer not found')
    if (offer.review_status === 'rejected') throw new ApiError(409, 'offer was rejected; prices are not recorded for rejected offers')
    const availability = ['in_stock', 'out_of_stock', 'unknown'].includes(b.availability) ? b.availability : 'unknown'
    const shipping = Number(b.shipping_price)
    const { error } = await admin.from('competitor_price_checks').insert({
      offer_id: offer.id, price: Math.round(price * 100) / 100, availability,
      shipping_price: shipping >= 0 && shipping < 10000 && b.shipping_price != null ? shipping : null,
      collection_method: method, source_url: offer.product_url, source_crawl_hint: 'chatgpt research',
      note: priceNote(b),
    })
    if (error) throw new ApiError(422, error.message)
    await admin.from('products').update({ last_researched_at: new Date().toISOString() }).eq('id', offer.product_id)
    return { saved: true, collection_method: method }
  },

  // הצעת חנות מתחרה חדשה — נשמרת לאישור אדמין ולא נכנסת לרשימת החנויות
  async propose_store(b) {
    const domain = str(b.domain, 240).toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '')
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) throw new ApiError(400, 'domain is invalid')
    const name = str(b.name, 120)
    if (name.length < 2) throw new ApiError(400, 'name is required')
    const { data: known } = await admin.from('competitor_stores').select('id, name, domain').eq('domain', domain).maybeSingle()
    if (known) return { created: false, reason: 'store already exists', store: known }
    const evidence = str(b.evidence_url, 2048)
    const { data, error } = await admin.from('competitor_store_candidates')
      .upsert({ name, domain, evidence_url: /^https:\/\//i.test(evidence) ? evidence : null, notes: str(b.notes, 1000) || null }, { onConflict: 'domain', ignoreDuplicates: true })
      .select('id, name, domain, status')
    if (error) throw new ApiError(422, error.message)
    if (!data?.length) {
      const { data: prev } = await admin.from('competitor_store_candidates').select('id, name, domain, status').eq('domain', domain).maybeSingle()
      return { created: false, reason: 'store was already proposed', candidate: prev }
    }
    return { created: true, candidate: data[0], note: 'pending admin approval; offers for this store can be added only after approval' }
  },

  // מנת מחקר של 10–20 מוצרים. מוצר שנלקח למנה לא יוחזר שוב במשך 24 שעות, עד שמסמנים אותו כנחקר.
  async claim_batch(b) {
    const size = clampInt(b.size, 10, 20, 10)
    const nowIso = new Date().toISOString()
    const staleIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    let q = admin.from('products').select('id, wc_product_id, name, sku, category')
      .eq('status', 'פעיל').is('wc_removed_at', null)
      .or(`research_status.eq.pending,next_research_at.lte.${nowIso}`)
      .or(`research_claimed_at.is.null,research_claimed_at.lt.${staleIso}`)
      .order('category').order('name').limit(size * 3)
    if (str(b.category, 120)) q = q.eq('category', str(b.category, 120))
    const { data, error } = await q
    if (error) throw new ApiError(500, error.message)
    const parents = await parentIds()
    const picked = (data || []).filter((p: any) => !parents.has(Number(p.wc_product_id))).slice(0, size)
    if (!picked.length) return { batch_id: null, products: [], note: 'no products are waiting for research' }
    const batchId = crypto.randomUUID()
    const { error: uErr } = await admin.from('products').update({ research_claimed_at: nowIso, research_batch_id: batchId }).in('id', picked.map((p: any) => p.id))
    if (uErr) throw new ApiError(500, uErr.message)
    const { data: full } = await admin.from('products').select(PRODUCT_COLS).in('id', picked.map((p: any) => p.id)).order('category').order('name')
    return { batch_id: batchId, size: picked.length, products: full || [] }
  },

  // התקדמות: מה נשאר במנה, וכמה מוצרים בכל סטטוס מחקר
  async progress(b) {
    const { data, error } = await admin.from('products').select('id, wc_product_id, research_status, next_research_at, research_batch_id, research_claimed_at')
      .eq('status', 'פעיל').is('wc_removed_at', null)
    if (error) throw new ApiError(500, error.message)
    const parents = await parentIds()
    const rows = (data || []).filter((p: any) => !parents.has(Number(p.wc_product_id)))
    const now = Date.now()
    const counts: Record<string, number> = { pending: 0, partial: 0, researched: 0, no_competitors: 0 }
    let due = 0
    for (const p of rows) {
      counts[p.research_status] = (counts[p.research_status] || 0) + 1
      if (p.research_status === 'pending' || (p.next_research_at && new Date(p.next_research_at).getTime() <= now)) due++
    }
    const open = isUuid(b.batch_id) ? rows.filter((p: any) => p.research_batch_id === b.batch_id && p.research_claimed_at).map((p: any) => p.id) : undefined
    return { total_products: rows.length, by_status: counts, waiting_for_research_now: due, open_in_batch: open }
  },

  // סיום מחקר של מוצר. רק שדות המחקר מתעדכנים.
  //  researched     — נמצא לפחות מועמד אחד.
  //  partial        — מחקר חלקי, לא נמצא מתחרה. חוזר למחקר בעוד 30 יום.
  //  no_competitors — מותר רק אם נבדקו כל החנויות הפעילות (stores_checked); אחרת נשמר כ-partial. נבדק שוב בעוד 30 יום.
  async mark_researched(b) {
    if (!isUuid(b.product_id)) throw new ApiError(400, 'product_id is required')
    let status = ['researched', 'partial', 'no_competitors'].includes(b.status) ? b.status : 'partial'
    let downgraded = false
    if (status === 'no_competitors') {
      const { data: stores } = await admin.from('competitor_stores').select('id').eq('enabled', true)
      const checked = new Set((Array.isArray(b.stores_checked) ? b.stores_checked : []).filter(isUuid))
      if (!(stores || []).every((s: any) => checked.has(s.id))) { status = 'partial'; downgraded = true }
    }
    if (status === 'researched') {
      const { count } = await admin.from('competitor_offers').select('id', { count: 'exact', head: true }).eq('product_id', b.product_id)
      if (!count) { status = 'partial'; downgraded = true }
    }
    const next = status === 'researched' ? null : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
    const { data, error } = await admin.from('products')
      .update({ research_status: status, last_researched_at: new Date().toISOString(), next_research_at: next, research_notes: str(b.notes, 2000) || null, research_claimed_at: null })
      .eq('id', b.product_id).select('id, research_status, last_researched_at, next_research_at').maybeSingle()
    if (error) throw new ApiError(500, error.message)
    if (!data) throw new ApiError(404, 'product not found')
    return { product: data, ...(downgraded ? { note: 'saved as partial: no_competitors requires stores_checked to include every enabled store, and researched requires at least one saved candidate' } : {}) }
  },
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)
  const key = req.headers.get('x-research-key') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!key || key.length < 20 || key.length > 200) return respond({ error: 'Unauthorized' }, 401)

  const { data: keyId, error: keyErr } = await admin.rpc('verify_research_key', { p: key })
  if (keyErr) return respond({ error: /rate_limited/.test(keyErr.message) ? 'Rate limit exceeded, slow down' : 'Unauthorized' }, /rate_limited/.test(keyErr.message) ? 429 : 401)
  if (!keyId) return respond({ error: 'Unauthorized' }, 401)

  const raw = await req.text()
  if (raw.length > 20000) return respond({ error: 'Request too large' }, 413)
  let body: any = {}
  try { body = raw ? JSON.parse(raw) : {} } catch { return respond({ error: 'Invalid JSON' }, 400) }

  const action = String(body?.action || '')
  const handler = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null
  if (!handler) return respond({ error: 'Unknown action', actions: Object.keys(actions) }, 400)

  let status = 200
  let out: unknown
  try {
    out = await handler(body)
  } catch (e) {
    status = e instanceof ApiError ? e.status : 500
    out = { error: e instanceof ApiError ? e.message : 'Internal error' }
    if (!(e instanceof ApiError)) console.error(action, e)
  }
  await admin.from('research_api_log').insert({ key_id: keyId, action, ok: status === 200, detail: status === 200 ? null : JSON.stringify(out).slice(0, 300) })
  return respond(out, status)
})
