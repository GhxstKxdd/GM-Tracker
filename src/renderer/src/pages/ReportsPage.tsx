import { ArrowDownToLine, Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AuditEntry, MonthlyReport, RepScorecard } from '../../../shared/models'
import { formatMetric } from '../components/MetricCard'

function quote(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

function downloadReport(period: string, scorecard: RepScorecard): void {
  const rows = [
    ['Individual monthly performance review', scorecard.repName, period],
    [],
    ['KPI', 'Target', 'Actual', 'Achievement %', 'Status', 'Note'],
    ...scorecard.kpis.map((item) => [item.name, item.target ?? '', item.actual ?? '', item.achievement?.toFixed(1) ?? '', item.status ?? 'not entered', item.note]),
    [],
    ['Campaign', 'Days tracked', 'Lead target', 'Leads made', 'Achievement %'],
    ...scorecard.campaigns.map((item) => [item.campaign, item.daysTracked, item.target, item.actual, item.achievement?.toFixed(1) ?? '']),
    [],
    ['Attendance rate', scorecard.attendance.attendanceRate?.toFixed(1) ?? ''],
    ['Scheduled days', scorecard.attendance.scheduledDays],
    ['Present', scorecard.attendance.presentDays],
    ['Absent', scorecard.attendance.absentDays],
    ['Sick', scorecard.attendance.sickDays],
    ['Leave', scorecard.attendance.leaveDays],
    ['Off', scorecard.attendance.offDays],
    [],
    ['Manager feedback', scorecard.managerFeedback],
    ['Agent feedback', scorecard.agentFeedback],
    ['Acknowledged by', scorecard.signedBy ?? 'Not signed'],
    ['Acknowledged at', scorecard.signedAt ?? '']
  ]
  const csv = rows.map((row) => row.map((value) => quote(value ?? '')).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `agent-review-${scorecard.repName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${period}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ReportsPage({ period }: { period: string }) {
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [selectedRepId, setSelectedRepId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([window.performanceTracker.getReport(period), window.performanceTracker.listAuditEntries(100)]).then(([result, history]) => {
      if (active) {
        setReport(result)
        setAuditEntries(history)
        setSelectedRepId((current) => result.scorecards.some((scorecard) => scorecard.repId === current) ? current : result.scorecards[0]?.repId ?? '')
      }
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Unable to load this report.')
    })
    return () => { active = false }
  }, [period])

  if (error) return <div className="inline-notice error">{error}</div>
  if (!report) return <div className="loading-state">Preparing monthly report…</div>

  const scorecard = report.scorecards.find((item) => item.repId === selectedRepId)
  if (!scorecard) return <div className="page-stack"><section className="page-intro"><div className="eyebrow">MONTH-END REVIEW</div><h2>Agent review reports</h2><p>Import monthly results to prepare individual scorecards.</p></section><div className="report-empty">No agent scorecards are available for {period}.</div></div>
  const kpiCodes = new Set(scorecard.kpis.map((metric) => metric.code))
  const reviewHistory = auditEntries.filter((entry) => {
    const id = entry.entityId ?? ''
    if (entry.entity === 'agent_monthly_reviews') return id === `${scorecard.repId}:${period}`
    if (entry.entity !== 'performance_records' || entry.event !== 'record.saved') return false
    if (!id.startsWith(`${scorecard.repName}:`) || !id.endsWith(`:${period}`)) return false
    return [...kpiCodes].some((code) => id.includes(`:${code}:`))
  })

  return (
    <div className="page-stack report-page">
      <section className="page-intro intro-with-action hide-print"><div><div className="eyebrow">MONTH-END REVIEW</div><h2>Agent review reports</h2><p>Review, print, or export one agent’s monthly scorecard at a time.</p></div><div className="report-actions"><button className="button button-outline" onClick={() => downloadReport(period, scorecard)} type="button"><ArrowDownToLine size={15} /> Export CSV</button><button className="button button-primary" onClick={() => window.print()} type="button"><Printer size={15} /> Print review</button></div></section>

      <nav className="agent-tabs hide-print" aria-label="Agent reports">
        {report.scorecards.map((item) => <button key={item.repId} className={`agent-tab ${item.repId === selectedRepId ? 'selected' : ''}`} onClick={() => setSelectedRepId(item.repId)} type="button">{item.repName}</button>)}
      </nav>

      <section className="report-cover panel">
        <div className="report-cover-top"><div className="report-logo">PT</div><span>INDIVIDUAL SALES PERFORMANCE REVIEW</span><span className="report-period">{period}</span></div>
        <div className="report-cover-title"><div><div className="eyebrow">AGENT MONTHLY REVIEW</div><h2>{scorecard.repName}</h2><p>{report.teamName} · KPIs, campaign results, attendance, and review feedback.</p></div><div className="report-status"><strong>{scorecard.signedAt ? scorecard.signatureData ? 'Signed acknowledgment' : 'Acknowledged · legacy sign-off' : 'Pending'}</strong><span>{scorecard.signedBy ?? 'Agent acknowledgment'}</span></div></div>
      </section>

      <section className="panel report-metrics">
        <div className="panel-heading"><div><div className="eyebrow">CAMPAIGN RESULTS</div><h3>Lead targets by campaign</h3></div></div>
        {scorecard.campaigns.length ? <div className="table-scroll"><table className="data-table report-table"><thead><tr><th>Campaign</th><th>Days</th><th>Lead target</th><th>Leads made</th><th>Achievement</th></tr></thead><tbody>
          {scorecard.campaigns.map((campaign) => <tr key={campaign.campaign}><td><strong>{campaign.campaign}</strong></td><td>{campaign.daysTracked}</td><td>{formatMetric(campaign.target, 'count')}</td><td>{formatMetric(campaign.actual, 'count')}</td><td>{campaign.achievement === null ? '—' : `${campaign.achievement.toFixed(1)}%`}</td></tr>)}
        </tbody></table></div> : <div className="report-empty">No campaign results imported for this month.</div>}
      </section>

      <section className="panel report-attendance-panel">
        <div className="panel-heading"><div><div className="eyebrow">ATTENDANCE</div><h3>Monthly attendance</h3></div></div>
        <div className="attendance-summary-grid"><div className="attendance-value"><span>Attendance rate</span><strong>{scorecard.attendance.attendanceRate === null ? '—' : `${scorecard.attendance.attendanceRate.toFixed(1)}%`}</strong></div><div className="attendance-value"><span>Scheduled days</span><strong>{scorecard.attendance.scheduledDays}</strong></div><div className="attendance-value"><span>Present</span><strong>{scorecard.attendance.presentDays}</strong></div><div className="attendance-value"><span>Absent</span><strong>{scorecard.attendance.absentDays}</strong></div><div className="attendance-value"><span>Sick</span><strong>{scorecard.attendance.sickDays}</strong></div><div className="attendance-value"><span>Leave</span><strong>{scorecard.attendance.leaveDays}</strong></div><div className="attendance-value"><span>Off</span><strong>{scorecard.attendance.offDays}</strong></div></div>
      </section>

      <section className="panel report-metrics">
        <div className="panel-heading"><div><div className="eyebrow">PERFORMANCE SCORECARD</div><h3>Results for {period}</h3></div></div>
        <div className="table-scroll"><table className="data-table report-table"><thead><tr><th>KPI</th><th>Target</th><th>Actual</th><th>Achievement</th><th>Status</th><th>Note</th></tr></thead><tbody>
          {scorecard.kpis.map((metric) => <tr key={metric.code}><td><strong>{metric.name}</strong></td><td>{formatMetric(metric.target, metric.unit)}</td><td>{formatMetric(metric.actual, metric.unit)}</td><td>{metric.achievement === null ? '—' : `${metric.achievement.toFixed(1)}%`}</td><td><span className={`status-label ${metric.status ?? 'neutral'}`}>{metric.status ?? 'Not entered'}</span></td><td>{metric.note || '—'}</td></tr>)}
        </tbody></table></div>
      </section>

      <section className="panel report-review-feedback">
        <div className="panel-heading"><div><div className="eyebrow">REVIEW CONVERSATION</div><h3>Feedback</h3></div></div>
        <div className="report-feedback-grid"><div><strong>Manager feedback</strong><p>{scorecard.managerFeedback || 'No manager feedback recorded.'}</p></div><div><strong>Agent feedback</strong><p>{scorecard.agentFeedback || 'No agent feedback recorded.'}</p></div></div>
        <div className="report-acknowledgment"><strong>Agent acknowledgment signature</strong><span>{scorecard.signedAt ? `${scorecard.signedBy} · ${new Date(scorecard.signedAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Not yet acknowledged'}</span>{scorecard.signatureData && <img className="report-signature" src={scorecard.signatureData} alt={`Signature from ${scorecard.signedBy}`} />}</div>
      </section>

      <section className="panel report-history hide-print">
        <div className="panel-heading"><div><div className="eyebrow">AUDIT HISTORY</div><h3>{scorecard.repName} · {period}</h3></div><span className="action-count">{reviewHistory.length} changes</span></div>
        {reviewHistory.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>When</th><th>Event</th><th>Details</th></tr></thead><tbody>
          {reviewHistory.map((entry, index) => <tr key={`${entry.createdAt}-${index}`}><td>{new Date(entry.createdAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>{entry.event.replaceAll('.', ' ')}</td><td>{entry.details || '—'}</td></tr>)}
        </tbody></table></div> : <div className="report-empty">Scorecard changes and acknowledgments will appear here.</div>}
      </section>

      <div className="report-footnote">A drawn signature records the agent’s acknowledgment and is stored with the review on this computer. It does not independently verify who drew it.</div>
    </div>
  )
}
