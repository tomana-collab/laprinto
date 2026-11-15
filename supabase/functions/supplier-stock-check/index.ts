// Edge Function: supplier-stock-check
// בדיקת מלאי אצל הספק (ארט יודאיקה, israel-judaica.com) לפי מק"ט UK של כל מוצר פעיל.
// פונה רק לאתר הספק — לא לאתר WooCommerce שלך — ולא משנה שום דבר באתר שלך. התוצאה נשמרת ב-products
// (supplier_stock_*) ומוצר שאזל אצל הספק ועדיין פעיל באתר נרשם בדף "הודעות חשובות" (טבלת notifications).
//
// הפעלה: כל יום ב-07:00 (pg_cron) או בלחיצה ידנית. עובד בקבוצות קטנות (כמו סריקת המחירים) עם תור ב-job_runs.
// גוף הבקשה: { start: true } להתחלת ריצה, { continue: true } להמשך התור.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const url = Deno.env.get('SUPABASE_URL')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const admin = createClient(url, service)

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
}
const respond = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors })

const JOB = 'supplier_stock'
const SUPPLIER_HOST = 'www.israel-judaica.com'
const SEARCH_URL = `https://${SUPPLIER_HOST}/index.php?option=com_art&task=search.searchRedirect&lang=he`
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const BATCH = 10 // מק"טים בקבוצה (כל מק"ט = 2 בקשות לספק, בהפרש של כ-1.2 שניות)
const LOCK_MS = 4 * 60 * 1000
const GAP_MS = 1200

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function background(p: Promise<unknown>) {
  const safe = p.catch(e => console.error('background', e))
  // @ts-ignore EdgeRuntime קיים בסביבת Supabase
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(safe)
}
const israelDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date()) // YYYY-MM-DD

