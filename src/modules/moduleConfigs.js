// כל מודול מוגדר כאן: שם טבלה ב-Supabase, השדות שלו, וסוג התצוגה.
// כדי להוסיף מודול חדש בעתיד — רק מוסיפים בלוק כאן, אין צורך בקוד UI נוסף.

export const MODULES = {
  tasks: {
    key: 'tasks',
    table: 'tasks',
    label: 'משימות',
    icon: '✓',
    titleField: 'title',
    statusField: 'status',
    statusOptions: ['לביצוע', 'בתהליך', 'הושלם'],
    fields: [
      { key: 'title', label: 'כותרת', type: 'text', required: true },
      { key: 'description', label: 'תיאור', type: 'textarea' },
      { key: 'assignee', label: 'אחראי', type: 'text' },
      { key: 'priority', label: 'עדיפות', type: 'select', options: ['נמוכה', 'רגילה', 'גבוהה'], default: 'רגילה' },
      { key: 'due_date', label: 'תאריך יעד', type: 'date' },
    ],
    cardMeta: (row) => [row.assignee, row.priority, row.due_date].filter(Boolean),
  },

  ideas: {
    key: 'ideas',
    table: 'ideas',
    label: 'רעיונות',
    icon: '💡',
    titleField: 'title',
    fields: [
      { key: 'title', label: 'כותרת', type: 'text', required: true },
      { key: 'description', label: 'תיאור', type: 'textarea' },
      { key: 'tag', label: 'תגית', type: 'text' },
    ],
    cardMeta: (row) => [row.tag].filter(Boolean),
  },

  products: {
    key: 'products',
    table: 'products',
    label: 'מוצרים',
    icon: '📦',
    titleField: 'name',
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
    cardMeta: (row) => [row.supplier].filter(Boolean),
  },

  suppliers: {
    key: 'suppliers',
    table: 'suppliers',
    label: 'ספקים',
    icon: '🚚',
    titleField: 'name',
    fields: [
      { key: 'name', label: 'שם הספק', type: 'text', required: true },
      { key: 'contact_person', label: 'איש קשר', type: 'text' },
      { key: 'phone', label: 'טלפון', type: 'text' },
      { key: 'email', label: 'אימייל', type: 'text' },
      { key: 'products_supplied', label: 'מוצרים שמספק', type: 'text' },
      { key: 'terms', label: 'תנאי תשלום/הזמנה', type: 'textarea' },
      { key: 'notes', label: 'הערות', type: 'textarea' },
    ],
    cardMeta: (row) => [row.contact_person, row.phone].filter(Boolean),
  },

  opportunities: {
    key: 'opportunities',
    table: 'opportunities',
    label: 'הזדמנויות',
    icon: '🎯',
    titleField: 'title',
    statusField: 'status',
    statusOptions: ['חדש', 'בבדיקה', 'במגעים', 'סגור-הצלחה', 'סגור-נכשל'],
    fields: [
      { key: 'title', label: 'כותרת', type: 'text', required: true },
      { key: 'description', label: 'תיאור', type: 'textarea' },
      { key: 'value', label: 'שווי משוער (₪)', type: 'number' },
    ],
    cardMeta: (row) => [row.value ? `₪${row.value}` : null].filter(Boolean),
  },

  trends: {
    key: 'trends',
    table: 'trends',
    label: 'טרנדים',
    icon: '📈',
    titleField: 'title',
    fields: [
      { key: 'title', label: 'כותרת', type: 'text', required: true },
      { key: 'description', label: 'תיאור', type: 'textarea' },
      { key: 'source', label: 'מקור', type: 'text' },
      { key: 'link', label: 'קישור', type: 'text' },
    ],
    cardMeta: (row) => [row.source].filter(Boolean),
  },

  expenses: {
    key: 'expenses',
    table: 'expenses',
    label: 'הוצאות',
    icon: '💸',
    titleField: 'title',
    statusField: 'status',
    statusOptions: ['ממתין לתשלום', 'שולם'],
    // מביא גם את שם הספק המקושר מטבלת suppliers (supplier_id הוא foreign key)
    selectQuery: '*, suppliers(name)',
    fields: [
      { key: 'title', label: 'מה זה', type: 'text', required: true },
      { key: 'category', label: 'קטגוריה', type: 'select', options: ['תפעול', 'שיווק', 'משלוחים', 'ציוד', 'אחר'], default: 'תפעול' },
      { key: 'amount', label: 'סכום (₪)', type: 'number', required: true },
      { key: 'supplier_id', label: 'ספק', type: 'relation', relation: { table: 'suppliers', labelField: 'name' } },
      { key: 'expense_date', label: 'תאריך', type: 'date' },
      { key: 'payment_method', label: 'אמצעי תשלום', type: 'select', options: ['מזומן', 'אשראי', 'העברה בנקאית'], default: 'אשראי' },
      { key: 'receipt_path', label: 'חשבונית רכישה', type: 'file' },
      { key: 'notes', label: 'הערות', type: 'textarea' },
    ],
    // total/paid/pending מחושבים בצד הלקוח מתוך amount + status
    isExpense: true,
    cardMeta: (row) => [row.category, row.suppliers?.name, row.expense_date, row.amount ? `₪${row.amount}` : null, row.receipt_path ? '📎' : null].filter(Boolean),
  },
}

export const MODULE_ORDER = ['tasks', 'ideas', 'products', 'suppliers', 'opportunities', 'trends', 'expenses']
