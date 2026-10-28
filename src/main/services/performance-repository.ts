import type { AgentCredentialInput, AuditEntry, AuthUser, DashboardData, GmRecoveryInput, ImportResult, InitialGmInput, KpiDefinition, LoginInput, PerformanceRecordInput, ReviewAcknowledgementInput, ReviewFeedbackInput, TeamLeaderInput, UserAccountSummary } from '../../shared/models'

export type Awaitable<T> = T | Promise<T>

export interface PerformanceRepository {
  setAuditActor(actor: string): void
  hasUserAccounts(): boolean
  setupInitialGm(input: InitialGmInput): AuthUser
  authenticateUser(input: LoginInput): AuthUser
  recoverGmLogin(input: GmRecoveryInput): void
  listUserAccounts(): UserAccountSummary[]
  createTeamLeader(input: TeamLeaderInput): UserAccountSummary
  resetUserPassword(userId: string, password: string): void
  disableUser(userId: string): void
  changeMyPassword(userId: string, currentPassword: string, newPassword: string): void
  getDashboard(period: string): Awaitable<DashboardData>
  listKpis(): Awaitable<KpiDefinition[]>
  listAuditEntries(limit?: number): Awaitable<AuditEntry[]>
  saveRecord(record: PerformanceRecordInput): Awaitable<void>
  saveReviewFeedback(input: ReviewFeedbackInput): Awaitable<void>
  setAgentCredential(input: AgentCredentialInput): Awaitable<void>
  acknowledgeReview(input: ReviewAcknowledgementInput): Awaitable<void>
  importRecords(input: { rows: unknown[]; campaignRows: unknown[]; attendanceRows: unknown[] }): Awaitable<ImportResult>
  seedDemoData(): Awaitable<{ seeded: boolean; message: string }>
}
