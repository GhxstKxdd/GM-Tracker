import type { DashboardData } from '../../shared/models'

export interface PerformanceInsight {
  title: string
  observation: string
  suggestedAction: string
  relatedKpiCodes: string[]
}

export interface AiInsightProvider {
  analyzePerformance(dashboard: DashboardData): Promise<PerformanceInsight[]>
}

// This contract keeps a future AI provider separate from the scorecard and database.
// The local prototype deliberately registers no AI provider and sends no data externally.
