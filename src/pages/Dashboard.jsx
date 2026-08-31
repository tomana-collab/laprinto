import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { formatDate } from '../lib/format'

const OPEN_TASK_STATUSES = ['לביצוע', 'בתהליך']
const CLOSED_OPP_STATUSES = ['סגור-הצלחה', 'סגור-נכשל']
const today = () => new Date().toISOString().slice(0, 10)

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const [tasks, expenses, opportunities, products, suppliers, teamMembers, ideas, trends] = await Promise.all([
        supabase.from('tasks').select('*, team_members(full_name)'),
        supabase.from('expenses').select('*, team_members(full_name)'),
        supabase.from('opportunities').select('status, value'),
        supabase.from('products').select('status'),
        supabase.from('suppliers').select('id', { count: 'exact', head: true }),
        supabase.from('team_members').select('id', { count: 'exact', head: true }),
        supabase.from('ideas').select('id', { count: 'exact', head: true }),
        supabase.from('trends').select('id', { count: 'exact', head: true }),
      ])

      const firstError = [tasks, expenses, opportunities, products, suppliers, teamMembers, ideas, trends]
        .find(r => r.error)
      if (firstError) { setError(firstError.error.message); return }

      setData({
        tasks: tasks.data,
        expenses: expenses.data,
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

  const totalExpenses = data.expenses.reduce((a, e) => a + (e.amount || 0), 0)
  const paidExpenses = data.expenses.filter(e => e.status === 'שולם').reduce((a, e) => a + (e.amount || 0), 0)
  const pendingExpenses = totalExpenses - paidExpenses

  const paidByTotals = {}
  for (const e of data.expenses) {
    const name = e.team_members?.full_name || 'לא צוין'
    paidByTotals[name] = (paidByTotals[name] || 0) + (e.amount || 0)
  }
  const paidByEntries = Object.entries(paidByTotals).sort((a, b) => b[1] - a[1])

  const activeProducts = data.products.filter(p => p.status === 'פעיל').length

  const openTasksSorted = [...openTasks].sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1)

  return (
    <div>
      <div className="module-head"><h2>📊 דאשבורד</h2></div>

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
