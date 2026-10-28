import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LocalStore } from './local-store'

const stores: LocalStore[] = []

function createStore(): LocalStore {
  const store = new LocalStore(':memory:')
  stores.push(store)
  return store
}

function enterCompleteScorecard(store: LocalStore, rep = 'Aisha Patel', period = '2026-01'): void {
  store.saveRecord({ rep, code: 'CALLS_MADE', period, target: 350, actual: 410 })
  store.saveRecord({ rep, code: 'DEALS_CLOSED', period, target: 40, actual: 49 })
  store.saveRecord({ rep, code: 'CONVERSION_RATE', period, target: 11.5, actual: 12 })
}

function enterCampaignAndAttendance(store: LocalStore, rep = 'Aisha Patel', date = '2026-01-05'): void {
  store.importRecords({
    rows: [],
    campaignRows: [{ rep, date, campaign: 'Campaign A', target: 10, actual: 8 }],
    attendanceRows: [{ rep, date, status: 'present' }]
  })
}

afterEach(() => { stores.splice(0).forEach((store) => store.close()) })

describe('local outbound performance reviews', () => {
  it('starts with the three outbound KPIs and no invented results', () => {
    const store = createStore()
    const dashboard = store.getDashboard('2026-01')
    expect(store.listKpis().map((item) => item.code)).toEqual(['CALLS_MADE', 'DEALS_CLOSED', 'CONVERSION_RATE'])
    expect(dashboard.hasData).toBe(false)
    expect(dashboard.kpis.every((metric) => metric.actual === null)).toBe(true)
    expect(dashboard.reps).toEqual([])
  })

  it('sets up a secure GM login and supports managed team-leader accounts', () => {
    const store = createStore()
    expect(store.hasUserAccounts()).toBe(false)
    const gm = store.setupInitialGm({ username: 'gm.admin', displayName: 'General Manager', password: 'GM-Secure-Password-2026' })
    expect(gm).toMatchObject({ username: 'gm.admin', role: 'GM' })
    expect(store.hasUserAccounts()).toBe(true)
    expect(() => store.setupInitialGm({ username: 'second.gm', displayName: 'Second GM', password: 'Another-Secure-Password' })).toThrow('already been set up')
    expect(() => store.authenticateUser({ username: 'gm.admin', password: 'wrong-password' })).toThrow('incorrect')
    expect(store.authenticateUser({ username: 'GM.ADMIN', password: 'GM-Secure-Password-2026' })).toMatchObject({ id: gm.id, role: 'GM' })

    const leader = store.createTeamLeader({ username: 'team.lead', displayName: 'Team Leader One', password: 'Leader-Secure-Password' })
    expect(leader).toMatchObject({ username: 'team.lead', role: 'TEAM_LEADER', active: true })
    expect(store.authenticateUser({ username: 'team.lead', password: 'Leader-Secure-Password' })).toMatchObject({ id: leader.id, role: 'TEAM_LEADER' })
    store.resetUserPassword(leader.id, 'Leader-New-Secure-Password')
    expect(() => store.authenticateUser({ username: 'team.lead', password: 'Leader-Secure-Password' })).toThrow('incorrect')
    expect(store.authenticateUser({ username: 'team.lead', password: 'Leader-New-Secure-Password' })).toMatchObject({ id: leader.id })
    store.disableUser(leader.id)
    expect(() => store.authenticateUser({ username: 'team.lead', password: 'Leader-New-Secure-Password' })).toThrow('incorrect')
  })

  it('locks a user login after five failed password attempts', () => {
    const store = createStore()
    store.setupInitialGm({ username: 'gm.admin', displayName: 'General Manager', password: 'GM-Secure-Password-2026' })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => store.authenticateUser({ username: 'gm.admin', password: 'wrong-password' })).toThrow()
    }
    expect(() => store.authenticateUser({ username: 'gm.admin', password: 'GM-Secure-Password-2026' })).toThrow('temporarily locked')
  })

  it('seeds sample outbound history without revenue or follow-up KPIs', () => {
    const store = createStore()
    const result = store.seedDemoData()
    const month = new Date()
    const period = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
    const dashboard = store.getDashboard(period)
    expect(result.seeded).toBe(true)
    expect(dashboard.teamName).toBe('Sample Sales Team')
    expect(dashboard.hasData).toBe(true)
    expect(dashboard.kpis.map((metric) => metric.code)).toEqual(['CALLS_MADE', 'DEALS_CLOSED', 'CONVERSION_RATE'])
    expect(dashboard.scorecards).toHaveLength(5)
    expect(dashboard.reps).toHaveLength(5)
    expect(dashboard.callsPerDay.length).toBeGreaterThan(0)
    expect(dashboard.callsPerDay.reduce((sum, point) => sum + point.calls, 0)).toBe(dashboard.kpis.find((metric) => metric.code === 'CALLS_MADE')?.actual)
    expect(dashboard.winRateByRep).toHaveLength(5)
    expect(dashboard.scorecards[0]).toMatchObject({ managerFeedback: '', agentFeedback: '', signedBy: null, signedAt: null })
    expect(dashboard.scorecards[0].campaigns.length).toBeGreaterThan(0)
    expect(dashboard.scorecards[0].attendance.daysRecorded).toBeGreaterThan(0)
    expect(new Set(dashboard.scorecards.flatMap((card) => card.campaigns.map((campaign) => campaign.campaign)))).toEqual(new Set(['HPE', 'Dell', 'Lenovo']))
    expect(dashboard.scorecards.some((card) => card.attendance.absentDays > 0)).toBe(true)
    expect(dashboard.scorecards.some((card) => card.attendance.sickDays > 0)).toBe(true)
    expect(dashboard.scorecards.some((card) => card.attendance.leaveDays > 0)).toBe(true)
    expect(store.seedDemoData().seeded).toBe(false)
  })

  it('upserts per-agent KPI-month records and rejects inactive inbound KPIs', () => {
    const store = createStore()
    store.saveRecord({ rep: 'Aisha Patel', code: 'CALLS_MADE', period: '2026-01', target: 350, actual: 400 })
    store.saveRecord({ rep: 'Aisha Patel', code: 'CALLS_MADE', period: '2026-01', target: 360, actual: 420 })
    const metric = store.getDashboard('2026-01').scorecards[0].kpis.find((item) => item.code === 'CALLS_MADE')
    expect(metric?.target).toBe(360)
    expect(metric?.actual).toBe(420)
    expect(() => store.saveRecord({ rep: 'Aisha Patel', code: 'REVENUE', period: '2026-01', target: 1000, actual: 1200 })).toThrow('unknown KPI code')

    const result = store.importRecords({ rows: [
      { rep: 'Daniel Mokoena', code: 'CALLS_MADE', period: '2026-01', target: 100, actual: 110 },
      { rep: 'Daniel Mokoena', code: 'DEALS_CLOSED', period: '2026-13', target: 10, actual: 11 }
    ], campaignRows: [], attendanceRows: [] })
    expect(result.imported).toBe(0)
    expect(result.issues).toHaveLength(1)
    expect(store.getDashboard('2026-01').scorecards.find((rep) => rep.repName === 'Daniel Mokoena')).toBeUndefined()
  })

  it('calculates team conversion from total deals closed over total calls', () => {
    const store = createStore()
    store.saveRecord({ rep: 'Aisha Patel', code: 'CALLS_MADE', period: '2026-01', target: 100, actual: 100 })
    store.saveRecord({ rep: 'Aisha Patel', code: 'DEALS_CLOSED', period: '2026-01', target: 10, actual: 10 })
    store.saveRecord({ rep: 'Daniel Mokoena', code: 'CALLS_MADE', period: '2026-01', target: 100, actual: 300 })
    store.saveRecord({ rep: 'Daniel Mokoena', code: 'DEALS_CLOSED', period: '2026-01', target: 30, actual: 30 })
    const teamConversion = store.getDashboard('2026-01').kpis.find((metric) => metric.code === 'CONVERSION_RATE')
    expect(teamConversion?.actual).toBe(10)
  })

  it('stores feedback and the agent signature with monthly acknowledgment', () => {
    const store = createStore()
    enterCompleteScorecard(store)
    const repId = store.getDashboard('2026-01').scorecards[0].repId
    store.saveReviewFeedback({ repId, period: '2026-01', managerFeedback: 'Strong improvement.', agentFeedback: 'I will keep practising discovery.' })
    enterCampaignAndAttendance(store)
    expect(() => store.acknowledgeReview({ repId, period: '2026-01', signatureData: '' })).toThrow('Draw and save a signature')
    const signatureData = 'data:image/png;base64,AAAA'
    store.acknowledgeReview({ repId, period: '2026-01', signatureData })

    const scorecard = store.getDashboard('2026-01').scorecards[0]
    expect(scorecard.campaigns).toEqual([{ campaign: 'Campaign A', target: 10, actual: 8, achievement: 80, daysTracked: 1 }])
    expect(scorecard.attendance).toMatchObject({ daysRecorded: 1, scheduledDays: 1, presentDays: 1, attendanceRate: 100 })
    expect(scorecard.managerFeedback).toBe('Strong improvement.')
    expect(scorecard.agentFeedback).toBe('I will keep practising discovery.')
    expect(scorecard.signedBy).toBe('Aisha Patel')
    expect(scorecard.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(scorecard.signatureData).toBe(signatureData)
    expect(store.listAuditEntries(10).map((entry) => entry.event)).toContain('review.acknowledged')
    store.importRecords({ rows: [], campaignRows: [{ rep: 'Aisha Patel', date: '2026-01-05', campaign: 'Campaign A', target: 10, actual: 9 }], attendanceRows: [] })
    expect(store.getDashboard('2026-01').scorecards[0].signedAt).toBeNull()
  })

  it('rejects invalid signature payloads', () => {
    const store = createStore()
    const rep = 'Aisha Patel'
    const repId = (() => { enterCampaignAndAttendance(store, rep); return store.getDashboard('2026-01').scorecards[0].repId })()
    expect(() => store.acknowledgeReview({ repId, period: '2026-01', signatureData: 'not an image' })).toThrow('Draw and save a signature')
  })

  it('requires campaign and attendance data and clears acknowledgment if stats change', () => {
    const store = createStore()
    store.saveRecord({ rep: 'Aisha Patel', code: 'CALLS_MADE', period: '2026-01', target: 350, actual: 410 })
    const repId = store.getDashboard('2026-01').scorecards[0].repId
    const signatureData = 'data:image/png;base64,AAAA'
    expect(() => store.acknowledgeReview({ repId, period: '2026-01', signatureData })).toThrow('campaign result')

    enterCompleteScorecard(store)
    store.importRecords({ rows: [], campaignRows: [{ rep: 'Aisha Patel', date: '2026-01-05', campaign: 'Campaign A', target: 10, actual: 8 }], attendanceRows: [] })
    expect(() => store.acknowledgeReview({ repId, period: '2026-01', signatureData })).toThrow('Import attendance')
    enterCampaignAndAttendance(store)
    store.acknowledgeReview({ repId, period: '2026-01', signatureData })
    expect(store.getDashboard('2026-01').scorecards[0].signedAt).not.toBeNull()
    store.saveRecord({ rep: 'Aisha Patel', code: 'CALLS_MADE', period: '2026-01', target: 350, actual: 411 })
    expect(store.getDashboard('2026-01').scorecards[0].signedAt).toBeNull()
    expect(store.listAuditEntries(10).map((entry) => entry.event)).toContain('review.acknowledgement_reset')
  })

  it('migrates an existing v1 database without deleting its saved history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'performance-tracker-v1-'))
    const databasePath = join(directory, 'legacy.sqlite')
    const legacy = new DatabaseSync(databasePath)
    try {
      legacy.exec(`
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE kpi_definitions (
          code TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL,
          direction TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE sales_reps (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE performance_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT, rep_id TEXT NOT NULL, kpi_code TEXT NOT NULL,
          period TEXT NOT NULL, target REAL NOT NULL, actual REAL NOT NULL, note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
          UNIQUE (rep_id, kpi_code, period)
        );
        CREATE TABLE daily_call_activity (rep_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (rep_id, day));
        CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL DEFAULT 'local', event TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
        PRAGMA user_version = 1;
      `)
      const definitions = [
        ['CALLS_MADE', 'Calls Made', 'count', 'higher', 'Calls', 0],
        ['DEALS_CLOSED', 'Deals Closed', 'count', 'higher', 'Deals', 1],
        ['REVENUE', 'Revenue', 'currency', 'higher', 'Inbound KPI', 2],
        ['CONVERSION_RATE', 'Conversion Rate', '%', 'higher', 'Conversion', 3],
        ['FOLLOW_UPS_DUE', 'Follow-ups Due', 'count', 'lower', 'Not used', 4]
      ]
      const addKpi = legacy.prepare('INSERT INTO kpi_definitions (code,name,unit,direction,description,sort_order) VALUES (?,?,?,?,?,?)')
      definitions.forEach((item) => addKpi.run(...item))
      legacy.prepare('INSERT INTO sales_reps (id,name,active,created_at) VALUES (?,?,1,?)').run('legacy-rep', 'Aisha Patel', '2026-01-01T00:00:00.000Z')
      legacy.prepare('INSERT INTO performance_records (rep_id,kpi_code,period,target,actual,note,updated_at) VALUES (?,?,?,?,?,?,?)').run('legacy-rep', 'CALLS_MADE', '2026-01', 350, 410, 'kept', '2026-01-31T00:00:00.000Z')
      legacy.prepare('INSERT INTO performance_records (rep_id,kpi_code,period,target,actual,note,updated_at) VALUES (?,?,?,?,?,?,?)').run('legacy-rep', 'REVENUE', '2026-01', 200000, 210000, 'legacy inbound data', '2026-01-31T00:00:00.000Z')
    } finally {
      legacy.close()
    }

    const store = new LocalStore(databasePath)
    try {
      expect(store.listKpis().map((item) => item.code)).toEqual(['CALLS_MADE', 'DEALS_CLOSED', 'CONVERSION_RATE'])
      expect(store.getDashboard('2026-01').scorecards[0].kpis.find((item) => item.code === 'CALLS_MADE')?.actual).toBe(410)
    } finally {
      store.close()
      const migrated = new DatabaseSync(databasePath)
      try {
        expect(migrated.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 5 })
        expect(migrated.prepare("SELECT COUNT(*) AS count FROM performance_records WHERE kpi_code = 'REVENUE'").get()).toMatchObject({ count: 1 })
      } finally {
        migrated.close()
        rmSync(directory, { recursive: true, force: true })
      }
    }
  })
})
