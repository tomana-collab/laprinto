import { engravingText, readyCount } from '../lib/orders'
import ReadyButton from '../components/ReadyButton'
// כל מודול מוגדר כאן: שם טבלה ב-Supabase, השדות שלו, ועמודות הטבלה בתצוגה.
// כדי להוסיף מודול חדש בעתיד — רק מוסיפים בלוק כאן, אין צורך בקוד UI נוסף.

import { formatDate, formatDateTime, ORDER_STATUS_LABELS } from '../lib/format'
import { calcOrder } from '../lib/pricing'
import { supabase } from '../supabaseClient'

const SHOWN_ORDER_STATUSES = ['processing', 'completed']
const SHOWN_ORDER_LABELS = Object.fromEntries(SHOWN_ORDER_STATUSES.map(k => [k, ORDER_STATUS_LABELS[k]]))
const HANDLING_STATUSES = ['נקלט ובטיפול', 'בוצעה חריטה / אריזה', 'יצא למשלוח', 'הגיע ללקוח']

// הזמנה עם כמה מוצרים: בטבלה מוצגת שורה אחת בלבד (המוצר הראשון + "+N"), כדי שהשורות לא יתארכו.
// ריחוף מציג את כל המוצרים, ולחיצה על השורה פותחת את ההזמנה המלאה (שם כל הפריטים מופיעים בטבלה).
const lineName = l => l.products?.name || l.product_name || '—'
// עיר למשלוח: מהשדה shipping_city (מהאתר). בהזמנות שעוד לא סונכרנו מאז — מתוך הכתובת ("שם · רחוב, עיר, מיקוד")
const cityOf = row => {
  if (row.shipping_city) return row.shipping_city
  const addr = String(row.shipping_address || '').split(' · ').pop()
  const parts = addr.split(',').map(x => x.trim()).filter(x => x && !/^\d+$/.test(x))
  if (parts.length > 1) return parts[parts.length - 1]
  return parts[0] ? parts[0].split(/\s+/).pop() : ''
}
// כמה מוצרים בהזמנה יסופקו בפועל (בלי שורות שסומנו "לא לספק")
const liveCount = row => row.lines.filter(l => !l.not_supplied).length
const lineLabel = l => (Number(l.quantity) > 1 ? `${lineName(l)} ×${l.quantity}` : lineName(l))
// מלאי קיים לשורת הזמנה: קודם המוצר המקושר בשורה (כולל וריאציה) כשהמק"ט שלו זהה למק"ט בשורה, ורק אחרת לפי מק"ט.
// כך וריאציה והמוצר הראשי שלה, שחולקים מק"ט, לא מתערבבים.
const stockOf = (extra, l) => {
  if (!extra) return undefined
  const pid = extra.merged?.get(l.product_id) || l.product_id
  if (pid && extra.byId.has(pid) && (!l.sku || extra.skuById.get(pid) === l.sku)) return extra.byId.get(pid)
  return l.sku && extra.bySku.has(l.sku) ? extra.bySku.get(l.sku) : extra.byId.get(l.product_id)
}

async function toggleSupplied(l, ui) {
  const { error } = await supabase.from('orders').update({ not_supplied: !l.not_supplied }).eq('id', l.id)
  if (error) { window.alert('העדכון נכשל: ' + error.message); return }
  ui?.reload?.()
}

