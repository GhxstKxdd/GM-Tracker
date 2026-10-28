import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  AgentCredentialInput,
  AuditEntry,
  AuthUser,
  AppUserRole,
  AttendanceRecordInput,
  AttendanceSummary,
  CampaignActivityInput,
  CampaignPerformanceSummary,
  CallsPerDayPoint,
  DashboardData,
  KpiDefinition,
  KpiSummary,
  PerformanceRecordInput,
  PerformanceStatus,
  ImportResult,
  InitialGmInput,
  GmRecoveryInput,
  LoginInput,
  ReviewAcknowledgementInput,
  ReviewFeedbackInput,
  RepPerformanceSummary,
  RepScorecard,
  SalesRep,
  TeamLeaderInput,
  UserAccountSummary,
  WinRatePoint
} from '../../shared/models'
import { validateImportRows } from './csv-import'
import { validateAttendanceRows, validateCampaignActivityRows } from './daily-import'
import { achievementPercent, isValidPeriod, performanceStatus, percentChange, shiftPeriod } from './performance'
import type { PerformanceRepository } from './performance-repository'

const KPI_DEFINITIONS: KpiDefinition[] = [
  { code: 'CALLS_MADE', name: 'Calls Made', unit: 'count', direction: 'higher', description: 'Outbound calls completed by the representative in the month.' },
  { code: 'DEALS_CLOSED', name: 'Deals Closed', unit: 'count', direction: 'higher', description: 'Sales deals closed by the representative in the month.' },
  { code: 'CONVERSION_RATE', name: 'Conversion Rate', unit: '%', direction: 'higher', description: 'Deals closed as a share of calls made.' }
]

const AGGREGATED_CODES = new Set(['CALLS_MADE', 'DEALS_CLOSED'])

function asNumber(value: unknown): number { return typeof value === 'number' ? value : Number(value) }
function asString(value: unknown): string { return typeof value === 'string' ? value : '' }

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

type RawRecord = { target: number; actual: number; note: string }
type AuthUserRow = Record<string, unknown>

export class LocalStore implements PerformanceRepository {
  private readonly db: DatabaseSync
  private auditActor = 'local'

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA foreign_keys = ON;')
    if (databasePath !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;')
    this.migrateSchema()
    this.installDefaultKpis()
    if (this.getSetting('team_name') === 'Sample Sales Team') this.seedDemoData()
  }

  close(): void { this.db.close() }

  setAuditActor(actor: string): void { this.auditActor = actor.trim().slice(0, 100) || 'local' }

  hasUserAccounts(): boolean {
    return asNumber((this.db.prepare('SELECT COUNT(*) AS count FROM user_accounts').get() as Record<string, unknown>).count) > 0
  }

  setupInitialGm(input: InitialGmInput): AuthUser {
    if (this.hasUserAccounts()) throw new Error('The GM account has already been set up. Sign in to continue.')
    const username = this.validateUsername(input.username)
    const displayName = this.validateDisplayName(input.displayName)
    const { salt, hash } = this.passwordHash(input.password)
    const id = randomUUID()
    const now = new Date().toISOString()
    this.withTransaction(() => {
      this.db.prepare(`
        INSERT INTO user_accounts (id, username, display_name, role, salt, credential_hash, failed_attempts, locked_until, active, created_at, updated_at)
        VALUES (?, ?, ?, 'GM', ?, ?, 0, NULL, 1, ?, ?)
      `).run(id, username, displayName, salt, hash, now, now)
      this.logAudit('auth.gm_account_created', 'user_accounts', id, 'The first GM account was created.', username)
    })
    return { id, username, displayName, role: 'GM' }
  }

