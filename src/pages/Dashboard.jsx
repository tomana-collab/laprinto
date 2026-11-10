import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { formatDate, formatDateTime, isCountedOrder } from '../lib/format'
import { calcOrder } from '../lib/pricing'
import { groupOrders } from '../lib/orders'

const OPEN_TASK_STATUSES = ['לביצוע', 'בתהליך']
const CLOSED_OPP_STATUSES = ['סגור-הצלחה', 'סגור-נכשל']
const today = () => new Date().toISOString().slice(0, 10)

// תקופות לסיכום כספי: מספר חודשים אחורה (כולל החודש הנוכחי), או 0 = הכל
const PERIODS = [
  { months: 1, label: 'החודש הנוכחי' },
  { months: 2, label: 'חודשיים' },
  { months: 3, label: 'רבעון (3 חודשים)' },
  { months: 6, label: 'חצי שנה' },
  { months: 12, label: 'שנה' },
  { months: 0, label: 'הכל' },
]
const pad = n => String(n).padStart(2, '0')
function periodStart(months) {
  if (!months) return ''
  const d = new Date()
  const s = new Date(d.getFullYear(), d.getMonth() - (months - 1), 1)
  return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-01`
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [periodMonths, setPeriodMonths] = useState(1)

  useEffect(() => {
    async function load() {
      const [tasks, expenses, orders, opportunities, products, suppliers, teamMembers, ideas, trends] = await Promise.all([
        supabase.from('tasks').select('*, team_members(full_name)'),
        supabase.from('expenses').select('*, team_members(full_name)'),
        supabase.from('orders').select('id, wc_order_id, total_amount, discount_amount, quantity, order_date, order_number, sku, product_name, wc_status, products(name, product_url, cost_with_vat, extra_expenses)').order('order_date', { ascending: false }),
        supabase.from('opportunities').select('status, value'),
        supabase.from('products').select('status'),
        supabase.from('suppliers').select('id', { count: 'exact', head: true }),
        supabase.from('team_members').select('id', { count: 'exact', head: true }),
        supabase.from('ideas').select('id', { count: 'exact', head: true }),
        supabase.from('trends').select('id', { count: 'exact', head: true }),
      ])

      const firstError = [tasks, expenses, orders, opportunities, products, suppliers, teamMembers, ideas, trends]
        .find(r => r.error)
      if (firstError) { setError(firstError.error.message); return }

      setData({
        tasks: tasks.data,
        expenses: expenses.data,
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
  const totalIncome = sales.reduce((a, o) => a + (o.total_amount || 0), 0)
  const monthPrefix = new Date().toISOString().slice(0, 7)
  const monthSales = sales.filter(o => (o.order_date || '').startsWith(monthPrefix))
  const monthIncome = monthSales.reduce((a, o) => a + (o.total_amount || 0), 0)
  // הזמנה עם כמה פריטים מוצגת כשורה אחת
  const recentSales = groupOrders(sales).slice(0, 10)
  const totalExpenses = data.expenses.reduce((a, e) => a + (e.amount || 0), 0)
  const profit = totalIncome - totalExpenses
  const paidExpenses = data.expenses.filter(e => e.status === 'שולם').reduce((a, e) => a + (e.amount || 0), 0)
  const pendingExpenses = totalExpenses - paidExpenses

  const paidByTotals = {}
  for (const e of data.expenses) {
    const name = e.team_members?.full_name || 'לא צוין'
    paidByTotals[name] = (paidByTotals[name] || 0) + (e.amount || 0)
  }
  const paidByEntries = Object.entries(paidByTotals).sort((a, b) => b[1] - a[1])

  // סיכום לתקופה שנבחרה: הכנסות (הזמנות שנספרות) מול הוצאות לפי תאריך
  const from = periodStart(periodMonths)
  const periodSales = sales.filter(o => !from || (o.order_date || '') >= from)
  const periodIncome = periodSales.reduce((a, o) => a + (o.total_amount || 0), 0)
  const periodExpenses = data.expenses
    .filter(e => !from || (e.expense_date || e.created_at || '') >= from)
    .reduce((a, e) => a + (e.amount || 0), 0)
  const periodBalance = periodIncome - periodExpenses
  // רווח ממכירות לאחר עלות סחורה ועמלת סליקה (רק הזמנות שיש עלות לכל מוצריהן)
  const periodOrders = groupOrders(periodSales).map(calcOrder)
  const productProfit = periodOrders.reduce((a, c) => a + (c.profit ?? 0), 0)
  const missingCost = periodOrders.filter(c => c.profit === null).length
  const periodLabel = PERIODS.find(x => x.months === periodMonths)?.label

  const activeProducts = data.products.filter(p => p.status === 'פעיל').length

  const openTasksSorted = [...openTasks].sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1)

  return (
    <div>
      <div className="module-head"><h2>📊 דאשבורד</h2></div>

      <div className="dash-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>סיכום כספי · {periodLabel}{from ? ` (מ-${formatDate(from)})` : ''}</h3>
          <div className="status-filter" style={{ margin: 0 }}>
            {PERIODS.map(x => (
              <button key={x.months} className={periodMonths === x.months ? 'active' : ''} onClick={() => setPeriodMonths(x.months)}>{x.label}</button>
            ))}
          </div>
        </div>
        <div className="summary-row wide" style={{ marginBottom: 0 }}>
          <div className="summary-card"><span>הכנסות (מכירות כולל מע"מ)</span><b className="pos">₪{periodIncome.toLocaleString('he-IL', { maximumFractionDigits: 0 })}</b></div>
          <div className="summary-card"><span>הוצאות</span><b className="neg">₪{periodExpenses.toLocaleString('he-IL', { maximumFractionDigits: 0 })}</b></div>
          <div className="summary-card"><span>הכנסות פחות הוצאות</span><b className={periodBalance >= 0 ? 'pos' : 'neg'}>₪{periodBalance.toLocaleString('he-IL', { maximumFractionDigits: 0 })}</b></div>
          <div className="summary-card"><span>רווח ממכירות (אחרי עלות סחורה ועמלה){missingCost ? ` · ${missingCost} הזמנות בלי עלות לא נכללו` : ''}</span><b className={productProfit >= 0 ? 'pos' : 'neg'}>₪{productProfit.toLocaleString('he-IL', { maximumFractionDigits: 0 })}</b></div>
        </div>
      </div>

      <div className="dash-section">
        <h3>מכירות אחרונות</h3>
        {recentSales.length === 0 ? <div className="empty-col">אין מכירות עדיין — סנכרן הזמנות בדף ההזמנות</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>תאריך</th><th>הזמנה</th><th>מוצר</th><th>מק"ט</th><th>כמות</th><th>מכירה</th><th>רווח נטו</th></tr>
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
