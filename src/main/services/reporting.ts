import type { MonthlyReport } from '../../shared/models'
import type { PerformanceRepository } from './performance-repository'

export async function buildMonthlyReport(repository: PerformanceRepository, period: string): Promise<MonthlyReport> {
  const dashboard = await repository.getDashboard(period)
  return { period, teamName: dashboard.teamName, scorecards: dashboard.scorecards }
}