  authenticateUser(input: LoginInput): AuthUser {
    const username = typeof input.username === 'string' ? input.username.trim() : ''
    const row = this.db.prepare(`
      SELECT id, username, display_name AS displayName, role, salt, credential_hash AS credentialHash,
        failed_attempts AS failedAttempts, locked_until AS lockedUntil, active
      FROM user_accounts WHERE username = ? COLLATE NOCASE
    `).get(username) as AuthUserRow | undefined
    if (!row || asNumber(row.active) !== 1) throw new Error('Username or password is incorrect.')
    const lockedUntil = typeof row.lockedUntil === 'string' ? Date.parse(row.lockedUntil) : 0
    if (lockedUntil > Date.now()) throw new Error(`Sign-in is temporarily locked. Try again at ${new Date(lockedUntil).toLocaleTimeString()}.`)

    const password = typeof input.password === 'string' && input.password.length <= 128 ? input.password : ''
    const valid = this.verifyPassword(password, asString(row.salt), asString(row.credentialHash))
    if (!valid) {
      const attempts = asNumber(row.failedAttempts) + 1
      const lockout = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null
      this.db.prepare('UPDATE user_accounts SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?')
        .run(lockout ? 0 : attempts, lockout, new Date().toISOString(), asString(row.id))
      this.logAudit('auth.login_failed', 'user_accounts', asString(row.id), 'A user sign-in attempt was rejected.', asString(row.username))
      throw new Error(lockout ? 'Five sign-in attempts failed. Login is locked for 15 minutes.' : 'Username or password is incorrect.')
    }

    const now = new Date().toISOString()
    this.db.prepare('UPDATE user_accounts SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(now, asString(row.id))
    this.logAudit('auth.login_succeeded', 'user_accounts', asString(row.id), 'User signed in.', asString(row.username))
    return this.authUserFromRow(row)
  }

  recoverGmLogin(input: GmRecoveryInput): void {
    const row = this.db.prepare("SELECT id, username FROM user_accounts WHERE role = 'GM' AND active = 1").get() as AuthUserRow | undefined
    if (!row) throw new Error('No active GM account was found on this computer.')
    const username = this.validateUsername(input.username)
    const { salt, hash } = this.passwordHash(input.password)
    const now = new Date().toISOString()
    try {
      this.db.prepare('UPDATE user_accounts SET username = ?, salt = ?, credential_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
        .run(username, salt, hash, now, asString(row.id))
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) throw new Error('That username is already in use.')
      throw error
    }
    this.logAudit('auth.gm_login_recovered', 'user_accounts', asString(row.id), `GM login recovered; username changed from ${asString(row.username)} to ${username}.`, 'local recovery')
  }

  listUserAccounts(): UserAccountSummary[] {
    const rows = this.db.prepare(`
      SELECT id, username, display_name AS displayName, role, active, created_at AS createdAt
      FROM user_accounts ORDER BY CASE role WHEN 'GM' THEN 0 ELSE 1 END, display_name COLLATE NOCASE
    `).all() as AuthUserRow[]
    return rows.map((row) => ({ ...this.authUserFromRow(row), active: asNumber(row.active) === 1, createdAt: asString(row.createdAt) }))
  }

  createTeamLeader(input: TeamLeaderInput): UserAccountSummary {
    const username = this.validateUsername(input.username)
    const displayName = this.validateDisplayName(input.displayName)
    const { salt, hash } = this.passwordHash(input.password)
    const id = randomUUID()
    const now = new Date().toISOString()
    try {
      this.db.prepare(`
        INSERT INTO user_accounts (id, username, display_name, role, salt, credential_hash, failed_attempts, locked_until, active, created_at, updated_at)
        VALUES (?, ?, ?, 'TEAM_LEADER', ?, ?, 0, NULL, 1, ?, ?)
      `).run(id, username, displayName, salt, hash, now, now)
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) throw new Error('That username is already in use.')
      throw error
    }
    this.logAudit('auth.team_leader_created', 'user_accounts', id, `Created team leader account for ${displayName}.`)
    return { id, username, displayName, role: 'TEAM_LEADER', active: true, createdAt: now }
  }

