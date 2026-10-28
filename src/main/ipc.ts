import { randomUUID } from 'node:crypto'
import { copyFileSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { AgentCredentialInput, GmRecoveryInput, ImportSheetMapping, InitialGmInput, LoginInput, PerformanceRecordInput, ReviewAcknowledgementInput, ReviewFeedbackInput, TeamLeaderInput } from '../shared/models'
import { combinePerformanceImports, parsePerformanceCsv } from './services/csv-import'
import type { PerformanceRepository } from './services/performance-repository'
import { buildMonthlyReport } from './services/reporting'

interface AppSession {
  userId: string
  senderId: number
  username: string
  displayName: string
  role: 'GM' | 'TEAM_LEADER'
}

interface CachedImportFile {
  sourceName: string
  extension: string
  content: Buffer
}

interface CachedImportSession {
  senderId: number
  files: CachedImportFile[]
  codes: string[]
}

export function registerIpcHandlers(store: PerformanceRepository): void {
  const sessions = new Map<string, AppSession>()
  const importSessions = new Map<string, CachedImportSession>()

  const requireUser = (event: IpcMainInvokeEvent, token: string | null | undefined, gmOnly = false): AppSession => {
    const session = token ? sessions.get(token) : undefined
    if (!session || session.senderId !== event.sender.id) throw new Error('Your session has ended. Sign in again to continue.')
    if (gmOnly && session.role !== 'GM') throw new Error('GM access is required for this action.')
    store.setAuditActor(session.displayName)
    return session
  }

  ipcMain.handle('auth:state', (event, token?: string | null) => {
    const session = token ? sessions.get(token) : undefined
    const currentUser = session && session.senderId === event.sender.id
      ? { id: session.userId, username: session.username, displayName: session.displayName, role: session.role }
      : null
    return { initialized: store.hasUserAccounts(), user: currentUser }
  })

  const startSession = (event: IpcMainInvokeEvent, input: InitialGmInput | LoginInput, setup: boolean) => {
    const user = setup ? store.setupInitialGm(input as InitialGmInput) : store.authenticateUser(input as LoginInput)
    const token = randomUUID()
    sessions.set(token, { userId: user.id, senderId: event.sender.id, username: user.username, displayName: user.displayName, role: user.role })
    event.sender.once('destroyed', () => {
      sessions.delete(token)
      for (const [id, cached] of importSessions) if (cached.senderId === event.sender.id) importSessions.delete(id)
    })
    store.setAuditActor(user.displayName)
    return { token, user }
  }

  ipcMain.handle('auth:setup-initial-gm', (event, input: InitialGmInput) => startSession(event, input, true))
  ipcMain.handle('auth:login', (event, input: LoginInput) => startSession(event, input, false))
  ipcMain.handle('auth:recover-gm', (_event, input: GmRecoveryInput) => store.recoverGmLogin(input))
  ipcMain.handle('auth:logout', (event, token?: string | null) => {
    if (!token) return
    const session = sessions.get(token)
    if (session?.senderId === event.sender.id) sessions.delete(token)
  })
  ipcMain.handle('auth:change-password', (event, token: string, currentPassword: string, newPassword: string) => {
    const user = requireUser(event, token)
    store.changeMyPassword(user.userId, currentPassword, newPassword)
  })

  ipcMain.handle('user:list', (event, token: string) => {
    requireUser(event, token, true)
    return store.listUserAccounts()
  })
  ipcMain.handle('user:create-team-leader', (event, token: string, input: TeamLeaderInput) => {
    requireUser(event, token, true)
    return store.createTeamLeader(input)
  })
  ipcMain.handle('user:reset-password', (event, token: string, userId: string, password: string) => {
    requireUser(event, token, true)
    store.resetUserPassword(userId, password)
    for (const [sessionToken, session] of sessions) if (session.userId === userId) sessions.delete(sessionToken)
  })
  ipcMain.handle('user:disable', (event, token: string, userId: string) => {
    requireUser(event, token, true)
    store.disableUser(userId)
    for (const [sessionToken, session] of sessions) if (session.userId === userId) sessions.delete(sessionToken)
  })

  ipcMain.handle('dashboard:get', (event, token: string, period: string) => { requireUser(event, token); return store.getDashboard(period) })
  ipcMain.handle('report:get', async (event, token: string, period: string) => { requireUser(event, token); return buildMonthlyReport(store, period) })
  ipcMain.handle('kpis:list', (event, token: string) => { requireUser(event, token); return store.listKpis() })
  ipcMain.handle('audit:list', (event, token: string, limit?: number) => { requireUser(event, token); return store.listAuditEntries(limit) })
  ipcMain.handle('record:save', (event, token: string, input: PerformanceRecordInput) => { requireUser(event, token); return store.saveRecord(input) })
  ipcMain.handle('review:feedback-save', (event, token: string, input: ReviewFeedbackInput) => { requireUser(event, token); return store.saveReviewFeedback(input) })
  ipcMain.handle('agent:credential-set', (event, token: string, input: AgentCredentialInput) => { requireUser(event, token, true); return store.setAgentCredential(input) })
  ipcMain.handle('review:acknowledge', (event, token: string, input: ReviewAcknowledgementInput) => { requireUser(event, token); return store.acknowledgeReview(input) })
  ipcMain.handle('demo:seed', (event, token: string) => { requireUser(event, token, true); return store.seedDemoData() })

  ipcMain.handle('template:save', async (event, token: string) => {
    requireUser(event, token)
    const selection = await dialog.showSaveDialog({
      title: 'Save the outbound sample workbook',
      defaultPath: join(app.getPath('downloads'), 'outbound-performance-sample.xlsx'),
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
    })
    if (selection.canceled || !selection.filePath) return false
    copyFileSync(join(app.getAppPath(), 'sample-data', 'outbound-performance-sample.xlsx'), selection.filePath)
    return true
  })

  ipcMain.handle('file:preview', async (event, token: string) => {
    requireUser(event, token)
    const selection = await dialog.showOpenDialog({
      title: 'Choose one or more sales performance CSV or XLSX files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Performance data', extensions: ['csv', 'xlsx'] }]
    })
    if (selection.canceled || selection.filePaths.length === 0) return null
    if (selection.filePaths.length > 20) throw new Error('Select 20 files or fewer per import.')
    const kpis = await store.listKpis()
    const codes = kpis.map((item) => item.code)
    const files: CachedImportFile[] = []
    let totalBytes = 0

    for (const filePath of selection.filePaths) {
      const extension = extname(filePath).toLowerCase()
      if (extension !== '.csv' && extension !== '.xlsx') throw new Error(`${basename(filePath)}: choose a .csv or .xlsx file.`)
      const stats = statSync(filePath)
      totalBytes += stats.size
      if (stats.size > 10_000_000) throw new Error(`${basename(filePath)} is larger than the 10 MB per-file limit.`)
      if (totalBytes > 50_000_000) throw new Error('Selected files exceed the 50 MB total import limit.')
      const file = readFileSync(filePath)
      files.push({ sourceName: basename(filePath), extension, content: file })
    }

    const sessionId = randomUUID()
    for (const [id, cached] of importSessions) if (cached.senderId === event.sender.id) importSessions.delete(id)
    importSessions.set(sessionId, { senderId: event.sender.id, files, codes })
    const batches = await Promise.all(files.map(async (file) => {
      const parsed = file.extension === '.csv'
        ? parsePerformanceCsv(file.content.toString('utf8'), codes, [], file.sourceName)
        : await (await import('./services/xlsx-import')).parseXlsxBuffer(file.content, codes, file.sourceName)
      return { sourceName: file.sourceName, ...parsed }
    }))
    if (batches.reduce((count, batch) => count + batch.rows.length + (batch.campaignRows?.length ?? 0) + (batch.attendanceRows?.length ?? 0), 0) > 10_000) {
        throw new Error('A combined import is limited to 10,000 valid rows.')
    }

    const combined = combinePerformanceImports(batches, codes)
    return { sessionId, fileNames: files.map((file) => file.sourceName), ...combined }
  })

  ipcMain.handle('file:preview-mapped', async (event, token: string, input: { sessionId: string; mappings: ImportSheetMapping[] }) => {
    requireUser(event, token)
    const cached = importSessions.get(input?.sessionId)
    if (!cached || cached.senderId !== event.sender.id) throw new Error('This import session has expired. Choose your source files again.')
    if (!Array.isArray(input.mappings) || input.mappings.length > 100) throw new Error('The column mapping could not be read.')
    const batches = await Promise.all(cached.files.map(async (file) => {
      const mappings = input.mappings.filter((mapping) => mapping.mappingId.startsWith(`${file.sourceName}::`))
      const parsed = file.extension === '.csv'
        ? parsePerformanceCsv(file.content.toString('utf8'), cached.codes, mappings, file.sourceName)
        : await (await import('./services/xlsx-import')).parseXlsxBuffer(file.content, cached.codes, file.sourceName, mappings)
      return { sourceName: file.sourceName, ...parsed }
    }))
    const totalRows = batches.reduce((count, batch) => count + batch.rows.length + (batch.campaignRows?.length ?? 0) + (batch.attendanceRows?.length ?? 0), 0)
    if (totalRows > 10_000) throw new Error('A combined import is limited to 10,000 valid rows.')
    const combined = combinePerformanceImports(batches, cached.codes)
    return { sessionId: input.sessionId, fileNames: cached.files.map((file) => file.sourceName), ...combined }
  })

  ipcMain.handle('file:import', (event, token: string, input: { rows: unknown[]; campaignRows: unknown[]; attendanceRows: unknown[] }) => {
    requireUser(event, token)
    return store.importRecords(input)
  })
}
