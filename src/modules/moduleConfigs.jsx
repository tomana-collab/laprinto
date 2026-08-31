// כל מודול מוגדר כאן: שם טבלה ב-Supabase, השדות שלו, ועמודות הטבלה בתצוגה.
// כדי להוסיף מודול חדש בעתיד — רק מוסיפים בלוק כאן, אין צורך בקוד UI נוסף.

export const MODULES = {
  tasks: {
    key: 'tasks',
    table: 'tasks',
    label: 'משימות',
    icon: '✓',
    statusField: 'status',
    statusOptions: ['לביצוע', 'בתהליך', 'הושלם'],
    fields: [
      { key: 'title', label: 'כותרת', type: 'text', required: true },
      { key: 'description', label: 'תיאור', type: 'textarea' },
      { key: 'assignee', label: 'אחראי', type: 'text' },
      { key: 'priority', label: 'עדיפות', type: 'select', options: ['נמוכה', 'רגילה', 'גבוהה'], default: 'רגילה' },
      { key: 'due_date', label: 'תאריך יעד', type: 'date' },
    ],
    columns: [
      { key: 'title', label: 'כותרת' },
      { key: 'assignee', label: 'אחראי', render: row => row.assignee || '—' },
      { key: 'priority', label: 'עדיפות' },
      { key: 'due_date', label: 'תאריך יעד', render: row => row.due_date || '—' },
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
    statusOptions: ['לבדיקה', 'להזמנה', 'פעיל', 'הופסק'],
    fields: [
      { key: 'name', label: 'שם מוצר', type: 'text', required: true },
      { key: 'supplier', label: 'ספק', type: 'text' },
      { key: 'cost', label: 'עלות ליחידה (₪)', type: 'number' },
      { key: 'extra_expenses', label: 'הוצאות נלוות ליחידה (₪)', type: 'number' },
      { key: 'price', label: 'מחיר מכירה (₪)', type: 'number' },
      { key: 'notes', label: 'הערות', type: 'textarea' },
    ],
    // profit ו-margin_percent מחושבים אוטומטית ב-DB (generated columns)
    isProduct: true,
    columns: [
      { key: 'name', label: 'שם מוצר' },
      { key: 'supplier', label: 'ספק', render: row => row.supplier || '—' },
      { key: 'cost', label: 'עלות', render: row => `₪${row.cost}` },
      { key: 'price', label: 'מחיר', render: row => `₪${row.price}` },
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
      { key: 'receipt_path', label: 'חשבונית רכישה', type: 'file' },
      { key: 'notes', label: 'הערות', type: 'textarea' },
    ],
    // total/paid/pending מחושבים בצד הלקוח מתוך amount + status
    isExpense: true,
    // מוסתר מהתפריט לעובד שאינו אדמין (וגם חסום ב-DB ברמת RLS — ראו supabase/schema.sql)
    adminOnly: true,
    columns: [
      { key: 'expense_date', label: 'תאריך' },
      { key: 'title', label: 'מה זה' },
      { key: 'category', label: 'קטגוריה' },
      { key: 'supplier', label: 'ספק', render: row => row.suppliers?.name || '—' },
      { key: 'paid_by', label: 'מי שילם', render: row => row.team_members?.full_name || '—' },
      { key: 'amount', label: 'סכום', render: row => `₪${row.amount}` },
      { key: 'receipt_path', label: 'קובץ', render: row => row.receipt_path ? '📎' : '—' },
    ],
    searchField: 'title',
    searchLabel: 'חיפוש לפי שם',
    filters: [
      { key: 'supplier_id', label: 'כל הספקים', type: 'relation', relation: { table: 'suppliers', labelField: 'name' } },
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
  },
}

export const MODULE_ORDER = ['tasks', 'ideas', 'products', 'suppliers', 'opportunities', 'trends', 'expenses', 'team_members']