// פירוט הזמנה עם כמה מוצרים: מלאי קיים לכל מוצר, וכפתור לפתיחת ההזמנה
function OrderDetail({ row, nav, extra, ui }) {
  return (
    <div className="order-detail">
      <table className="data-table">
        <thead><tr><th>מוצר</th><th>מק"ט</th><th>כמות</th><th>מלאי קיים</th><th></th></tr></thead>
        <tbody>
          {/* מוצרים שהוחלפו / לא לספק בסוף הרשימה */}
          {[...row.lines].sort((x, y) => (x.not_supplied ? 1 : 0) - (y.not_supplied ? 1 : 0)).map(l => {
            const v = stockOf(extra, l)
            return (
              <tr key={l.id} style={{ cursor: 'default' }}>
                <td>
                  {l.product_id ? <a href="#" className={l.not_supplied ? 'ns-name' : ''} onClick={e => { e.preventDefault(); nav.openRecord('products', l.product_id) }}>{lineName(l)}</a> : <span className={l.not_supplied ? 'ns-name' : ''}>{lineName(l)}</span>}
                  {l.not_supplied && <span style={{ marginInlineStart: 8 }}><NotSupplied n={1} /></span>}
                  {l.has_engraving && <div style={{ fontSize: 12.5 }}>✒️ <b>חריטה אישית:</b> {engravingText(l.engraving)}</div>}
                </td>
                <td>{l.sku || '—'}</td>
                <td>{l.quantity}</td>
                <td>{l.not_supplied ? '—' : v === undefined ? '—' : <b className={v < 0 ? 'neg' : ''}>{v}</b>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{!l.not_supplied && <><ReadyButton line={l} onChanged={ui?.reload} />{' '}</>}<button type="button" className="cmp-tool" title={l.not_supplied ? 'להחזיר: המוצר יסופק' : 'לא לספק את המוצר (הכסף וההזמנה לא משתנים)'} onClick={() => toggleSupplied(l, ui)}>{l.not_supplied ? '↺ יסופק' : '✕ לא לספק'}</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="order-detail-actions">
        <button type="button" className="btn-add" onClick={ui.open}>פתח הזמנה</button>
        <button type="button" className="cmp-tool" onClick={ui.close}>סגור</button>
      </div>
    </div>
  )
}

// שורה שסומנה "לא לספק": שם חתוך באדום + תווית. הכסף וההזמנה לא משתנים
const NotSupplied = ({ n }) => <span className="sup-stock sup-out_of_stock" title="מוצר שהוחלט לא לספק (לא יורד מהמלאי)">לא לספק{n > 1 ? ` ×${n}` : ''}</span>
function OneLine({ main, count, tip, bad, pen }) {
  return (
    <div className="order-cell" title={tip}>
      {pen && <span title="חריטה אישית" style={{ marginInlineEnd: 4 }}>✒️</span>}
      <span className="order-cell-main">{main}</span>
      {count > 1 && <span className={`order-more ${bad ? 'neg' : ''}`}>+{count - 1}</span>}
    </div>
  )
}

export const MODULES = {
  tasks: {
    key: 'tasks',
    table: 'tasks',
    label: 'משימות',
    icon: '✓',
    statusField: 'status',
    statusOptions: ['לביצוע', 'בתהליך', 'הושלם'],
    // מביא גם את שם האחראי (team_members) דרך ה-foreign key
    selectQuery: '*, team_members(full_name)',
    fields: [
      { key: 'title', label: 'כותרת', type: 'text', required: true },
      { key: 'description', label: 'תיאור', type: 'textarea' },
      { key: 'assignee_id', label: 'אחראי', type: 'relation', relation: { table: 'team_members', labelField: 'full_name' } },
      { key: 'priority', label: 'עדיפות', type: 'select', options: ['נמוכה', 'רגילה', 'גבוהה'], default: 'רגילה' },
      { key: 'due_date', label: 'תאריך יעד', type: 'date' },
    ],
    columns: [
      { key: 'title', label: 'כותרת' },
      { key: 'assignee', label: 'אחראי', render: row => row.team_members?.full_name || '—' },
      { key: 'priority', label: 'עדיפות' },
      { key: 'created_by', label: 'נוצר על ידי', render: row => row.created_by || '—' },
      { key: 'due_date', label: 'תאריך יעד', render: row => formatDate(row.due_date) || '—' },
    ],
  },

  ideas: {
    key: 'ideas',
    table: 'ideas',
    label: 'רעיונות',
    icon: '💡',
    fields: [
      { key: 'title', label: 'כותרת', type: 'text', required: true },
      { key: 'description', label: 'תיאור', type: 'textarea' },
      { key: 'tag', label: 'תגית', type: 'text' },
    ],
    columns: [
      { key: 'title', label: 'כותרת' },
      { key: 'description', label: 'תיאור', render: row => row.description || '—' },
      { key: 'tag', label: 'תגית', render: row => row.tag || '—' },
    ],
  },

  products: {
    key: 'products',
    table: 'products',
    label: 'מוצרים',
    icon: '📦',
    statusField: 'status',
    statusOptions: ['פעיל', 'לא פעיל'], // מסונכרן מהאתר: מפורסם = פעיל
    // מביא גם את שם הספק (suppliers) דרך ה-foreign key
    selectQuery: '*, suppliers(name)',
    fields: [
      { key: 'name', label: 'שם מוצר', type: 'text', required: true },
      { key: 'sku', label: 'מק"ט — מסונכרן מהאתר', type: 'text' },
      { key: 'supplier_id', label: 'ספק', type: 'relation', relation: { table: 'suppliers', labelField: 'name' } },
      { key: 'supplier_url', label: 'קישור למוצר באתר הספק', type: 'text', link: 'צפייה במוצר אצל הספק' },
      { key: 'cost', label: 'עלות ליחידה מהספק (₪, לפני מע"מ)', type: 'number' },
      { key: 'supplier_discount_percent', label: 'הנחת ספק (%)', type: 'number', default: 0 },
      { key: 'extra_expenses', label: 'הוצאות נלוות ליחידה (₪)', type: 'number' },
      { key: 'price', label: 'מחיר מכירה באתר (₪) — מסונכרן מהאתר', type: 'number' },
      { key: 'product_url', label: 'קישור למוצר באתר', type: 'text', link: 'צפייה במוצר באתר' },
      { key: 'notes', label: 'הערות', type: 'textarea' },
    ],
    // cost_with_vat, clearing_fee, profit ו-margin_percent מחושבים אוטומטית ב-DB (generated columns)
    // ובטופס העריכה מוצג פירוט החישוב החי (src/lib/pricing.js)
    isProduct: true,
    // חילוק הטבלה לקבוצות לפי קטגוריה (מסונכרנת מהאתר)
    groupBy: { key: 'category', empty: 'ללא קטגוריה' },
    searchField: ['name', 'sku'],
    searchLabel: 'חיפוש לפי שם או מק"ט',
    filters: [
      { key: 'category', label: 'כל הקטגוריות', type: 'values' },
      // מה נשאר להשלים במוצרים (המספר בסוגריים מתעדכן לפי הנתונים)
      { key: 'missing', type: 'preset', options: [
        { value: 'all', label: 'כל המוצרים' },
        { value: 'no_sku', label: 'ללא מק"ט', test: r => !String(r.sku || '').trim() },
        { value: 'no_price', label: 'ללא מחיר', test: r => !(Number(r.price) > 0) },
        { value: 'no_supplier', label: 'ללא ספק', test: r => !r.supplier_id },
        { value: 'no_cost', label: 'ללא עלות', test: r => !(Number(r.cost) > 0) },
      ] },
    ],
    // לחיצה על כותרת עמודה ממיינת לפיה
    sortable: true,
    // כפתור "סנכרן מהאתר" — קורא ל-Edge Function sync-wc-products
    syncFunction: 'sync-wc-products',
    syncBody: { target: 'products' },
    syncNoun: 'מוצרים',
    columns: [
      // תמונת המוצר הראשית מ-WooCommerce (products.image_url) לצד השם
      { key: 'name', label: 'שם מוצר', render: row => (
        <div className="prod-cell">
          <div className="cmp-thumb">
            {/^https:\/\//i.test(row.image_url || '')
              ? <img src={row.image_url} alt="" width="52" height="52" loading="lazy" decoding="async" referrerPolicy="no-referrer"
                  onError={e => { e.currentTarget.replaceWith(Object.assign(document.createElement('span'), { className: 'thumb-empty', textContent: '📦' })) }} />
              : <span className="thumb-empty">📦</span>}
          </div>
          <span>{row.name}</span>
        </div>
      ) },
      { key: 'sku', label: 'מק"ט', render: row => row.sku || '—' },
      { key: 'subcategory', label: 'תת-קטגוריה', render: row => row.subcategory || '—' },
      { key: 'supplier', label: 'ספק', render: row => row.suppliers?.name || '—', sortValue: row => row.suppliers?.name || null },
      {
        key: 'supplier_url',
        noSort: true,
        label: 'אתר ספק',
        render: row => row.supplier_url
          ? <a href={row.supplier_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>פתח</a>
          : '—',
      },
      {
        key: 'product_url',
        noSort: true,
        label: 'באתר',
        render: row => row.product_url
          ? <a href={row.product_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>פתח</a>
          : '—',
      },
      { key: 'cost_after_discount', label: 'עלות (מחיר סופי אחרי הנחה)', render: row => `₪${row.cost_after_discount}` },
      { key: 'price', label: 'מחיר באתר', render: row => (
        row.sale_price != null && row.regular_price != null && row.sale_price < row.regular_price
          ? <span>₪{row.price} <s style={{ opacity: 0.55 }}>₪{row.regular_price}</s></span>
          : `₪${row.price}`
      ) },
      { key: 'cost_with_vat', label: 'עלות כולל מע"מ', render: row => `₪${row.cost_with_vat}` },
      { key: 'clearing_fee', label: 'עמלת סליקה', render: row => `₪${row.clearing_fee}` },
      // רווח בסוף: שורת התוצאה
      { key: 'profit', label: 'רווח', render: row => <span className={row.profit >= 0 ? 'pos' : 'neg'}>₪{row.profit}</span> },
      { key: 'margin_percent', label: 'מרווח', render: row => `${row.margin_percent}%` },
    ],
  },

  suppliers: {
    key: 'suppliers',
    table: 'suppliers',
    label: 'ספקים',
    icon: '🚚',
    fields: [
      { key: 'name', label: 'שם הספק', type: 'text', required: true },
      { key: 'contact_person', label: 'איש קשר', type: 'text' },
      { key: 'phone', label: 'טלפון', type: 'text' },
      { key: 'email', label: 'אימייל', type: 'text' },
      { key: 'products_supplied', label: 'מוצרים שמספק', type: 'text' },
      { key: 'terms', label: 'תנאי תשלום/הזמנה', type: 'textarea' },
      { key: 'notes', label: 'הערות', type: 'textarea' },
    ],
    columns: [
      { key: 'name', label: 'שם הספק' },
      { key: 'contact_person', label: 'איש קשר', render: row => row.contact_person || '—' },
      { key: 'phone', label: 'טלפון', render: row => row.phone || '—' },
      { key: 'email', label: 'אימייל', render: row => row.email || '—' },
    ],
  },

  opportunities: {
    key: 'opportunities',
    table: 'opportunities',
    label: 'הזדמנויות',
    icon: '🎯',
    statusField: 'status',
    statusOptions: ['חדש', 'בבדיקה', 'במגעים', 'סגור-הצלחה', 'סגור-נכשל'],
    fields: [
      { key: 'title', label: 'כותרת', type: 'text', required: true },
      { key: 'description', label: 'תיאור', type: 'textarea' },
      { key: 'value', label: 'שווי משוער (₪)', type: 'number' },
    ],
    columns: [
      { key: 'title', label: 'כותרת' },
      { key: 'description', label: 'תיאור', render: row => row.description || '—' },
      { key: 'value', label: 'שווי משוער', render: row => row.value ? `₪${row.value}` : '—' },
    ],
  },

  trends: {
    key: 'trends',
    table: 'trends',
    label: 'טרנדים',
    icon: '📈',
    fields: [
      { key: 'title', label: 'כותרת', type: 'text', required: true },
      { key: 'description', label: 'תיאור', type: 'textarea' },
      { key: 'source', label: 'מקור', type: 'text' },
      { key: 'link', label: 'קישור', type: 'text' },
    ],
    columns: [
      { key: 'title', label: 'כותרת' },
      { key: 'source', label: 'מקור', render: row => row.source || '—' },
      {
        key: 'link',
        label: 'קישור',
        render: row => row.link
          ? <a href={row.link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>קישור</a>
          : '—',
      },
    ],
  },

  orders: {
    key: 'orders',
    table: 'orders',
    label: 'הזמנות',
    icon: '🧾',
    // מביא גם את המוצר (שם/קישור/עלות) ואת מי שקיבל דרך ה-foreign keys
    selectQuery: '*, products(name, product_url, wc_product_id, cost_with_vat, extra_expenses), team_members(full_name)',
    orderBy: 'order_date',
    // שורות פריט של אותה הזמנת אתר מאוחדות להזמנה אחת (src/lib/orders.js); חלון העריכה רחב על כל הדף
    groupOrders: true,
    // בחירה מרובה + פעולות בכמות (מחיקה / עדכון סטטוס)
    bulk: true,
    bulkNoun: 'הזמנות',
    bulkStatus: [
      { field: 'handling_status', prompt: 'סטטוס טיפול ל...', labels: Object.fromEntries(HANDLING_STATUSES.map(h => [h, h])) },
      { field: 'wc_status', prompt: 'סטטוס הזמנה ל...', labels: SHOWN_ORDER_LABELS },
    ],
    // ב-CRM מוצגות רק הזמנות בטיפול / שהושלמו (והזמנות ידניות). ממתינות לתשלום, מבוטלות וכו' לא נמשכות ולא מוצגות
    rowFilter: r => !r.wc_status || SHOWN_ORDER_STATUSES.includes(r.wc_status),
    bulkSyncNote: 'שים לב: סטטוס שעודכן כאן נשאר גם אחרי הסנכרון מהאתר, אבל הזמנה שנמחקה תחזור בסנכרון הבא.',
    modalWide: true,
    // מלאי קיים לכל מוצר, כדי להציג אותו ליד כל שורת הזמנה (מקושר לפי מק"ט כמו ב-view של המלאי, ואם אין — לפי המוצר)
    extraLoad: async supabase => {
      const [{ data: prods }, { data: stock }, { data: merges }] = await Promise.all([
        supabase.from('products').select('id, sku, wc_product_id, wc_parent_id'),
        supabase.from('product_stock').select('product_id, stock'),
        supabase.from('product_merges').select('from_product_id, into_product_id'),
      ])
      const merged = new Map((merges || []).map(m => [m.from_product_id, m.into_product_id])) // מוצר שאוחד למוצר אחר: המלאי מוצג של המוצר שאליו אוחד
      const byId = new Map((stock || []).map(r => [r.product_id, Number(r.stock) || 0]))
      const skuById = new Map((prods || []).map(p => [p.id, p.sku]))
      const parents = new Set((prods || []).map(p => p.wc_parent_id).filter(Boolean)) // מוצר ראשי של וריאציות לא משמש לחיפוש לפי מק"ט
      const bySku = new Map()
      for (const p of prods || []) if (p.sku && !parents.has(p.wc_product_id) && !merged.has(p.id) && !bySku.has(p.sku)) bySku.set(p.sku, byId.get(p.id) ?? 0)
      return { byId, bySku, skuById, merged }
    },
    fields: [
      // מוצר/מחיר/כמות מסונכרנים מהאתר — מוצגים לעריכה רק בהזמנה ידנית
      { key: 'product_id', label: 'מוצר', type: 'relation', relation: { table: 'products', labelField: 'name' }, required: true, manualOnly: true },
      { key: 'customer_name', label: 'שם הלקוח / למי', type: 'text', manualOnly: true },
      { key: 'quantity', label: 'כמות', type: 'number', default: 1, required: true, manualOnly: true },
      { key: 'is_promo', label: '🎁 קד״מ — ללא חיוב (יורד מהמלאי, העלות נספרת ברווח)', type: 'checkbox', manualOnly: true },
      { key: 'price', label: 'מחיר ליחידה (₪) — ריק = המחיר באתר', type: 'number', manualOnly: true },
      { key: 'handling_status', label: 'סטטוס טיפול', type: 'select', options: ['', ...HANDLING_STATUSES] },
      { key: 'notes', label: 'הערות פנימיות', type: 'textarea' },
    ],
    // total_amount מחושב אוטומטית ב-DB (generated column, כמו profit במוצרים)
    isOrder: true,
    // הזמנה ידנית חדשה: שם ומק"ט מהמוצר (כדי שתרד מהמלאי בכל המסכים), סטטוס "בטיפול" (כדי שתופיע ברשימה כמו הזמנת אתר),
    // קד"מ = מחיר 0, ובלי מחיר = המחיר באתר. מחזיר הודעת שגיאה או null
    beforeInsert: async payload => {
      if (!payload.product_id) return 'בחר מוצר'
      const { data: p, error } = await supabase.from('products').select('name, sku, price').eq('id', payload.product_id).maybeSingle()
      if (error || !p) return error?.message || 'המוצר לא נמצא'
      payload.product_name = p.name
      payload.sku = p.sku || ''
      payload.order_date = new Date().toISOString()
      payload.wc_status = 'processing'
      payload.handling_status = payload.handling_status || null
      if (payload.is_promo) payload.price = 0
      else if (!(Number(payload.price) > 0)) payload.price = Number(p.price) || 0
      return null
    },
    liveTables: ['orders', 'stock_receipts', 'stock_receipt_items', 'products'],
    expandRender: (row, nav, extra, ui) => row.lines.length > 1 ? <OrderDetail row={row} nav={nav} extra={extra} ui={ui} /> : null,
    // כפתור "סנכרן הזמנות מהאתר" — אותה Edge Function, target=orders
    syncFunction: 'sync-wc-products',
    syncBody: { target: 'orders' },
    syncButtonLabel: '↻ סנכרן הזמנות מהאתר',
    syncNoun: 'שורות הזמנה',
    searchField: ['product_name', 'sku', 'order_number', 'customer_name', 'customer_phone'],
    searchLabel: 'חיפוש לפי מוצר, מק"ט, הזמנה או מזמין',
    filters: [
      // ברירת מחדל: רק הזמנות פתוחות (בטיפול / ממתינות לתשלום / בהמתנה). הזמנה ידנית נחשבת סגורה
      { key: 'view', type: 'preset', options: [
        { value: 'open', label: 'בטיפול', test: r => r.wc_status === 'processing' },
        { value: 'completed', label: 'הושלמו / ידניות', test: r => !r.wc_status || r.wc_status === 'completed' },
        { value: 'all', label: 'הצג את כל ההזמנות' },
      ] },
      { key: 'engraving', type: 'preset', options: [
        { value: 'all', label: 'כל ההזמנות (חריטה ובלי)' },
        { value: 'only', label: '✒️ רק הזמנות עם חריטה אישית', test: r => r.has_engraving },
      ] },
      { key: 'order_date', label: 'כל החודשים', type: 'month' },
      { key: 'handling_status', label: 'כל סטטוסי הטיפול', type: 'values' },
      { key: 'wc_status', label: 'סטטוס הזמנה', type: 'values', labels: SHOWN_ORDER_LABELS },
    ],
    // מספר הזמנה ופרטים מלאים — בתוך חלון העריכה בלבד
    columns: [
      { key: 'order_date', label: 'תאריך', render: row => formatDateTime(row.order_date) || '—' },
      { key: 'customer_name', label: 'מזמין', render: row => row.customer_name || '—' },
      { key: 'shipping_city', label: 'עיר', sortValue: row => cityOf(row), render: row => /איסוף/.test(row.shipping_method || '') ? <span className="cmp-sub">איסוף עצמי</span> : (cityOf(row) || '—') },
      {
        // הזמנה עם מוצר אחד: שם המוצר. עם כמה מוצרים: "3 מוצרים", ולחיצה עליהם פותחת פירוט (עם מלאי) מתחת לשורה
        key: 'product',
        label: 'מוצר',
        // בלי סימון "לא לספק" ברשימה: הוא מופיע רק בחלון ההזמנה ובפירוט שנפתח מתחת לשורה
        render: (row, nav, extra, ui) => row.lines.length === 1
          ? <>{row.lines[0].is_promo && <span className="sup-stock" title="קד״מ: ללא חיוב, יורד מהמלאי" style={{ marginInlineEnd: 6 }}>🎁 קד״מ</span>}<OneLine main={lineLabel(row.lines[0])} count={1} tip={lineLabel(row.lines[0])} pen={row.has_engraving} /></>
          : <button type="button" className={`order-multi ${ui?.expanded ? 'on' : ''}`} title="לחץ לפירוט המוצרים והמלאי" onClick={e => { e.stopPropagation(); ui?.toggle() }}>
              {row.has_engraving && '✒️ '}{liveCount(row) === 1 ? '1 מוצר' : `${liveCount(row)} מוצרים`} {ui?.expanded ? '▴' : '▾'}
            </button>,
      },
      {
        // מספר המוצרים (שורות פריט) בהזמנה; בסוגריים סך היחידות אם יש כמות גדולה מ-1
        key: 'items_count',
        label: 'כמות מוצרים',
        // מוצר שסומן "לא לספק" לא נספר
        sortValue: row => liveCount(row),
        render: row => {
          const live = row.lines.filter(l => !l.not_supplied)
          const units = live.reduce((a, l) => a + (Number(l.quantity) || 0), 0)
          return live.length + (units > live.length ? ` (${units} יח')` : '')
        },
      },
      {
        // מלאי קיים = נקלט - נמכר (לפי מק"ט), כמו בעמוד המלאי. בהזמנה עם כמה מוצרים: רק סיכום (הפירוט בלחיצה על "מוצרים")
        key: 'stock_left',
        label: 'מלאי קיים',
        render: (row, nav, extra) => {
          // מוצר שסומן "לא לספק" לא נספר (לא יורד מהמלאי)
          const live = row.lines.filter(l => !l.not_supplied)
          if (!live.length) return '—'
          const vals = live.map(l => stockOf(extra, l))
          // מלאי נוכחי כבר מנוכה מההזמנות הפתוחות. 0 = נשאר בדיוק למה שהוזמן; שלילי = חוסר
          if (row.lines.length === 1) return vals[0] === undefined ? '—' : <span className={vals[0] < 0 ? 'neg' : ''}>{vals[0]}</span>
          const short = vals.filter(v => v !== undefined && v < 0).length
          return short ? <span className="neg" title="מוצרים בהזמנה שאין להם מלאי">חסר ב-{short}</span> : <span className="pos">✓ במלאי</span>
        },
      },
      { key: 'engraving', label: 'חריטה אישית', sortValue: row => row.has_engraving ? 1 : 0, render: row => row.has_engraving ? <span title={engravingText(row.engraving)}>✒️ יש</span> : '—' },
      { key: 'handling_status', label: 'סטטוס טיפול', render: row => row.handling_status || '—' },
      {
        // כמה מוצרים בהזמנה סומנו "מוכן" / "נחרט ומוכן" מתוך כמה (בלי "לא לספק")
        key: 'ready',
        label: 'מוכן',
        sortValue: row => { const c = readyCount(row); return c.total ? c.ready / c.total : -1 },
        render: row => {
          const { ready, total } = readyCount(row)
          if (!total) return '—'
          if (ready === total) return <span className="ready-count pos">✓ מוכן</span>
          return <span className={`ready-count ${ready ? '' : 'neg'}`} title="מוצרים שסומנו מוכנים מתוך כל המוצרים בהזמנה">{ready}/{total}</span>
        },
      },
      // הערות פנימיות: ברשימה רק יש / אין. את ההערה עצמה רואים בתוך ההזמנה
      { key: 'notes', label: 'הערות פנימיות', sortValue: row => row.notes?.trim() ? 1 : 0, render: row => row.notes?.trim() ? '📝 יש' : '—' },
      // רווח כולל מע"מ בסוף: מכירה (אחרי קופון) - עלות - עמלה
      {
        key: 'profit',
        label: 'רווח כולל מע"מ',
        // ברשימה רק רווח כולל מע"מ (בלי עמודות מכירה ועלות, כדי שלא תהיה גלילה לצד). הפירוט במעבר עכבר ובתוך ההזמנה
        sortValue: row => calcOrder(row).profit ?? -Infinity,
        render: row => {
          const { profit, sale, cost, missing } = calcOrder(row)
          return profit === null
            ? <span title={`חסרה עלות: ${missing.join(', ')}`}>—</span>
            : <span className={profit >= 0 ? 'pos' : 'neg'} title={`מכירה ₪${sale} · עלות כולל מע"מ ₪${cost}`}>₪{profit}</span>
        },
      },
    ],
  },

  expenses: {
    key: 'expenses',
    table: 'expenses',
    label: 'הוצאות',
    icon: '💸',
    statusField: 'status',
    statusOptions: ['ממתין לתשלום', 'שולם'],
    // מביא גם את שם הספק (suppliers) ואת שם מי ששילם (team_members) דרך ה-foreign keys
    selectQuery: '*, suppliers(name), team_members(full_name)',
    fields: [
      { key: 'title', label: 'מה זה', type: 'text', required: true },
      { key: 'category', label: 'קטגוריה', type: 'select', options: ['תפעול', 'שיווק', 'משלוחים', 'ציוד', 'אחר'], default: 'תפעול' },
      { key: 'amount', label: 'סכום (₪)', type: 'number', required: true },
      { key: 'supplier_id', label: 'ספק', type: 'relation', relation: { table: 'suppliers', labelField: 'name' } },
      { key: 'paid_by', label: 'מי שילם', type: 'relation', relation: { table: 'team_members', labelField: 'full_name' } },
      { key: 'expense_date', label: 'תאריך', type: 'date' },
      { key: 'payment_method', label: 'אמצעי תשלום', type: 'select', options: ['מזומן', 'אשראי', 'העברה בנקאית'], default: 'אשראי' },
      { key: 'invoice_on', label: 'על שם מי החשבונית', type: 'select', options: ['', 'אמיר', 'רועי', 'נטלי', 'כללי'] },
      { key: 'reported_to_accountant', label: 'דווח לרו"ח', type: 'checkbox', default: false },
      { key: 'receipt_path', label: 'חשבונית רכישה', type: 'file' },
      { key: 'notes', label: 'הערות', type: 'textarea' },
    ],
    // total/paid/pending מחושבים בצד הלקוח מתוך amount + status
    isExpense: true,
    // מוסתר מהתפריט לעובד שאינו אדמין (וגם חסום ב-DB ברמת RLS — ראו supabase/schema.sql)
    adminOnly: true,
    columns: [
      { key: 'expense_date', label: 'תאריך', render: row => formatDate(row.expense_date) || '—' },
      { key: 'title', label: 'מה זה' },
      { key: 'category', label: 'קטגוריה' },
      { key: 'supplier', label: 'ספק', render: row => row.suppliers?.name || '—' },
      { key: 'paid_by', label: 'מי שילם', render: row => row.team_members?.full_name || '—' },
      { key: 'invoice_on', label: 'חשבונית על שם', render: row => row.invoice_on || '—' },
      { key: 'amount', label: 'סכום', render: row => `₪${row.amount}` },
      { key: 'reported_to_accountant', label: 'דווח לרו"ח', render: row => row.reported_to_accountant ? '✓ דווח' : '—' },
      { key: 'receipt_path', label: 'קובץ', render: row => row.receipt_path ? '📎' : '—' },
    ],
    // בחירה מרובה: סימון "דווח לרו\"ח" או מחיקה בכמות
    bulk: true,
    bulkNoun: 'הוצאות',
    bulkStatus: { field: 'reported_to_accountant', labels: { true: 'דווח לרו"ח', false: 'טרם דווח לרו"ח' }, prompt: 'סימון דווח לרו"ח...' },
    searchField: 'title',
    searchLabel: 'חיפוש לפי שם',
    filters: [
      { key: 'supplier_id', label: 'כל הספקים', type: 'relation', relation: { table: 'suppliers', labelField: 'name' } },
      { key: 'invoice_on', label: 'כל השמות', type: 'values' },
      { key: 'accountant', type: 'preset', options: [
        { value: 'all', label: 'דווח וטרם דווח' },
        { value: 'no', label: 'טרם דווח לרו"ח', test: r => !r.reported_to_accountant },
        { value: 'yes', label: 'דווח לרו"ח', test: r => !!r.reported_to_accountant },
      ] },
      { key: 'expense_date', label: 'כל החודשים', type: 'month' },
    ],
  },

  team_members: {
    key: 'team_members',
    table: 'team_members',
    label: 'משתמשים',
    icon: '👤',
    statusField: 'role',
    statusOptions: ['עובד', 'אדמין'], // עובד = ברירת מחדל למשתמש חדש, מקודמים ידנית לאדמין
    fields: [
      { key: 'full_name', label: 'שם מלא', type: 'text', required: true },
      { key: 'phone', label: 'טלפון', type: 'text' },
      { key: 'email', label: 'מייל', type: 'text' },
    ],
    columns: [
      { key: 'full_name', label: 'שם מלא' },
      { key: 'phone', label: 'טלפון', render: row => row.phone || '—' },
      { key: 'email', label: 'מייל', render: row => row.email || '—' },
    ],
    // מציג בטופס העריכה שדה "סיסמת התחברות" שקורא ל-Edge Function ייעודי
    // (לא כותב ל-team_members עצמה — יוצר/מאפס login אמיתי ב-Supabase Auth)
    hasLoginAction: true,
  },
}

export const MODULE_ORDER = ['tasks', 'ideas', 'products', 'orders', 'suppliers', 'opportunities', 'trends', 'expenses', 'team_members']
