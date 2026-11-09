// כל מודול מוגדר כאן: שם טבלה ב-Supabase, השדות שלו, ועמודות הטבלה בתצוגה.
// כדי להוסיף מודול חדש בעתיד — רק מוסיפים בלוק כאן, אין צורך בקוד UI נוסף.

import { formatDate, formatDateTime, ORDER_STATUS_LABELS } from '../lib/format'
import { calcOrder } from '../lib/pricing'
import { wpProductEditUrl } from '../lib/site'

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
      { key: 'cost', label: 'עלות', render: row => `₪${row.cost}` },
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
    bulkStatus: { field: 'wc_status', labels: ORDER_STATUS_LABELS },
    bulkSyncNote: 'שים לב: הזמנות מהאתר מסונכרנות מחדש — סטטוס ישתנה חזרה לפי האתר, והזמנה שנמחקה תחזור בסנכרון הבא.',
    modalWide: true,
    fields: [
      // מוצר/מחיר/כמות מסונכרנים מהאתר — מוצגים לעריכה רק בהזמנה ידנית
      { key: 'product_id', label: 'מוצר', type: 'relation', relation: { table: 'products', labelField: 'name' }, required: true, manualOnly: true },
      { key: 'price', label: 'מחיר ליחידה (₪)', type: 'number', required: true, manualOnly: true },
      { key: 'quantity', label: 'כמות', type: 'number', default: 1, required: true, manualOnly: true },
      { key: 'received_by', label: 'מי קיבל', type: 'relation', relation: { table: 'team_members', labelField: 'full_name' } },
      { key: 'notes', label: 'הערות', type: 'textarea' },
    ],
    // total_amount מחושב אוטומטית ב-DB (generated column, כמו profit במוצרים)
    isOrder: true,
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
        { value: 'open', label: 'הזמנות פתוחות', test: r => ['processing', 'pending', 'on-hold'].includes(r.wc_status) },
        { value: 'completed', label: 'הושלמו / ידניות', test: r => !r.wc_status || r.wc_status === 'completed' },
        { value: 'all', label: 'הצג את כל ההזמנות' },
      ] },
      { key: 'order_date', label: 'כל החודשים', type: 'month' },
      { key: 'wc_status', label: 'כל הסטטוסים', type: 'values', labels: ORDER_STATUS_LABELS },
    ],
    // מספר הזמנה ופרטים מלאים — בתוך חלון העריכה בלבד
    columns: [
      { key: 'order_date', label: 'תאריך', render: row => formatDateTime(row.order_date) || '—' },
      { key: 'customer_name', label: 'מזמין', render: row => row.customer_name || '—' },
      {
        // לחיצה על שם מוצר פותחת אותו לעריכה בתוך ה-CRM. כמה פריטים = כל אחד בשורה משלו
        key: 'product',
        label: 'מוצר',
        render: (row, nav) => row.lines.map(l => {
          const name = l.products?.name || l.product_name || '—'
          const label = Number(l.quantity) > 1 ? `${name} ×${l.quantity}` : name
          return (
            <div key={l.id}>
              {l.product_id
                ? <a href="#" onClick={e => { e.preventDefault(); e.stopPropagation(); nav.openRecord('products', l.product_id) }}>{label}</a>
                : label}
            </div>
          )
        }),
      },
      {
        // לחיצה על מק"ט פותחת את עריכת המוצר באתר האמיתי (wp-admin)
        key: 'sku',
        label: 'מק"ט',
        render: row => row.lines.map(l => {
          const href = wpProductEditUrl(l.products?.wc_product_id)
          return (
            <div key={l.id}>
              {l.sku && href
                ? <a href={href} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{l.sku}</a>
                : (l.sku || '—')}
            </div>
          )
        }),
      },
      {
        // מספר המוצרים (שורות פריט) בהזמנה; בסוגריים סך היחידות אם יש כמות גדולה מ-1
        key: 'items_count',
        label: 'כמות מוצרים',
        render: row => {
          const units = row.lines.reduce((a, l) => a + (Number(l.quantity) || 0), 0)
          return row.lines.length + (units > row.lines.length ? ` (${units} יח')` : '')
        },
      },
      { key: 'personalization', label: 'התאמה אישית', render: row => row.personalization ? <span title={row.personalization}>✎ יש</span> : '—' },
      { key: 'wc_status', label: 'סטטוס באתר', render: row => row.wc_status ? (ORDER_STATUS_LABELS[row.wc_status] || row.wc_status) : 'ידנית' },
      // מכירה = הסכום ששולם בפועל, כבר אחרי הנחת קופון
      { key: 'total_amount', label: 'מכירה', render: row => `₪${calcOrder(row).sale}` },
      {
        key: 'discount',
        label: 'הנחת קופון',
        render: row => {
          const { discount } = calcOrder(row)
          return discount > 0 ? <span className="neg" title={row.coupons || ''}>−₪{discount}</span> : '—'
        },
      },
      {
        key: 'cost',
        label: 'עלות (כולל מע"מ)',
        render: row => {
          const { cost, missing } = calcOrder(row)
          return cost === null ? <span title={`חסרה עלות: ${missing.join(', ')}`}>—</span> : `₪${cost}`
        },
      },
      { key: 'fee', label: 'עמלת סליקה', render: row => `₪${calcOrder(row).fee}` },
      // רווח נטו בסוף: מכירה (אחרי קופון) - עלות - עמלה
      {
        key: 'profit',
        label: 'רווח נטו',
        render: row => {
          const { profit } = calcOrder(row)
          return profit === null ? '—' : <span className={profit >= 0 ? 'pos' : 'neg'}>₪{profit}</span>
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
      { key: 'invoice_on', label: 'על שם מי החשבונית', type: 'select', options: ['', 'אמיר', 'רועי'] },
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
      { key: 'receipt_path', label: 'קובץ', render: row => row.receipt_path ? '📎' : '—' },
    ],
    searchField: 'title',
    searchLabel: 'חיפוש לפי שם',
    filters: [
      { key: 'supplier_id', label: 'כל הספקים', type: 'relation', relation: { table: 'suppliers', labelField: 'name' } },
      { key: 'invoice_on', label: 'כל השמות', type: 'values' },
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
