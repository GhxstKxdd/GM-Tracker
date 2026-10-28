import { contextBridge, ipcRenderer } from 'electron'
import type {
  AuditEntry,
  AgentCredentialInput,
  AuthState,
  AuthUser,
  FileImportPreview,
  ImportSheetMapping,
  GmRecoveryInput,
  DashboardData,
  ImportResult,
  InitialGmInput,
  KpiDefinition,
  LoginInput,
  MonthlyReport,
  PerformanceRecordInput,
  PerformanceTrackerApi,
  ReviewAcknowledgementInput,
  ReviewFeedbackInput,
  TeamLeaderInput,
  UserAccountSummary
} from '../shared/models'

let sessionToken: string | null = null
const invokeAuthenticated = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, sessionToken, ...args)

const api: PerformanceTrackerApi = {
  getAuthState: () => ipcRenderer.invoke('auth:state', sessionToken) as Promise<AuthState>,
  setupInitialGm: async (input: InitialGmInput) => {
    const result = await ipcRenderer.invoke('auth:setup-initial-gm', input) as { token: string; user: AuthUser }
    sessionToken = result.token
    return result.user
  },
  login: async (input: LoginInput) => {
    const result = await ipcRenderer.invoke('auth:login', input) as { token: string; user: AuthUser }
    sessionToken = result.token
    return result.user
  },
  recoverGmLogin: (input: GmRecoveryInput) => ipcRenderer.invoke('auth:recover-gm', input) as Promise<void>,
  logout: async () => {
    try { await ipcRenderer.invoke('auth:logout', sessionToken) } finally { sessionToken = null }
  },
  listUserAccounts: () => invokeAuthenticated('user:list') as Promise<UserAccountSummary[]>,
  createTeamLeader: (input: TeamLeaderInput) => invokeAuthenticated('user:create-team-leader', input) as Promise<UserAccountSummary>,
  resetUserPassword: (userId: string, password: string) => invokeAuthenticated('user:reset-password', userId, password) as Promise<void>,
  disableUser: (userId: string) => invokeAuthenticated('user:disable', userId) as Promise<void>,
  changeMyPassword: (currentPassword: string, newPassword: string) => invokeAuthenticated('auth:change-password', currentPassword, newPassword) as Promise<void>,
  getDashboard: (period: string) => invokeAuthenticated('dashboard:get', period) as Promise<DashboardData>,
  getReport: (period: string) => invokeAuthenticated('report:get', period) as Promise<MonthlyReport>,
  listKpis: () => invokeAuthenticated('kpis:list') as Promise<KpiDefinition[]>,
  listAuditEntries: (limit?: number) => invokeAuthenticated('audit:list', limit) as Promise<AuditEntry[]>,
  saveRecord: (record: PerformanceRecordInput) => invokeAuthenticated('record:save', record) as Promise<void>,
  saveReviewFeedback: (input: ReviewFeedbackInput) => invokeAuthenticated('review:feedback-save', input) as Promise<void>,
  setAgentCredential: (input: AgentCredentialInput) => invokeAuthenticated('agent:credential-set', input) as Promise<void>,
  acknowledgeReview: (input: ReviewAcknowledgementInput) => invokeAuthenticated('review:acknowledge', input) as Promise<void>,
  saveSampleTemplate: () => invokeAuthenticated('template:save') as Promise<boolean>,
  previewImportFile: () => invokeAuthenticated('file:preview') as Promise<FileImportPreview | null>,
  previewImportFileWithMapping: (input: { sessionId: string; mappings: ImportSheetMapping[] }) => invokeAuthenticated('file:preview-mapped', input) as Promise<FileImportPreview>,
  importRows: (input: { rows: unknown[]; campaignRows: unknown[]; attendanceRows: unknown[] }) => invokeAuthenticated('file:import', input) as Promise<ImportResult>,
  seedDemoData: () => invokeAuthenticated('demo:seed') as Promise<{ seeded: boolean; message: string }>
}

contextBridge.exposeInMainWorld('performanceTracker', api)
