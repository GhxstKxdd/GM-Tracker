import type { KpiDirection, PerformanceStatus } from '../../shared/models'

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/

export function isValidPeriod(value: string): boolean {
  const match = MONTH_PATTERN.exec(value)
  if (!match) return false
  const month = Number(match[2])
  return month >= 1 && month <= 12
}

export function normalizeReportingPeriod(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
  }
  if (typeof value !== 'string') return String(value ?? '').trim()
  const source = value.trim()
  const monthOnly = /^(\d{4})[-/](\d{1,2})$/.exec(source)
  if (monthOnly) return `${monthOnly[1]}-${String(Number(monthOnly[2])).padStart(2, '0')}`
  const isoDate = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(source)
  if (isoDate) return `${isoDate[1]}-${String(Number(isoDate[2])).padStart(2, '0')}`
  const localDate = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(source)
  if (localDate) return `${localDate[3]}-${String(Number(localDate[2])).padStart(2, '0')}`
  const parsed = new Date(source)
  if (Number.isFinite(parsed.getTime())) return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`
  return source
}

export function shiftPeriod(period: string, offset: number): string {
  if (!isValidPeriod(period)) throw new Error(`Invalid reporting period: ${period}`)
  const [year, month] = period.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function achievementPercent(
  target: number,
  actual: number,
  direction: KpiDirection
): number {
  if (!Number.isFinite(target) || !Number.isFinite(actual)) return 0
  const roundScore = (value: number) => Math.round(value * 100) / 100

  if (direction === 'higher') {
    if (target <= 0) return actual >= target ? 150 : 0
    return roundScore(Math.min(150, Math.max(0, (actual / target) * 100)))
  }

  if (actual <= target) return 100
  if (target <= 0) return 0
  return roundScore(Math.max(0, (target / actual) * 100))
}

export function performanceStatus(achievement: number): PerformanceStatus {
  if (achievement >= 100) return 'on-track'
  if (achievement >= 90) return 'watch'
  return 'behind'
}

export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

export function formatPeriodLabel(period: string): string {
  if (!isValidPeriod(period)) return period
  const [year, month] = period.split('-').map(Number)
  return new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
}