  resetUserPassword(userId: string, password: string): void {
    const row = this.db.prepare("SELECT username FROM user_accounts WHERE id = ? AND role = 'TEAM_LEADER' AND active = 1").get(userId) as AuthUserRow | undefined
    if (!row) throw new Error('Active team leader account not found.')
    const { salt, hash } = this.passwordHash(password)
    this.db.prepare('UPDATE user_accounts SET salt = ?, credential_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
      .run(salt, hash, new Date().toISOString(), userId)
    this.logAudit('auth.team_leader_password_reset', 'user_accounts', userId, `Reset password for ${asString(row.username)}.`)
  }

  disableUser(userId: string): void {
    const result = this.db.prepare("UPDATE user_accounts SET active = 0, updated_at = ? WHERE id = ? AND role = 'TEAM_LEADER' AND active = 1")
      .run(new Date().toISOString(), userId)
    if (result.changes === 0) throw new Error('Active team leader account not found.')
    this.logAudit('auth.team_leader_disabled', 'user_accounts', userId, 'Disabled a team leader login.')
  }

  changeMyPassword(userId: string, currentPassword: string, newPassword: string): void {
    const row = this.db.prepare('SELECT salt, credential_hash AS credentialHash FROM user_accounts WHERE id = ? AND active = 1').get(userId) as AuthUserRow | undefined
    if (!row || !this.verifyPassword(currentPassword, asString(row.salt), asString(row.credentialHash))) throw new Error('Current password is incorrect.')
    const { salt, hash } = this.passwordHash(newPassword)
    this.db.prepare('UPDATE user_accounts SET salt = ?, credential_hash = ?, updated_at = ? WHERE id = ?')
      .run(salt, hash, new Date().toISOString(), userId)
    this.logAudit('auth.password_changed', 'user_accounts', userId, 'User changed their password.')
  }

  listKpis(): KpiDefinition[] {
    return (this.db.prepare('SELECT code, name, unit, direction, description FROM kpi_definitions WHERE active = 1 ORDER BY sort_order').all() as Record<string, unknown>[])
      .map((row) => ({
        code: asString(row.code), name: asString(row.name), unit: asString(row.unit),
        direction: asString(row.direction) as KpiDefinition['direction'], description: asString(row.description)
      }))
  }

  getDashboard(period: string): DashboardData {
    this.assertPeriod(period)
    const previousPeriod = shiftPeriod(period, -1)
    const definitions = this.listKpis()
    const reps = this.listSalesReps()
    const currentTeam = this.teamRecordsForPeriod(period, reps)
    const previousTeam = this.teamRecordsForPeriod(previousPeriod, reps)
    const kpis = definitions.map((definition) => this.summarizeKpi(definition, currentTeam.get(definition.code), previousTeam.get(definition.code)))
    const scorecards: RepScorecard[] = reps.map((rep) => {
      const current = this.recordsForPeriod(period, rep.id)
      const previous = this.recordsForPeriod(previousPeriod, rep.id)
      const review = this.reviewForPeriod(period, rep.id)
      const identity = this.identityForRep(rep.id)
      return {
        repId: rep.id,
        repName: rep.name,
        kpis: definitions.map((definition) => this.summarizeKpi(definition, current.get(definition.code), previous.get(definition.code))),
        campaigns: this.campaignsForPeriod(period, rep.id),
        attendance: this.attendanceForPeriod(period, rep.id),
        managerFeedback: review.managerFeedback,
        agentFeedback: review.agentFeedback,
        signedBy: review.signedBy,
        signedAt: review.signedAt,
        signatureData: review.signatureData,
        identityCredentialConfigured: identity.configured,
        identityVerifiedAt: identity.verifiedAt
      }
    })
    const repSummaries = scorecards.map((scorecard) => this.repSummary(scorecard))
    const tracked = kpis.filter((item) => item.achievement !== null)
    const callsPerDay = this.callsPerDayForPeriod(period)

    return {
      period,
      teamName: this.getSetting('team_name') ?? 'Your sales team',
      kpis,
      scorecards,
      reps: repSummaries,
      callsPerDay,
      winRateByRep: repSummaries.filter((rep) => rep.conversionRate !== null).map((rep): WinRatePoint => ({ rep: rep.repName, winRate: rep.conversionRate ?? 0 })),
      hasData: tracked.length > 0 || scorecards.some((card) => card.campaigns.length > 0 || card.attendance.daysRecorded > 0),
      onTrackCount: tracked.filter((item) => item.status === 'on-track').length,
      trackedCount: tracked.length
    }
  }

  saveRecord(record: PerformanceRecordInput): void {
    const candidate = validateImportRows([record], this.listKpis().map((item) => item.code))
    if (candidate.issues.length) throw new Error(candidate.issues[0].message)
    this.withTransaction(() => {
      this.writeRecord(candidate.rows[0])
      this.logAudit('record.saved', 'performance_records', `${candidate.rows[0].rep}:${candidate.rows[0].code}:${candidate.rows[0].period}`, `Actual ${candidate.rows[0].actual}; target ${candidate.rows[0].target}.`)
    })
  }

  saveReviewFeedback(input: ReviewFeedbackInput): void {
    this.assertPeriod(input.period)
    const rep = this.findActiveRep(input.repId)
    const managerFeedback = input.managerFeedback.trim()
    const agentFeedback = input.agentFeedback.trim()
    if (managerFeedback.length > 5000) throw new Error('Manager feedback must be 5,000 characters or fewer.')
    if (agentFeedback.length > 5000) throw new Error('Agent feedback must be 5,000 characters or fewer.')
    const now = new Date().toISOString()
    this.withTransaction(() => {
      this.db.prepare(`
        INSERT INTO agent_monthly_reviews (rep_id, period, manager_feedback, agent_feedback, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(rep_id, period) DO UPDATE SET
          manager_feedback = excluded.manager_feedback,
          agent_feedback = excluded.agent_feedback,
          updated_at = excluded.updated_at
      `).run(rep.id, input.period, managerFeedback, agentFeedback, now)
      this.logAudit('review.feedback_saved', 'agent_monthly_reviews', `${rep.id}:${input.period}`, `Saved monthly feedback for ${rep.name}.`)
    })
  }

  setAgentCredential(input: AgentCredentialInput): void {
    const rep = this.findActiveRep(input.repId)
    if (input.identityConfirmed !== true) throw new Error('Confirm that the agent’s identity was checked in person before setting access.')
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) {
      throw new Error('The agent password must be between 8 and 128 characters.')
    }
    const salt = randomBytes(16).toString('base64')
    const credentialHash = scryptSync(input.password, salt, 64).toString('base64')
    const now = new Date().toISOString()
    const existing = this.db.prepare('SELECT rep_id FROM agent_credentials WHERE rep_id = ?').get(rep.id)
    this.withTransaction(() => {
      this.db.prepare(`
        INSERT INTO agent_credentials (rep_id, salt, credential_hash, identity_verified_at, failed_attempts, locked_until, updated_at)
        VALUES (?, ?, ?, ?, 0, NULL, ?)
        ON CONFLICT(rep_id) DO UPDATE SET
          salt = excluded.salt, credential_hash = excluded.credential_hash,
          identity_verified_at = excluded.identity_verified_at,
          failed_attempts = 0, locked_until = NULL, updated_at = excluded.updated_at
      `).run(rep.id, salt, credentialHash, now, now)
      this.logAudit(existing ? 'agent.identity_credential_reset' : 'agent.identity_credential_set', 'agent_credentials', rep.id, `Agent access credential ${existing ? 'reset' : 'set'} after in-person identity confirmation for ${rep.name}.`)
    })
  }

  acknowledgeReview(input: ReviewAcknowledgementInput): void {
    this.assertPeriod(input.period)
    const rep = this.findActiveRep(input.repId)
    if (typeof input.signatureData !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.signatureData) || input.signatureData.length > 200_000) {
      throw new Error('Draw and save a signature before acknowledging this review.')
    }
    if (!this.campaignsForPeriod(input.period, rep.id).length) throw new Error('Import at least one campaign result for this month before acknowledgment.')
    if (!this.attendanceForPeriod(input.period, rep.id).daysRecorded) throw new Error('Import attendance for this agent and month before acknowledgment.')

