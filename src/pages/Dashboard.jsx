import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { formatDate, formatDateTime, isCountedOrder, FINANCE_START } from '../lib/format'
import { calcOrder, receiptsTotalWithVat } from '../lib/pricing'
import { groupOrders } from '../lib/orders'
import { loadSimpleStock } from '../components/SimpleStock'

const OPEN_TASK_STATUSES = ['לביצוע', 'בתהליך']
const CLOSED_OPP_STATUSES = ['סגור-הצלחה', 'סגור-נכשל']
const today = () => new Date().toISOString().slice(0, 10)

// תקופות לסיכום כספי. range מחזיר [from, to) בתאריכים YYYY-MM-DD ('' = בלי גבול)
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const PERIODS = [
  { key: 'month', label: 'החודש', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ''] } },
  { key: 'last', label: 'חודש שעבר', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 1))] } },
  { key: 'quarter', label: 'רבעון (3 חודשים)', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth() - 2, 1)), ''] } },
  { key: 'custom', label: 'מותאם אישית', range: null },
  { key: 'all', label: 'הכל', range: () => ['', ''] },
]
const ils = n => `₪${Math.round(n).toLocaleString('he-IL')}`

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState('month') // ברירת מחדל: החודש
  const [customFrom, setCustomFrom] = useState(() => ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [customTo, setCustomTo] = useState(() => ymd(new Date()))
  const [stock, setStock] = useState(null) // שווי הסחורה שבמלאי (חלון "במלאי")
  useEffect(() => { loadSimpleStock().then(setStock).catch(() => setStock([])) }, [])

  useEffect(() => {
    async function load() {
      const [tasks, expenses, receipts, orders, opportunities, products, suppliers, teamMembers, ideas, trends] = await Promise.all([
        supabase.from('tasks').select('*, team_members(full_name)'),
        supabase.from('expenses').select('*, team_members(full_name)'),
        supabase.from('stock_receipts').select('doc_date, created_at, stock_receipt_items(quantity, unit_cost, discount_percent)'),
        supabase.from('orders').select('id, wc_order_id, total_amount, discount_amount, quantity, order_date, order_number, sku, product_name, wc_status, not_supplied, manual_line, product_id, replaces_line_id, shipping_total, shipping_method, products(name, product_url, cost_with_vat, extra_expenses)').order('order_date', { ascending: false }),
        supabase.from('opportunities').select('status, value'),
        supabase.from('products').select('status'),
        supabase.from('suppliers').select('id', { count: 'exact', head: true }),
        supabase.from('team_members').select('id', { count: 'exact', head: true }),
        supabase.from('ideas').select('id', { count: 'exact', head: true }),
        supabase.from('trends').select('id', { count: 'exact', head: true }),
      ])

      const firstError = [tasks, expenses, receipts, orders, opportunities, products, suppliers, teamMembers, ideas, trends]
        .find(r => r.error)
      if (firstError) { setError(firstError.error.message); return }

      setData({
        tasks: tasks.data,
        expenses: expenses.data,
        receipts: receipts.data,
        orders: orders.data,
        opportunities: opportunities.data,
        products: products.data,
        suppliersCount: suppliers.count || 0,
        teamMembersCount: teamMembers.count || 0,
        ideasCount: ideas.count || 0,
        trendsCount: trends.count || 0,
      })
    }
    load()
  }, [])

  if (error) return <div className="err-inline">{error}</div>
  if (!data) return <div className="loading">טוען...</div>

  const openTasks = data.tasks.filter(t => OPEN_TASK_STATUSES.includes(t.status))
  const closedTasks = data.tasks.filter(t => t.status === 'הושלם')
  const totalTasks = data.tasks.length
  const openPct = totalTasks > 0 ? Math.round((openTasks.length / totalTasks) * 100) : 0

  const openOpps = data.opportunities.filter(o => !CLOSED_OPP_STATUSES.includes(o.status))
  const openOppsValue = openOpps.reduce((a, o) => a + (o.value || 0), 0)

  // ביטולים/החזרים/ממתינות לתשלום לא נספרים כהכנסה
  const sales = data.orders.filter(isCountedOrder)
  // הזמנה עם כמה פריטים מוצגת כשורה אחת
  const recentSales = groupOrders(sales).slice(0, 10)
  const totalExpenses = data.expenses.reduce((a, e) => a + (e.amount || 0), 0)
  const paidExpenses = data.expenses.filter(e => e.status === 'שולם').reduce((a, e) => a + (e.amount || 0), 0)
  const pendingExpenses = totalExpenses - paidExpenses

  const paidByTotals = {}
  for (const e of data.expenses) {
    const name = e.team_members?.full_name || 'לא צוין'
    paidByTotals[name] = (paidByTotals[name] || 0) + (e.amount || 0)
  }
  const paidByEntries = Object.entries(paidByTotals).sort((a, b) => b[1] - a[1])

  // סיכום לתקופה שנבחרה. לא סופרים לפני FINANCE_START
  const P = PERIODS.find(x => x.key === period)
  const [rawFrom, to] = P.range ? P.range() : [customFrom, customTo ? ymd(new Date(new Date(customTo).getTime() + 86400000)) : '']
  const from = [rawFrom, FINANCE_START].sort().pop()
  const inPeriod = o => { const d = String(o.order_date || '').slice(0, 10); return d >= from && (!to || d < to) }
  const periodSales = sales.filter(inPeriod)
  // לפי הזמנה (שורות של אותה הזמנה מאוחדות; מוצר שהוחלף לא נספר פעמיים)
  const periodOrders = groupOrders(periodSales).map(calcOrder)
  const known = periodOrders.filter(c => c.cost !== null)
  const missingCost = periodOrders.length - known.length
  const salesProducts = periodOrders.reduce((a, c) => a + c.sale, 0)          // מכר מוצרים (אחרי קופונים, בלי משלוח)
  const salesKnown = known.reduce((a, c) => a + c.sale, 0)
  const cogs = known.reduce((a, c) => a + c.cost, 0)                          // עלות המוצרים שנמכרו (כולל מע"מ)
  const grossProfit = salesKnown - cogs                                       // מכר פחות עלות מוצרים
  const productProfit = known.reduce((a, c) => a + c.profit, 0)               // אחרי משלוח, עמלת סליקה ועלות משלוח
  const periodIncome = periodOrders.reduce((a, c) => a + c.paid, 0)           // כל מה ששולם (כולל משלוח)
  // הוצאות = קליטת תעודות ספק (כולל מע"מ) בתקופה
  const periodExpenses = (data.receipts || []).filter(r => { const d = String(r.doc_date || r.created_at || '').slice(0, 10); return !to || d < to })
    .reduce((a, r) => a + receiptsTotalWithVat([r], from), 0)
  const periodBalance = periodIncome - periodExpenses
  const periodLabel = P.key === 'custom' ? 'מותאם אישית' : P.label
  // סחורה שבמלאי ולא נמכרה (נקלט − נמכר − פחת, לפי מק"ט) — לא תלוי בתקופה
  const inStock = (stock || []).filter(r => r.stock > 0)
  const stockCost = inStock.reduce((a, r) => a + r.costValue, 0)
  const stockSale = inStock.reduce((a, r) => a + r.saleValue, 0)
  const stockNoCost = inStock.filter(r => !r.cost).length

  const activeProducts = data.products.filter(p => p.status === 'פעיל').length

  const openTasksSorted = [...openTasks].sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1)

  return (
    <div>
      <div className="module-head"><h2>📊 דאשבורד</h2></div>

      <div className="dash-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>סיכום כספי · {periodLabel}{from ? ` (מ-${formatDate(from)}${to ? ` עד ${formatDate(ymd(new Date(new Date(to).getTime() - 86400000)))}` : ''})` : ''}</h3>
          <div className="status-filter" style={{ margin: 0 }}>
            {PERIODS.map(x => (
              <button key={x.key} className={period === x.key ? 'active' : ''} onClick={() => setPeriod(x.key)}>{x.label}</button>
            ))}
          </div>
        </div>
        {period === 'custom' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <label>מתאריך <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></label>
            <label>עד תאריך <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} /></label>
          </div>
        )}
        <div className="summary-row wide">
          <div className="summary-card"><span>סה״כ מכר בהזמנות ({periodOrders.length} הזמנות, מוצרים אחרי קופונים, כולל מע״מ, בלי משלוח)</span><b className="pos">{ils(salesProducts)}</b></div>
          <div className="summary-card"><span>עלות המוצרים שנמכרו (כולל מע״מ){missingCost ? ` · ${missingCost} הזמנות בלי עלות לא נכללו` : ''}</span><b className="neg">−{ils(cogs)}</b></div>
          <div className="summary-card"><span>רווח על ההזמנות (מכר פחות עלות מוצרים)</span><b className={grossProfit >= 0 ? 'pos' : 'neg'}>{ils(grossProfit)}</b></div>
          <div className="summary-card"><span>רווח כולל מע״מ אחרי משלוח ועמלת סליקה</span><b className={productProfit >= 0 ? 'pos' : 'neg'}>{ils(productProfit)}</b></div>
        </div>
        <div className="summary-row wide" style={{ marginBottom: 0 }}>
          <div className="summary-card"><span>סחורה במלאי שלא נמכרה — לפי עלות קנייה (כולל מע״מ){stockNoCost ? ` · ${stockNoCost} מוצרים בלי עלות` : ''}</span><b>{stock ? ils(stockCost) : '…'}</b></div>
          <div className="summary-card"><span>אותה סחורה לפי מחיר באתר</span><b>{stock ? ils(stockSale) : '…'}</b></div>
          <div className="summary-card"><span>כל מה ששולם בתקופה (כולל משלוח)</span><b>{ils(periodIncome)}</b></div>
          <div className="summary-card"><span>קליטת תעודות בתקופה (כולל מע״מ)</span><b className="neg">{ils(periodExpenses)}</b></div>
          <div className="summary-card"><span>ששולם פחות קליטת תעודות</span><b className={periodBalance >= 0 ? 'pos' : 'neg'}>{ils(periodBalance)}</b></div>
        </div>
      </div>

      <div className="dash-section">
        <h3>מכירות אחרונות</h3>
        {recentSales.length === 0 ? <div className="empty-col">אין מכירות עדיין — סנכרן הזמנות בדף ההזמנות</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>תאריך</th><th>הזמנה</th><th>מוצר</th><th>מק"ט</th><th>כמות</th><th>מכירה</th><th>רווח כולל מע"מ</th></tr>
              </thead>
              <tbody>
                {recentSales.map((o, i) => {
                  const c = calcOrder(o)
                  return (
                    <tr key={i} style={{ cursor: 'default' }}>
                      <td>{formatDateTime(o.order_date) || '—'}</td>
                      <td>{o.order_number ? `#${o.order_number}` : '—'}</td>
                      <td>{o.lines.map(l => {
                        const name = l.products?.name || l.product_name || '—'
                        return <div key={l.id}>{l.products?.product_url ? <a href={l.products.product_url} target="_blank" rel="noreferrer">{name}</a> : name}</div>
                      })}</td>
                      <td>{o.sku || '—'}</td>
                      <td>{o.quantity}</td>
                      <td>₪{c.sale}</td>
                      <td>{c.profit === null ? '—' : <span className={c.profit >= 0 ? 'pos' : 'neg'}>₪{c.profit}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="kpi-grid">
        <div className="summary-card"><span>משימות פתוחות</span><b>{openTasks.length}</b></div>
        <div className="summary-card"><span>הזדמנויות פתוחות</span><b>{openOpps.length} · ₪{openOppsValue.toFixed(0)}</b></div>
        <div className="summary-card"><span>סה"כ הוצאות</span><b>₪{totalExpenses.toFixed(0)}</b></div>
        <div className="summary-card"><span>הוצאות ממתינות</span><b className="neg">₪{pendingExpenses.toFixed(0)}</b></div>
        <div className="summary-card"><span>מוצרים פעילים</span><b>{activeProducts}</b></div>
        <div className="summary-card"><span>ספקים</span><b>{data.suppliersCount}</b></div>
        <div className="summary-card"><span>אנשי צוות</span><b>{data.teamMembersCount}</b></div>
        <div className="summary-card"><span>רעיונות / טרנדים</span><b>{data.ideasCount} / {data.trendsCount}</b></div>
      </div>

      <div className="dash-section">
        <h3>משימות: פתוחות מול סגורות</h3>
        {totalTasks === 0 ? <div className="empty-col">אין משימות עדיין</div> : (
          <div className="pie-row">
            <div
              className="pie-chart"
              style={{ background: `conic-gradient(var(--violet) 0% ${openPct}%, var(--chart-teal) ${openPct}% 100%)` }}
            />
            <div className="pie-legend">
              <div className="pie-legend-item">
                <span className="pie-swatch" style={{ background: 'var(--violet)' }} />
                פתוחות — <b>{openTasks.length}</b> ({openPct}%)
              </div>
              <div className="pie-legend-item">
                <span className="pie-swatch" style={{ background: 'var(--chart-teal)' }} />
                הושלמו — <b>{closedTasks.length}</b> ({100 - openPct}%)
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="dash-section">
        <h3>משימות פתוחות ובתהליך</h3>
        {openTasksSorted.length === 0 ? <div className="empty-col">אין משימות פתוחות</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>כותרת</th><th>אחראי</th><th>סטטוס</th><th>תאריך יעד</th></tr>
              </thead>
              <tbody>
                {openTasksSorted.map(t => {
                  const overdue = t.due_date && t.due_date < today()
                  return (
                    <tr key={t.id}>
                      <td>{t.title}</td>
                      <td>{t.team_members?.full_name || '—'}</td>
                      <td>{t.status}</td>
                      <td className={overdue ? 'dash-overdue' : ''}>{formatDate(t.due_date) || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="dash-section">
        <h3>הוצאות</h3>
        <div className="summary-row" style={paidByEntries.length === 0 ? { marginBottom: 0 } : undefined}>
          <div className="summary-card"><span>סה"כ הוצאות</span><b>₪{totalExpenses.toFixed(0)}</b></div>
          <div className="summary-card"><span>שולם</span><b className="pos">₪{paidExpenses.toFixed(0)}</b></div>
          <div className="summary-card"><span>ממתין לתשלום</span><b className="neg">₪{pendingExpenses.toFixed(0)}</b></div>
        </div>
        {paidByEntries.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>מי שילם</th><th>סה"כ ששילם</th></tr></thead>
              <tbody>
                {paidByEntries.map(([name, total]) => (
                  <tr key={name}><td>{name}</td><td>₪{total.toFixed(0)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
