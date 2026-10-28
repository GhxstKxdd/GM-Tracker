import { ArrowRight, CircleDashed, FileSpreadsheet, Sparkles } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { DashboardData, PerformanceStatus } from '../../../shared/models'
import { formatMetric, MetricCard } from '../components/MetricCard'
import type { PageId } from '../components/Sidebar'

const statusLabel: Record<PerformanceStatus, string> = {
  'on-track': 'On track',
  watch: 'Watch',
  behind: 'Behind'
}

export function DashboardPage({
  dashboard,
  onNavigate,
  onLoadDemo,
  onRefresh,
  canSeedDemo
}: {
  dashboard: DashboardData
  onNavigate: (page: PageId) => void
  onLoadDemo: () => void
  onRefresh: () => void
  canSeedDemo: boolean
}) {
  const currentDate = new Date()
  const currentPeriod = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`
  const selectedPeriodHasCampaignOrAttendance = dashboard.scorecards.some((card) => card.campaigns.length > 0 || card.attendance.daysRecorded > 0)
  const canPrepareSampleMonth = dashboard.teamName === 'Sample Sales Team'
    && dashboard.period === currentPeriod
    && !selectedPeriodHasCampaignOrAttendance

  return (
    <div className="page-stack">
      {!dashboard.hasData && (
        <section className="welcome-banner">
          <div className="welcome-icon"><Sparkles size={21} /></div>
          <div className="welcome-copy">
            <div className="eyebrow">SALES TEAM OVERVIEW</div>
            <h2>Track every B2B outbound result by month.</h2>
            <p>Explore the sample outbound team, or import monthly rep spreadsheets to review each agent.</p>
          </div>
          <div className="welcome-actions">
            {canSeedDemo && <button className="button button-primary" onClick={onLoadDemo} type="button">Load sales sample <ArrowRight size={16} /></button>}
            <button className="button button-light" onClick={() => onNavigate('import')} type="button"><FileSpreadsheet size={16} /> Import sales CSV</button>
          </div>
        </section>
      )}

      <section className="overview-heading">
        <div>
          <div className="eyebrow">MONTHLY SALES OVERVIEW</div>
          <h2>{dashboard.teamName}</h2>
          <p>Outbound calls, closed deals, and conversion performance for your B2B team.</p>
        </div>
        <div className="welcome-actions">
          {canSeedDemo && canPrepareSampleMonth && <button className="button button-light" onClick={onLoadDemo} type="button"><Sparkles size={15} /> Add sample campaign &amp; attendance</button>}
          <button className="button button-outline" onClick={onRefresh} type="button"><CircleDashed size={16} /> Refresh</button>
        </div>
      </section>

      <div className="metric-grid sales-metric-grid">
        {dashboard.kpis.map((metric, index) => <MetricCard key={metric.code} metric={metric} accent={['teal', 'blue', 'violet', 'amber', 'rose'][index]} />)}
      </div>

      <section className="sales-chart-grid">
        <article className="panel sales-chart-panel">
          <div className="panel-heading"><div><div className="eyebrow">DAILY ACTIVITY</div><h3>Calls per day</h3></div></div>
          {dashboard.callsPerDay.length ? <div className="sales-chart-wrap"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={dashboard.callsPerDay} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#edf0ef" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#939b98', fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={false} width={38} tick={{ fill: '#939b98', fontSize: 10 }} />
              <Tooltip formatter={(value) => [Number(value).toLocaleString('en-ZA'), 'Calls']} contentStyle={{ border: '1px solid #edf0ef', borderRadius: 10 }} />
              <Line dataKey="calls" name="Calls" type="monotone" stroke="#3974bd" strokeWidth={2.5} activeDot={{ r: 4 }} dot={false} />
            </LineChart>
          </ResponsiveContainer></div> : <div className="chart-empty"><strong>No daily call activity yet</strong><span>Daily call counts will appear when activity data is available.</span></div>}
        </article>

        <article className="panel sales-chart-panel">
          <div className="panel-heading"><div><div className="eyebrow">CONVERSION</div><h3>Win rate by rep</h3></div></div>
          {dashboard.winRateByRep.length ? <div className="sales-chart-wrap"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={dashboard.winRateByRep} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#edf0ef" />
              <XAxis dataKey="rep" tickLine={false} axisLine={false} tick={{ fill: '#64706c', fontSize: 9 }} interval={0} />
              <YAxis tickLine={false} axisLine={false} width={35} tick={{ fill: '#939b98', fontSize: 10 }} tickFormatter={(value: number) => `${value}%`} />
              <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Win rate']} contentStyle={{ border: '1px solid #edf0ef', borderRadius: 10 }} />
              <Bar dataKey="winRate" fill="#9a72c2" radius={[5, 5, 0, 0]} barSize={27} />
            </BarChart>
          </ResponsiveContainer></div> : <div className="chart-empty"><strong>No win rate data yet</strong><span>Import calls and deals closed for each rep.</span></div>}
        </article>
      </section>

      <section className="panel rep-table-panel">
        <div className="panel-heading"><div><div className="eyebrow">REP PERFORMANCE</div><h3>Monthly team table</h3></div><button className="text-button" onClick={() => onNavigate('scorecard')} type="button">Open scorecards <ArrowRight size={14} /></button></div>
        {dashboard.reps.length ? <div className="table-scroll"><table className="data-table sales-rep-table"><thead><tr><th>Rep</th><th>Calls</th><th>Closed</th><th>Conversion</th><th>Status</th></tr></thead><tbody>
          {dashboard.reps.map((rep) => <tr key={rep.repId}><td><strong>{rep.repName}</strong></td><td>{rep.calls?.toLocaleString('en-ZA') ?? '—'}</td><td>{rep.closed?.toLocaleString('en-ZA') ?? '—'}</td><td>{formatMetric(rep.conversionRate, '%')}</td><td><span className={`status-label ${rep.status ?? 'neutral'}`}>{rep.status ? statusLabel[rep.status] : 'Not entered'}</span></td></tr>)}
        </tbody></table></div> : <div className="chart-empty"><strong>No representatives in this month</strong><span>Import sales data or load the sample team.</span></div>}
      </section>

      <section className="tip-banner"><div className="tip-badge"><Sparkles size={16} /></div><p><strong>Monthly agent reviews.</strong> Open an agent scorecard to add review feedback and record the agent’s acknowledgment.</p><span className="prototype-tag">AI insights planned for a later release</span></section>
    </div>
  )
}