    const now = new Date().toISOString()
    this.withTransaction(() => {
      this.db.prepare(`
        INSERT INTO agent_monthly_reviews (rep_id, period, signed_by, signed_at, signed_signature, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(rep_id, period) DO UPDATE SET
          signed_by = excluded.signed_by,
          signed_at = excluded.signed_at,
          signed_signature = excluded.signed_signature,
          updated_at = excluded.updated_at
      `).run(rep.id, input.period, rep.name, now, input.signatureData, now)
      this.logAudit('review.acknowledged', 'agent_monthly_reviews', `${rep.id}:${input.period}`, `${rep.name} signed and acknowledged the monthly scorecard.`)
    })
  }

  importRecords(input: { rows: unknown[]; campaignRows: unknown[]; attendanceRows: unknown[] }): ImportResult {
    const validation = validateImportRows(input.rows, this.listKpis().map((item) => item.code))
    const campaignValidation = validateCampaignActivityRows(input.campaignRows)
    const attendanceValidation = validateAttendanceRows(input.attendanceRows)
    const issues = [
      ...validation.issues.map((issue) => ({ ...issue, message: `Monthly KPI: ${issue.message}` })),
      ...campaignValidation.issues.map((issue) => ({ ...issue, message: `Campaign activity: ${issue.message}` })),
      ...attendanceValidation.issues.map((issue) => ({ ...issue, message: `Attendance: ${issue.message}` }))
    ]
    if (issues.length) return { imported: 0, campaignImported: 0, attendanceImported: 0, issues }
    this.withTransaction(() => {
      validation.rows.forEach((row) => this.writeRecord(row))
      campaignValidation.rows.forEach((row) => this.writeCampaignActivity(row))
      attendanceValidation.rows.forEach((row) => this.writeAttendance(row))
      this.logAudit('data.imported', 'monthly_performance_data', null, `Imported ${validation.rows.length} monthly KPI, ${campaignValidation.rows.length} campaign activity, and ${attendanceValidation.rows.length} attendance rows.`)
    })
    return {
      imported: validation.rows.length,
      campaignImported: campaignValidation.rows.length,
      attendanceImported: attendanceValidation.rows.length,
      issues: []
    }
  }

  seedDemoData(): { seeded: boolean; message: string } {
    const count = asNumber((this.db.prepare('SELECT COUNT(*) AS count FROM performance_records').get() as Record<string, unknown>).count)
    const names = ['Aisha Patel', 'Daniel Mokoena', 'Lebo Khumalo', 'Priya Nair', 'Thabo Dlamini']
    const period = currentMonth()

    if (count > 0) {
      const roster = this.listSalesReps().map((rep) => rep.name).sort((a, b) => a.localeCompare(b))
      const expectedRoster = [...names].sort((a, b) => a.localeCompare(b))
      const campaignCount = asNumber((this.db.prepare("SELECT COUNT(*) AS count FROM campaign_activity WHERE substr(activity_date, 1, 7) = ?").get(period) as Record<string, unknown>).count)
      const attendanceCount = asNumber((this.db.prepare("SELECT COUNT(*) AS count FROM attendance_records WHERE substr(activity_date, 1, 7) = ?").get(period) as Record<string, unknown>).count)
      const isSampleWorkspace = this.getSetting('team_name') === 'Sample Sales Team'
        && roster.length === expectedRoster.length
        && roster.every((name, index) => name === expectedRoster[index])

      if (isSampleWorkspace && campaignCount === 0 && attendanceCount === 0) {
        this.withTransaction(() => {
          names.forEach((name, repIndex) => {
            const id = this.ensureSalesRep(name)
            this.seedCampaignAttendance({ id, name }, period, repIndex)
          })
          this.logAudit('demo.attendance_seeded', 'workspace', null, `Added fictional HPE, Dell, and Lenovo campaign results and mixed attendance for ${period}.`)
        })
        return { seeded: true, message: `Sample HPE, Dell, and Lenovo campaigns and attendance loaded for ${period}.` }
      }

      return { seeded: false, message: 'Sample data is already prepared, or this workspace contains non-sample data.' }
    }

    this.withTransaction(() => {
      this.setSetting('team_name', 'Sample Sales Team')
      const reps = names.map((name) => ({ name, id: this.ensureSalesRep(name) }))
      const periods = Array.from({ length: 6 }, (_, index) => shiftPeriod(period, index - 5))

      reps.forEach((rep, repIndex) => {
        periods.forEach((month, monthIndex) => {
          const calls = 285 + monthIndex * 18 + (4 - repIndex) * 9
          const conversionRate = 9.3 + monthIndex * 0.45 + (4 - repIndex) * 0.35
          const closed = Math.round(calls * conversionRate / 100)
          const values: Record<string, { target: number; actual: number; note: string }> = {
            CALLS_MADE: { target: 350, actual: calls, note: '' },
            DEALS_CLOSED: { target: 40, actual: closed, note: '' },
            CONVERSION_RATE: { target: 11.5, actual: Math.round(conversionRate * 10) / 10, note: '' }
          }
          Object.entries(values).forEach(([code, data]) => this.writeRecord({ rep: rep.name, code, period: month, ...data }))
          this.seedDailyCalls(rep.id, month, calls, repIndex)
          if (month === period) this.seedCampaignAttendance(rep, month, repIndex)
        })
      })

      this.logAudit('demo.seeded', 'workspace', null, 'Loaded six months of sample B2B outbound performance with current-month campaign and attendance data.')
    })
    return { seeded: true, message: `Sample sales data loaded through ${period}.` }
  }

  listSalesReps(): SalesRep[] {
    return (this.db.prepare('SELECT id, name FROM sales_reps WHERE active = 1 ORDER BY name COLLATE NOCASE').all() as Record<string, unknown>[])
      .map((row) => ({ id: asString(row.id), name: asString(row.name) }))
  }

  listAuditEntries(limit = 30): AuditEntry[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 30
    const rows = this.db.prepare('SELECT actor, event, entity, entity_id AS entityId, details, created_at AS createdAt FROM audit_log ORDER BY id DESC LIMIT ?').all(safeLimit) as Record<string, unknown>[]
    return rows.map((row) => ({
      actor: asString(row.actor), event: asString(row.event), entity: asString(row.entity),
      entityId: row.entityId === null ? null : asString(row.entityId), details: asString(row.details), createdAt: asString(row.createdAt)
    }))
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_accounts (
        id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('GM', 'TEAM_LEADER')),
        salt TEXT NOT NULL, credential_hash TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kpi_definitions (
        code TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('higher', 'lower')),
        description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS sales_reps (
        id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)), created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS performance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rep_id TEXT NOT NULL REFERENCES sales_reps(id),
        kpi_code TEXT NOT NULL REFERENCES kpi_definitions(code),
        period TEXT NOT NULL CHECK (length(period) = 7), target REAL NOT NULL, actual REAL NOT NULL,
        note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
        UNIQUE (rep_id, kpi_code, period)
      );
      CREATE TABLE IF NOT EXISTS daily_call_activity (
        rep_id TEXT NOT NULL REFERENCES sales_reps(id), day TEXT NOT NULL CHECK (length(day) = 10),
        calls INTEGER NOT NULL CHECK (calls >= 0), updated_at TEXT NOT NULL,
        PRIMARY KEY (rep_id, day)
      );
      CREATE TABLE IF NOT EXISTS campaign_activity (
        rep_id TEXT NOT NULL REFERENCES sales_reps(id), activity_date TEXT NOT NULL CHECK (length(activity_date) = 10),
        campaign TEXT NOT NULL, target REAL NOT NULL CHECK (target >= 0), actual REAL NOT NULL CHECK (actual >= 0),
        updated_at TEXT NOT NULL, UNIQUE (rep_id, activity_date, campaign)
      );
      CREATE TABLE IF NOT EXISTS attendance_records (
        rep_id TEXT NOT NULL REFERENCES sales_reps(id), activity_date TEXT NOT NULL CHECK (length(activity_date) = 10),
        status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'leave', 'sick', 'off')), updated_at TEXT NOT NULL,
        PRIMARY KEY (rep_id, activity_date)
      );
      CREATE TABLE IF NOT EXISTS agent_credentials (
        rep_id TEXT PRIMARY KEY REFERENCES sales_reps(id) ON DELETE CASCADE,
        salt TEXT NOT NULL, credential_hash TEXT NOT NULL, identity_verified_at TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_monthly_reviews (
        rep_id TEXT NOT NULL REFERENCES sales_reps(id),
        period TEXT NOT NULL CHECK (length(period) = 7),
        manager_feedback TEXT NOT NULL DEFAULT '', agent_feedback TEXT NOT NULL DEFAULT '',
        signed_by TEXT, signed_at TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (rep_id, period)
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL DEFAULT 'local', event TEXT NOT NULL,
        entity TEXT NOT NULL, entity_id TEXT, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_records_period ON performance_records(period);
      CREATE INDEX IF NOT EXISTS idx_calls_day ON daily_call_activity(day);
      CREATE INDEX IF NOT EXISTS idx_campaign_activity_date ON campaign_activity(activity_date);
      CREATE INDEX IF NOT EXISTS idx_attendance_activity_date ON attendance_records(activity_date);
      CREATE INDEX IF NOT EXISTS idx_reviews_period ON agent_monthly_reviews(period);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    `)
  }

  private migrateSchema(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as Record<string, unknown>
    const currentVersion = asNumber(row.user_version)
    if (currentVersion > 5) throw new Error(`Database version ${currentVersion} is newer than this application supports.`)
    if (currentVersion === 0) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.createSchema()
        this.db.exec('PRAGMA user_version = 1; COMMIT;')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
    if (currentVersion <= 1) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS agent_monthly_reviews (
            rep_id TEXT NOT NULL REFERENCES sales_reps(id),
            period TEXT NOT NULL CHECK (length(period) = 7),
            manager_feedback TEXT NOT NULL DEFAULT '', agent_feedback TEXT NOT NULL DEFAULT '',
            signed_by TEXT, signed_at TEXT, updated_at TEXT NOT NULL,
            PRIMARY KEY (rep_id, period)
          );
          CREATE INDEX IF NOT EXISTS idx_reviews_period ON agent_monthly_reviews(period);
          UPDATE kpi_definitions SET active = 0 WHERE code IN ('REVENUE', 'FOLLOW_UPS_DUE');
          PRAGMA user_version = 2;
          COMMIT;
        `)
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
    if (currentVersion <= 2) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS campaign_activity (
            rep_id TEXT NOT NULL REFERENCES sales_reps(id), activity_date TEXT NOT NULL CHECK (length(activity_date) = 10),
            campaign TEXT NOT NULL, target REAL NOT NULL CHECK (target >= 0), actual REAL NOT NULL CHECK (actual >= 0),
            updated_at TEXT NOT NULL, UNIQUE (rep_id, activity_date, campaign)
          );
          CREATE TABLE IF NOT EXISTS attendance_records (
            rep_id TEXT NOT NULL REFERENCES sales_reps(id), activity_date TEXT NOT NULL CHECK (length(activity_date) = 10),
            status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'leave', 'sick', 'off')), updated_at TEXT NOT NULL,
            PRIMARY KEY (rep_id, activity_date)
          );
          CREATE TABLE IF NOT EXISTS agent_credentials (
            rep_id TEXT PRIMARY KEY REFERENCES sales_reps(id) ON DELETE CASCADE,
            salt TEXT NOT NULL, credential_hash TEXT NOT NULL, identity_verified_at TEXT NOT NULL,
            failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_campaign_activity_date ON campaign_activity(activity_date);
          CREATE INDEX IF NOT EXISTS idx_attendance_activity_date ON attendance_records(activity_date);
          PRAGMA user_version = 3;
          COMMIT;
        `)
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
    if (currentVersion <= 3) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS user_accounts (
            id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, display_name TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('GM', 'TEAM_LEADER')),
            salt TEXT NOT NULL, credential_hash TEXT NOT NULL,
            failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          PRAGMA user_version = 4;
          COMMIT;
        `)
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
    if (currentVersion <= 4) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(`ALTER TABLE agent_monthly_reviews ADD COLUMN signed_signature TEXT; PRAGMA user_version = 5; COMMIT;`)
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
  }

  private installDefaultKpis(): void {
    const statement = this.db.prepare('INSERT OR IGNORE INTO kpi_definitions (code, name, unit, direction, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
    KPI_DEFINITIONS.forEach((item, index) => statement.run(item.code, item.name, item.unit, item.direction, item.description, index))
  }

  private summarizeKpi(definition: KpiDefinition, current?: RawRecord, previous?: RawRecord): KpiSummary {
    const achievement = current ? achievementPercent(current.target, current.actual, definition.direction) : null
    return {
      ...definition,
      target: current?.target ?? null,
      actual: current?.actual ?? null,
      achievement,
      status: achievement === null ? null : performanceStatus(achievement),
      previousActual: previous?.actual ?? null,
      changePercent: current && previous ? percentChange(current.actual, previous.actual) : null,
      note: current?.note ?? ''
    }
  }

  private recordsForPeriod(period: string, repId: string): Map<string, RawRecord> {
    const rows = this.db.prepare('SELECT kpi_code, target, actual, note FROM performance_records WHERE period = ? AND rep_id = ?').all(period, repId) as Record<string, unknown>[]
    return new Map(rows.map((row) => [asString(row.kpi_code), { target: asNumber(row.target), actual: asNumber(row.actual), note: asString(row.note) }]))
  }

  private reviewForPeriod(period: string, repId: string): { managerFeedback: string; agentFeedback: string; signedBy: string | null; signedAt: string | null; signatureData: string | null } {
    const row = this.db.prepare(`
      SELECT manager_feedback AS managerFeedback, agent_feedback AS agentFeedback,
        signed_by AS signedBy, signed_at AS signedAt, signed_signature AS signatureData
      FROM agent_monthly_reviews WHERE period = ? AND rep_id = ?
    `).get(period, repId) as Record<string, unknown> | undefined
    return {
      managerFeedback: asString(row?.managerFeedback),
      agentFeedback: asString(row?.agentFeedback),
      signedBy: typeof row?.signedBy === 'string' ? row.signedBy : null,
      signedAt: typeof row?.signedAt === 'string' ? row.signedAt : null,
      signatureData: typeof row?.signatureData === 'string' ? row.signatureData : null
    }
  }

  private identityForRep(repId: string): { configured: boolean; verifiedAt: string | null } {
    const row = this.db.prepare('SELECT identity_verified_at AS verifiedAt FROM agent_credentials WHERE rep_id = ?').get(repId) as Record<string, unknown> | undefined
    return {
      configured: Boolean(row),
      verifiedAt: typeof row?.verifiedAt === 'string' ? asString(row.verifiedAt) : null
    }
  }

  private campaignsForPeriod(period: string, repId: string): CampaignPerformanceSummary[] {
    const rows = this.db.prepare(`
      SELECT campaign, SUM(target) AS target, SUM(actual) AS actual, COUNT(DISTINCT activity_date) AS daysTracked
      FROM campaign_activity WHERE rep_id = ? AND substr(activity_date, 1, 7) = ?
      GROUP BY campaign ORDER BY campaign COLLATE NOCASE
    `).all(repId, period) as Record<string, unknown>[]
    return rows.map((row) => {
      const target = asNumber(row.target)
      const actual = asNumber(row.actual)
      return {
        campaign: asString(row.campaign), target, actual,
        achievement: achievementPercent(target, actual, 'higher'),
        daysTracked: asNumber(row.daysTracked)
      }
    })
  }

  private attendanceForPeriod(period: string, repId: string): AttendanceSummary {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS daysRecorded,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS presentDays,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absentDays,
        SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END) AS leaveDays,
        SUM(CASE WHEN status = 'sick' THEN 1 ELSE 0 END) AS sickDays,
        SUM(CASE WHEN status = 'off' THEN 1 ELSE 0 END) AS offDays
      FROM attendance_records WHERE rep_id = ? AND substr(activity_date, 1, 7) = ?
    `).get(repId, period) as Record<string, unknown>
    const presentDays = asNumber(row.presentDays)
    const absentDays = asNumber(row.absentDays)
    const leaveDays = asNumber(row.leaveDays)
    const sickDays = asNumber(row.sickDays)
    const offDays = asNumber(row.offDays)
    const scheduledDays = presentDays + absentDays + sickDays
    return {
      daysRecorded: asNumber(row.daysRecorded), scheduledDays, presentDays, absentDays, leaveDays, sickDays, offDays,
      attendanceRate: scheduledDays ? (presentDays / scheduledDays) * 100 : null
    }
  }

  private findActiveRep(repId: string): SalesRep {
    if (!repId.trim()) throw new Error('Choose a sales representative.')
    const row = this.db.prepare('SELECT id, name FROM sales_reps WHERE id = ? AND active = 1').get(repId) as Record<string, unknown> | undefined
    if (!row) throw new Error('Sales representative not found.')
    return { id: asString(row.id), name: asString(row.name) }
  }

  private teamRecordsForPeriod(period: string, reps: SalesRep[]): Map<string, RawRecord> {
    const rows = reps.flatMap((rep) => Array.from(this.recordsForPeriod(period, rep.id), ([code, values]) => ({ rep, code, ...values })))
    const result = new Map<string, RawRecord>()
    for (const definition of KPI_DEFINITIONS) {
      const items = rows.filter((row) => row.code === definition.code)
      if (!items.length) continue
      if (AGGREGATED_CODES.has(definition.code)) {
        result.set(definition.code, {
          target: items.reduce((sum, item) => sum + item.target, 0),
          actual: items.reduce((sum, item) => sum + item.actual, 0),
          note: ''
        })
      }
    }
    const calls = result.get('CALLS_MADE')?.actual ?? 0
    const dealsClosed = result.get('DEALS_CLOSED')?.actual ?? 0
    const callRows = rows.filter((row) => row.code === 'CALLS_MADE')
    const closedRows = rows.filter((row) => row.code === 'DEALS_CLOSED')
    const conversionItems = rows.filter((row) => row.code === 'CONVERSION_RATE')
    if (callRows.length || closedRows.length || conversionItems.length) {
      const targetByRep = callRows.map((call) => {
        const conversion = conversionItems.find((item) => item.rep.id === call.rep.id)
        const closed = closedRows.find((item) => item.rep.id === call.rep.id)
        const targetRate = conversion?.target ?? (closed && call.target > 0 ? closed.target / call.target * 100 : 0)
        return { weight: call.target, targetRate }
      })
      const totalWeight = targetByRep.reduce((sum, item) => sum + item.weight, 0)
      const target = totalWeight > 0
        ? targetByRep.reduce((sum, item) => sum + item.targetRate * item.weight, 0) / totalWeight
        : conversionItems.length ? conversionItems.reduce((sum, row) => sum + row.target, 0) / conversionItems.length : 0
      result.set('CONVERSION_RATE', { target, actual: calls > 0 ? (dealsClosed / calls) * 100 : 0, note: '' })
    }
    return result
  }

  private repSummary(scorecard: RepScorecard): RepPerformanceSummary {
    const value = (code: string) => scorecard.kpis.find((item) => item.code === code)?.actual ?? null
    const tracked = scorecard.kpis.flatMap((item) => item.achievement === null ? [] : [item.achievement])
    const overallAchievement = tracked.length ? tracked.reduce((sum, achievement) => sum + achievement, 0) / tracked.length : null
    const status: PerformanceStatus | null = overallAchievement === null ? null : performanceStatus(overallAchievement)
    return {
      repId: scorecard.repId,
      repName: scorecard.repName,
      calls: value('CALLS_MADE'),
      closed: value('DEALS_CLOSED'),
      conversionRate: value('CONVERSION_RATE'),
      status
    }
  }

  private callsPerDayForPeriod(period: string): CallsPerDayPoint[] {
    const rows = this.db.prepare(`
      SELECT day, SUM(calls) AS calls FROM daily_call_activity
      WHERE substr(day, 1, 7) = ? GROUP BY day ORDER BY day
    `).all(period) as Record<string, unknown>[]
    return rows.map((row) => {
      const day = asString(row.day)
      return { day, label: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`)), calls: asNumber(row.calls) }
    })
  }

  private seedDailyCalls(repId: string, period: string, totalCalls: number, repIndex: number): void {
    const [year, month] = period.split('-').map(Number)
    const monthDays = new Date(year, month, 0).getDate()
    const isCurrentPeriod = period === currentMonth()
    const lastDay = isCurrentPeriod ? new Date().getDate() : monthDays
    const weekdays = Array.from({ length: lastDay }, (_, index) => index + 1)
      .filter((day) => new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 0 && new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 6)
    if (!weekdays.length) return
    const weights = weekdays.map((day) => 10 + ((day + repIndex * 3) % 5))
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
    let allocated = 0
    const statement = this.db.prepare('INSERT INTO daily_call_activity (rep_id, day, calls, updated_at) VALUES (?, ?, ?, ?)')
    weekdays.forEach((day, index) => {
      const calls = index === weekdays.length - 1 ? totalCalls - allocated : Math.floor(totalCalls * weights[index] / weightSum)
      allocated += calls
      const date = `${period}-${String(day).padStart(2, '0')}`
      statement.run(repId, date, calls, new Date().toISOString())
    })
  }

  private seedCampaignAttendance(rep: SalesRep, period: string, repIndex: number): void {
    const [year, month] = period.split('-').map(Number)
    const monthDays = new Date(year, month, 0).getDate()
    const lastDay = period === currentMonth() ? new Date().getDate() : monthDays
    const weekdays = Array.from({ length: lastDay }, (_, index) => index + 1)
      .filter((day) => new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 0 && new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 6)
    const campaignNames = ['HPE', 'Dell', 'Lenovo']
    const targets: Record<string, number> = { HPE: 12, Dell: 10, Lenovo: 8 }
    const attendanceExceptions: Record<number, { index: number; status: AttendanceRecordInput['status'] }> = {
      0: { index: 4, status: 'absent' },
      1: { index: 7, status: 'sick' },
      2: { index: 2, status: 'leave' },
      3: { index: 9, status: 'off' },
      4: { index: 5, status: 'absent' }
    }
    weekdays.forEach((day, index) => {
      const date = `${period}-${String(day).padStart(2, '0')}`
      const exception = attendanceExceptions[repIndex]
      const status = exception?.index === index ? exception.status : 'present'
      const campaign = campaignNames[(index + repIndex) % campaignNames.length]
      const target = targets[campaign]
      const actual = target + ((index * 3 + repIndex) % 7) - 2
      this.writeAttendance({ rep: rep.name, date, status })
      this.writeCampaignActivity({ rep: rep.name, date, campaign, target, actual: Math.max(0, actual) })
    })
  }

  private writeRecord(record: PerformanceRecordInput): void {
    const repId = this.ensureSalesRep(record.rep)
    this.db.prepare(`
      INSERT INTO performance_records (rep_id, kpi_code, period, target, actual, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rep_id, kpi_code, period) DO UPDATE SET
        target = excluded.target, actual = excluded.actual, note = excluded.note, updated_at = excluded.updated_at
    `).run(repId, record.code.toUpperCase(), record.period, record.target, record.actual, record.note ?? '', new Date().toISOString())
    this.resetAcknowledgement(repId, record.period)
  }

  private writeCampaignActivity(record: CampaignActivityInput): void {
    const repId = this.ensureSalesRep(record.rep)
    this.db.prepare(`
      INSERT INTO campaign_activity (rep_id, activity_date, campaign, target, actual, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(rep_id, activity_date, campaign) DO UPDATE SET
        target = excluded.target, actual = excluded.actual, updated_at = excluded.updated_at
    `).run(repId, record.date, record.campaign, record.target, record.actual, new Date().toISOString())
    this.resetAcknowledgement(repId, record.date.slice(0, 7))
  }

  private writeAttendance(record: AttendanceRecordInput): void {
    const repId = this.ensureSalesRep(record.rep)
    this.db.prepare(`
      INSERT INTO attendance_records (rep_id, activity_date, status, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(rep_id, activity_date) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).run(repId, record.date, record.status, new Date().toISOString())
    this.resetAcknowledgement(repId, record.date.slice(0, 7))
  }

  private resetAcknowledgement(repId: string, period: string): void {
    const reset = this.db.prepare(`
      UPDATE agent_monthly_reviews SET signed_by = NULL, signed_at = NULL, signed_signature = NULL, updated_at = ?
      WHERE rep_id = ? AND period = ? AND signed_at IS NOT NULL
    `).run(new Date().toISOString(), repId, period)
    if (reset.changes > 0) {
      this.logAudit('review.acknowledgement_reset', 'agent_monthly_reviews', `${repId}:${period}`, 'Monthly KPI, campaign activity, or attendance data changed after the review was acknowledged.')
    }
  }

  private ensureSalesRep(name: string): string {
    const normalized = name.trim().replace(/\s+/g, ' ')
    const existing = this.db.prepare('SELECT id FROM sales_reps WHERE name = ? COLLATE NOCASE').get(normalized) as Record<string, unknown> | undefined
    if (existing) return asString(existing.id)
    const id = randomUUID()
    this.db.prepare('INSERT INTO sales_reps (id, name, created_at) VALUES (?, ?, ?)').run(id, normalized, new Date().toISOString())
    return id
  }

  private assertPeriod(period: string): void {
    if (!isValidPeriod(period)) throw new Error('Reporting period must be a valid month in YYYY-MM format.')
  }

  private getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Record<string, unknown> | undefined
    return row ? asString(row.value) : undefined
  }

  private setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  private validateUsername(value: string): string {
    const username = typeof value === 'string' ? value.trim() : ''
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw new Error('Username must be 3–32 characters using letters, numbers, dots, dashes, or underscores.')
    return username
  }

  private validateDisplayName(value: string): string {
    const displayName = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
    if (displayName.length < 2 || displayName.length > 100) throw new Error('Display name must be between 2 and 100 characters.')
    return displayName
  }

  private passwordHash(password: string): { salt: string; hash: string } {
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Password must be between 12 and 128 characters.')
    const salt = randomBytes(16).toString('base64')
    return { salt, hash: scryptSync(password, salt, 64).toString('base64') }
  }

  private verifyPassword(password: string, salt: string, storedHash: string): boolean {
    if (!salt || !storedHash) return false
    const enteredHash = scryptSync(password, salt, 64)
    const expectedHash = Buffer.from(storedHash, 'base64')
    return expectedHash.length === enteredHash.length && timingSafeEqual(expectedHash, enteredHash)
  }

  private authUserFromRow(row: AuthUserRow): AuthUser {
    const role = asString(row.role)
    if (role !== 'GM' && role !== 'TEAM_LEADER') throw new Error('User account has an invalid role.')
    return { id: asString(row.id), username: asString(row.username), displayName: asString(row.displayName), role: role as AppUserRole }
  }

  private logAudit(event: string, entity: string, entityId: string | null, details: string, actor = this.auditActor): void {
    this.db.prepare('INSERT INTO audit_log (actor, event, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(actor.slice(0, 100), event, entity, entityId, details.slice(0, 2000), new Date().toISOString())
  }

  private withTransaction(work: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try { work(); this.db.exec('COMMIT') }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
