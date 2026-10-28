import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { KpiSummary } from '../../../shared/models'

export function formatMetric(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (unit === '%') return `${value.toLocaleString('en-ZA', { maximumFractionDigits: 1 })}%`
  if (unit === 'score') return value.toLocaleString('en-ZA', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
  const formatted = value.toLocaleString('en-ZA', { maximumFractionDigits: 0 })
  return unit === 'currency' ? `R${formatted}` : formatted
}

export function MetricCard({ metric, accent = 'teal' }: { metric: KpiSummary; accent?: string }) {
  const change = metric.changePercent
  const isLowerMetric = metric.direction === 'lower'
  const favorable = change === null ? null : isLowerMetric ? change <= 0 : change >= 0

  return (
    <article className={`metric-card accent-${accent}`}>
      <div className="metric-card-heading">
        <span>{metric.name}</span>
        <span className="metric-icon"><span className="metric-accent-dot" /></span>
      </div>
      <div className="metric-value">{formatMetric(metric.actual, metric.unit)}</div>
      <div className="metric-foot">
        <span className="metric-target">Target <strong>{formatMetric(metric.target, metric.unit)}</strong></span>
        {change !== null ? (
          <span className={`change-pill ${favorable ? 'positive' : 'negative'}`}>
            {change === 0 ? <Minus size={13} /> : change > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(change).toFixed(1)}%
          </span>
        ) : <span className="change-pill muted">No prior month</span>}
      </div>
      {metric.achievement !== null && (
        <div className="metric-progress"><span style={{ width: `${Math.min(metric.achievement, 100)}%` }} /></div>
      )}
    </article>
  )
}
