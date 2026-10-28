export type KpiDirection = 'higher' | 'lower'
export type PerformanceStatus = 'on-track' | 'watch' | 'behind'

export interface KpiDefinition {
  code: string
  name: string
  unit: string
  direction: KpiDirection
  description: string
}

export interface PerformanceRecordInput {
  rep: string
  code: string
  period: string
  target: number
  actual: number
  note?: string
}

export interface CampaignActivityInput {
  rep: string
  date: string
  campaign: string
  target: number
  actual: number
}

export type AttendanceStatus = 'present' | 'absent' | 'leave' | 'sick' | 'off'

export interface AttendanceRecordInput {
  rep: string
  date: string
  status: AttendanceStatus
}

export interface KpiSummary extends KpiDefinition {
  target: number | null
  actual: number | null
  achievement: number | null
  status: PerformanceStatus | null
  previousActual: number | null
  changePercent: number | null
  note: string
}

export interface SalesRep {
  id: string
  name: string
}

export interface RepScorecard {
  repId: string
  repName: string
  kpis: KpiSummary[]
  campaigns: CampaignPerformanceSummary[]
  attendance: AttendanceSummary
  managerFeedback: string
  agentFeedback: string
  signedBy: string | null
  signedAt: string | null
  signatureData: string | null
  identityCredentialConfigured: boolean
  identityVerifiedAt: string | null
}

export interface CampaignPerformanceSummary {
  campaign: string
  target: number
  actual: number
  achievement: number | null
  daysTracked: number
}

export interface AttendanceSummary {
  daysRecorded: number
  scheduledDays: number
  presentDays: number
  absentDays: number
  leaveDays: number
  sickDays: number
  offDays: number
  attendanceRate: number | null
}

export interface RepPerformanceSummary {
  repId: string
  repName: string
  calls: number | null
  closed: number | null
  conversionRate: number | null
  status: PerformanceStatus | null
}

export interface CallsPerDayPoint {
  day: string
  label: string
  calls: number
}

export interface WinRatePoint {
  rep: string
  winRate: number
}

export interface DashboardData {
  period: string
  teamName: string
  kpis: KpiSummary[]
  scorecards: RepScorecard[]
  reps: RepPerformanceSummary[]
  callsPerDay: CallsPerDayPoint[]
  winRateByRep: WinRatePoint[]
  hasData: boolean
  onTrackCount: number
  trackedCount: number
}

export interface ImportIssue {
  row: number
  message: string
}

export type ImportSheetLayout = 'performance-template' | 'campaign-activity' | 'lead-activity' | 'qa-review' | 'attendance' | 'contact-list' | 'unrecognized'

export type ImportDataset = 'monthly-kpis' | 'campaign-results' | 'attendance' | 'skip'
export type ImportColumn = 'period' | 'date' | 'rep' | 'kpi' | 'target' | 'actual' | 'note' | 'campaign' | 'status'

export interface ImportSheetMapping {
  mappingId: string
  dataset: ImportDataset
  columns: Partial<Record<ImportColumn, number>>
}

export interface ImportSheetProfile {
  mappingId: string
  fileName: string
  sheetName: string
  layout: ImportSheetLayout
  suggestedDataset: ImportDataset
  suggestedColumns: Partial<Record<ImportColumn, number>>
  dataRows: number
  headers: string[]
  campaigns: string[]
  campaignCount: number
  message: string
}

export interface FileImportPreview {
  sessionId: string
  fileNames: string[]
  rows: PerformanceRecordInput[]
  campaignRows: CampaignActivityInput[]
  attendanceRows: AttendanceRecordInput[]
  issues: ImportIssue[]
  sheets: ImportSheetProfile[]
}

export interface ReviewFeedbackInput {
  repId: string
  period: string
  managerFeedback: string
  agentFeedback: string
}

export interface ReviewAcknowledgementInput {
  repId: string
  period: string
  signatureData: string
}

export interface AgentCredentialInput {
  repId: string
  password: string
  identityConfirmed: boolean
}

export interface MonthlyReport {
  period: string
  teamName: string
  scorecards: RepScorecard[]
}

export interface ImportResult {
  imported: number
  campaignImported: number
  attendanceImported: number
  issues: ImportIssue[]
}

export interface AuditEntry {
  actor: string
  event: string
  entity: string
  entityId: string | null
  details: string
  createdAt: string
}

export type AppUserRole = 'GM' | 'TEAM_LEADER'

export interface AuthUser {
  id: string
  username: string
  displayName: string
  role: AppUserRole
}

export interface AuthState {
  initialized: boolean
  user: AuthUser | null
}

export interface UserAccountSummary extends AuthUser {
  active: boolean
  createdAt: string
}

export interface InitialGmInput {
  username: string
  displayName: string
  password: string
}

export interface LoginInput {
  username: string
  password: string
}

export interface GmRecoveryInput {
  username: string
  password: string
}

export interface TeamLeaderInput {
  username: string
  displayName: string
  password: string
}

export interface PerformanceTrackerApi {
  getAuthState(): Promise<AuthState>
  setupInitialGm(input: InitialGmInput): Promise<AuthUser>
  login(input: LoginInput): Promise<AuthUser>
  recoverGmLogin(input: GmRecoveryInput): Promise<void>
  logout(): Promise<void>
  listUserAccounts(): Promise<UserAccountSummary[]>
  createTeamLeader(input: TeamLeaderInput): Promise<UserAccountSummary>
  resetUserPassword(userId: string, password: string): Promise<void>
  disableUser(userId: string): Promise<void>
  changeMyPassword(currentPassword: string, newPassword: string): Promise<void>
  getDashboard(period: string): Promise<DashboardData>
  getReport(period: string): Promise<MonthlyReport>
  listKpis(): Promise<KpiDefinition[]>
  listAuditEntries(limit?: number): Promise<AuditEntry[]>
  saveRecord(record: PerformanceRecordInput): Promise<void>
  saveReviewFeedback(input: ReviewFeedbackInput): Promise<void>
  setAgentCredential(input: AgentCredentialInput): Promise<void>
  acknowledgeReview(input: ReviewAcknowledgementInput): Promise<void>
  saveSampleTemplate(): Promise<boolean>
  previewImportFile(): Promise<FileImportPreview | null>
  previewImportFileWithMapping(input: { sessionId: string; mappings: ImportSheetMapping[] }): Promise<FileImportPreview>
  importRows(input: { rows: unknown[]; campaignRows: unknown[]; attendanceRows: unknown[] }): Promise<ImportResult>
  seedDemoData(): Promise<{ seeded: boolean; message: string }>
}