// ───────────── פנייה מנומסת לאתר הספק ─────────────
let lastReq = 0
async function politeFetch(href: string, init: RequestInit = {}) {
  const u = new URL(href)
  if (u.hostname !== SUPPLIER_HOST) throw new Error('כתובת מחוץ לאתר הספק')
  const wait = GAP_MS - (Date.now() - lastReq)
  if (wait > 0) await sleep(wait)
  lastReq = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 15000)
  try {
    return await fetch(href, { ...init, redirect: 'manual', signal: ctl.signal,
      headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml', 'accept-language': 'he-IL,he;q=0.9', ...(init.headers || {}) } })
  } finally { clearTimeout(timer) }
}
async function fetchRetry(href: string, init: RequestInit = {}) {
  let last: unknown
  for (let i = 0; i < 2; i++) {
    try {
      const r = await politeFetch(href, init)
      if (r.status >= 500 && i === 0) { await r.body?.cancel(); continue }
      return r
    } catch (e) { last = e }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

type Check = { status: 'in_stock' | 'out_of_stock' | 'not_found' | 'error'; detail?: string }

// מחפש את המק"ט באתר הספק (החיפוש מפנה ישר לעמוד המוצר) וקורא את מצב המלאי מתוך עמוד המוצר
async function checkSku(sku: string): Promise<Check> {
  try {
    const search = await fetchRetry(SEARCH_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'search_term=' + encodeURIComponent(sku) })
    await search.body?.cancel()
    if ([401, 403, 429].includes(search.status)) return { status: 'error', detail: 'האתר חסם את הבקשה (' + search.status + ')' }
    if (search.status >= 400) return { status: 'error', detail: 'חיפוש: HTTP ' + search.status }
    const loc = search.headers.get('location') || ''
    if (!loc) return { status: 'not_found', detail: 'החיפוש לא החזיר מוצר' }
    const next = new URL(loc, `https://${SUPPLIER_HOST}/`)
    if (next.hostname !== SUPPLIER_HOST) return { status: 'error', detail: 'הפניה לאתר אחר (חסימה): ' + next.hostname }
    if (next.searchParams.get('view') !== 'product') return { status: 'not_found', detail: 'לא נמצא מוצר במק"ט הזה' }
    next.pathname = next.pathname.replace(/\/{2,}/g, '/')
    next.searchParams.set('lang', 'he')

    const page = await fetchRetry(next.href)
    if (page.status !== 200) { await page.body?.cancel(); return { status: 'error', detail: 'עמוד מוצר: HTTP ' + page.status } }
    const html = await page.text()
    const info = html.match(/<div class="product-info">([\s\S]*?)<!-- addthis/)?.[1]
    const pageSku = info?.match(/class="product-sku">\s*([^<\s]+)/)?.[1]
    if (!info || !pageSku) return { status: 'error', detail: 'מבנה העמוד השתנה, לא נמצא מק"ט או מלאי' }
    if (pageSku.toUpperCase() !== sku.toUpperCase()) return { status: 'error', detail: `המק"ט בעמוד (${pageSku}) לא תואם` }
    return /class="out-of-stock"/.test(info) ? { status: 'out_of_stock' } : { status: 'in_stock' }
  } catch (e) {
    return { status: 'error', detail: String(e instanceof Error ? e.message : e).slice(0, 150) }
  }
}

// ───────────── תור ריצה (job_runs) ─────────────
// מוצרים שנבדקים: פעילים באתר, לא נמחקו, עם מק"ט UK (ארט יודאיקה). מק"ט כפול נבדל פעם אחת.
async function candidates() {
  const { data, error } = await admin.from('products').select('id, sku, supplier_stock_status')
    .eq('status', 'פעיל').is('wc_removed_at', null).ilike('sku', 'UK%')
  if (error) throw new Error(error.message)
  const bySku = new Map<string, { id: string; prev: string | null }[]>()
  for (const p of data || []) {
    const k = String(p.sku).trim().toUpperCase()
    if (!k) continue
    bySku.set(k, [...(bySku.get(k) || []), { id: p.id, prev: p.supplier_stock_status }])
  }
  return bySku
}

async function startRun(trigger: string) {
  await admin.from('job_runs').update({ status: 'failed', finished_at: new Date().toISOString(), locked_until: null, errors: [{ error: 'נתקעה ולא הסתיימה תוך שעתיים' }] })
    .eq('job_type', JOB).eq('status', 'running').lt('started_at', new Date(Date.now() - 2 * 3600 * 1000).toISOString())
  const total = (await candidates()).size
  const { data, error } = await admin.from('job_runs').insert({ job_type: JOB, trigger, status: 'running', records_total: total, cursor: '', meta: { batch: BATCH } }).select('id').single()
  if (error) {
    if (error.code === '23505') return { already_running: true }
    throw new Error(error.message)
  }
  return { run_id: data.id, total }
}

function chainNext() {
  background((async () => { await sleep(1500); await admin.rpc('cron_continue_scan') })())
}

async function continueRun() {
  const { data: run } = await admin.from('job_runs').select('*').eq('job_type', JOB).eq('status', 'running').order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (!run) return { idle: true }
  const nowIso = new Date().toISOString()
  const { data: locked } = await admin.from('job_runs').update({ locked_until: new Date(Date.now() + LOCK_MS).toISOString() }).eq('id', run.id).or(`locked_until.is.null,locked_until.lt.${nowIso}`).select('id')
  if (!locked?.length) return { locked: true }
  try {
    const bySku = await candidates()
    const skus = [...bySku.keys()].sort().filter(s => s > String(run.cursor || '')).slice(0, BATCH)
    let ok = 0, bad = 0
    const errs: unknown[] = Array.isArray(run.errors) ? [...run.errors] : []
    for (const sku of skus) {
      const r = await checkSku(sku)
      if (r.status === 'error') { bad++; if (errs.length < 50) errs.push({ sku, error: r.detail }); continue }
      ok++
      const now = new Date().toISOString()
      for (const p of bySku.get(sku)!) {
        const patch: Record<string, unknown> = { supplier_stock_status: r.status, supplier_stock_checked_at: now }
        // "השתנה" נרשם רק על מעבר אמיתי; בבדיקה הראשונה (אין סטטוס קודם) לא
        if (p.prev && p.prev !== r.status) patch.supplier_stock_changed_at = now
        const { error } = await admin.from('products').update(patch).eq('id', p.id)
        if (error) throw new Error('עדכון מוצר: ' + error.message)
      }
    }
    const done = skus.length < BATCH
    const success = (run.success_count || 0) + ok, fail = (run.failure_count || 0) + bad
    await admin.from('job_runs').update({
      cursor: skus.length ? skus[skus.length - 1] : run.cursor, success_count: success, failure_count: fail, errors: errs, locked_until: null,
      ...(done ? { status: fail === 0 ? 'success' : success === 0 ? 'failed' : 'partial', finished_at: new Date().toISOString() } : {}),
    }).eq('id', run.id)
    if (done) await writeNotifications(); else chainNext()
    return { run_id: run.id, processed: skus.length, done }
  } catch (e) {
    await admin.from('job_runs').update({ locked_until: null, errors: [...(Array.isArray(run.errors) ? run.errors : []), { error: String(e instanceof Error ? e.message : e).slice(0, 300) }] }).eq('id', run.id)
    throw e
  }
}

// ───────────── הודעות חשובות ─────────────
async function upsertNotification(kind: string, day: string, title: string, body: string, items: any[]) {
  const { data: ex } = await admin.from('notifications').select('id, items, read_at').eq('kind', kind).eq('day', day).maybeSingle()
  const now = new Date().toISOString()
  if (!items.length) {
    // הרשימה התרוקנה (עודכן באתר) — ההודעה נשארת ביומן, מסומנת כנקראה
    if (ex) await admin.from('notifications').update({ items: [], title, body, updated_at: now, read_at: ex.read_at ?? now }).eq('id', ex.id)
    return
  }
  if (ex) {
    const old = new Set((ex.items || []).map((i: any) => i.product_id))
    const hasNew = items.some(i => !old.has(i.product_id))
    // מוצר חדש ברשימה באותו יום מחזיר את ההודעה ל"לא נקראה"
    await admin.from('notifications').update({ title, body, items, updated_at: now, read_at: hasNew ? null : ex.read_at }).eq('id', ex.id)
  } else {
    await admin.from('notifications').insert({ kind, day, title, body, items })
  }
}

async function writeNotifications() {
  const day = israelDay()
  const { data: prods, error } = await admin.from('products')
    .select('id, name, sku, stock_status, supplier_stock_status, supplier_stock_checked_at, supplier_stock_changed_at')
    .eq('status', 'פעיל').is('wc_removed_at', null).ilike('sku', 'UK%')
  if (error) throw new Error(error.message)
  const { data: stock } = await admin.from('product_stock').select('product_id, stock').in('product_id', (prods || []).map(p => p.id))
  const own = new Map((stock || []).map((s: any) => [s.product_id, Number(s.stock) || 0]))

  // מתי סונכרנו המוצרים מהאתר לאחרונה (הסטטוס באתר נכון למועד הזה)
  const { data: runs } = await admin.from('job_runs').select('started_at, finished_at, status, meta').eq('job_type', 'wc_sync').in('status', ['success', 'partial']).order('started_at', { ascending: false }).limit(10)
  const lastSync = (runs || []).find((r: any) => ['products', 'all'].includes(r.meta?.target || 'products'))
  const syncNote = lastSync ? `סטטוס המוצרים באתר נכון לסנכרון האחרון: ${new Date(lastSync.finished_at || lastSync.started_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}. אם עדכנת באתר מאז, סנכרן מוצרים.` : 'לא ידוע מתי סונכרנו המוצרים מהאתר לאחרונה.'

  const item = (p: any) => ({ product_id: p.id, name: p.name, sku: p.sku, own_stock: own.get(p.id) ?? null, site_status: p.stock_status, supplier_status: p.supplier_stock_status, since: p.supplier_stock_changed_at, checked_at: p.supplier_stock_checked_at })
  const out = (prods || []).filter(p => p.supplier_stock_status === 'out_of_stock' && p.stock_status !== 'outofstock').map(item)
  const twoWeeks = Date.now() - 14 * 24 * 3600 * 1000
  const back = (prods || []).filter(p => p.supplier_stock_status === 'in_stock' && p.stock_status === 'outofstock'
    && p.supplier_stock_changed_at && new Date(p.supplier_stock_changed_at).getTime() > twoWeeks).map(item)

  await upsertNotification('supplier_out_of_stock', day,
    out.length ? `${out.length} מוצרים אזלו אצל הספק ועדיין פעילים באתר` : 'אין מוצרים שאזלו אצל הספק ופעילים באתר',
    'נבדק מול ארט יודאיקה. האתר שלך לא עודכן אוטומטית. ' + syncNote, out)
  await upsertNotification('supplier_back_in_stock', day,
    back.length ? `${back.length} מוצרים חזרו למלאי אצל הספק ומסומנים "אזל" באתר` : 'אין מוצרים שחזרו למלאי',
    'המוצרים האלה חזרו למלאי אצל ארט יודאיקה בשבועיים האחרונים. ' + syncNote, back)
}

// ───────────── אימות ─────────────
function mfaSatisfied(user: any, bearer: string): boolean {
  const hasMfa = (user?.factors || []).some((f: any) => f.status === 'verified')
  if (!hasMfa) return true
  try {
    const payload = JSON.parse(atob(bearer.replace(/^Bearer\s+/i, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.aal === 'aal2'
  } catch { return false }
}
// מי קורא: סוד פנימי של ה-cron (נבדק מול Vault), או אדמין מחובר
async function authenticate(req: Request): Promise<'cron' | 'admin' | null> {
  const cron = req.headers.get('x-cron-secret')
  if (cron) {
    const { data } = await admin.rpc('verify_cron_secret', { p: cron })
    return data === true ? 'cron' : null
  }
  const bearer = req.headers.get('authorization') || ''
  if (!bearer.startsWith('Bearer ')) return null
  const client = createClient(url, anon, { global: { headers: { Authorization: bearer } } })
  const { data: { user }, error: userError } = await client.auth.getUser()
  if (userError || !user?.email) return null
  if (!mfaSatisfied(user, bearer)) return null
  const { data: members, error: memErr } = await admin.from('team_members').select('id').ilike('email', user.email).eq('role', 'אדמין').limit(1)
  return !memErr && members?.length ? 'admin' : null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)
  const who = await authenticate(req)
  if (!who) return respond({ error: 'Unauthorized' }, 401)
  const body = await req.json().catch(() => ({}))
  try {
    if (body?.start) {
      const r = await startRun(who === 'cron' ? 'cron' : 'manual')
      if ('already_running' in r) return respond({ ok: false, already_running: true }, 409)
      if (who === 'cron') { background(continueRun()); return respond({ ok: true, ...r, background: true }, 202) }
      const c = await continueRun()
      return respond({ ok: true, ...r, first_batch: c })
    }
    if (body?.continue) {
      if (who === 'cron') { background(continueRun()); return respond({ ok: true, background: true }, 202) }
      return respond({ ok: true, ...(await continueRun()) })
    }
    return respond({ error: 'חסר start או continue' }, 400)
  } catch (e) {
    return respond({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, 500)
  }
})
