import type { AttendanceRecordInput, AttendanceStatus, CampaignActivityInput, ImportIssue } from '../../shared/models'

export interface ValidatedRows<T> {
  rows: T[]
  issues: ImportIssue[]
}

export function normalizeActivityDate(value: unknown): string | null {
  let year: number
  let month: number
  let day: number

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    year = value.getFullYear()
    month = value.getMonth() + 1
    day = value.getDate()
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000)
    year = date.getUTCFullYear()
    month = date.getUTCMonth() + 1
    day = date.getUTCDate()
  } else if (typeof value === 'string') {
    const source = value.trim()
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(source)
    const southAfrican = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(source)
    if (iso) {
      year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3])
    } else if (southAfrican) {
      day = Number(southAfrican[1]); month = Number(southAfrican[2]); year = Number(southAfrican[3])
    } else {
      return null
    }
  } else {
    return null
  }

  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function normalizeAttendanceStatus(value: unknown): AttendanceStatus | null {
  if (typeof value !== 'string') return null
  const status = value.trim().toLocaleLowerCase().replace(/[^a-z]+/g, ' ')
  if (['present', 'in', 'worked', 'on duty', 'late'].includes(status)) return 'present'
  if (['absent', 'no show', 'noshow'].includes(status)) return 'absent'
  if (['leave', 'annual leave', 'paid leave', 'permission'].includes(status)) return 'leave'
  if (['sick', 'sick leave', 'medical leave'].includes(status)) return 'sick'
  if (['off', 'off day', 'rest day', 'public holiday', 'holiday'].includes(status)) return 'off'
  return null
}

export function validateCampaignActivityRows(rows: unknown[]): ValidatedRows<CampaignActivityInput> {
  const valid: CampaignActivityInput[] = []
  const issues: ImportIssue[] = []
  const seen = new Set<string>()
  rows.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      issues.push({ row: index + 1, message: 'row must be an object' })
      return
    }
    const candidate = item as Partial<CampaignActivityInput>
    const rep = typeof candidate.rep === 'string' ? candidate.rep.trim().replace(/\s+/g, ' ') : ''
    const date = normalizeActivityDate(candidate.date)
    const campaign = typeof candidate.campaign === 'string' ? candidate.campaign.trim().replace(/\s+/g, ' ') : ''
    const target = candidate.target
    const actual = candidate.actual
    const messages: string[] = []
    if (!rep || rep.length > 100) messages.push('agent name must contain between 1 and 100 characters')
    if (!date) messages.push('date must be a real date in YYYY-MM-DD or DD/MM/YYYY format')
    if (!campaign || campaign.length > 100) messages.push('campaign must contain between 1 and 100 characters')
    if (typeof target !== 'number' || !Number.isFinite(target) || target < 0) messages.push('target must be a non-negative number')
    if (typeof actual !== 'number' || !Number.isFinite(actual) || actual < 0) messages.push('actual must be a non-negative number')
    const key = `${date}:${rep.toLocaleLowerCase()}:${campaign.toLocaleLowerCase()}`
    if (!messages.length && seen.has(key)) messages.push('duplicate agent, date, and campaign row in this import')
    if (messages.length) {
      issues.push({ row: index + 1, message: messages.join('; ') })
      return
    }
    seen.add(key)
    valid.push({ rep, date: date as string, campaign, target: target as number, actual: actual as number })
  })
  return { rows: valid, issues }
}

export function validateAttendanceRows(rows: unknown[]): ValidatedRows<AttendanceRecordInput> {
  const valid: AttendanceRecordInput[] = []
  const issues: ImportIssue[] = []
  const seen = new Set<string>()
  rows.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      issues.push({ row: index + 1, message: 'row must be an object' })
      return
    }
    const candidate = item as Partial<AttendanceRecordInput>
    const rep = typeof candidate.rep === 'string' ? candidate.rep.trim().replace(/\s+/g, ' ') : ''
    const date = normalizeActivityDate(candidate.date)
    const status = normalizeAttendanceStatus(candidate.status)
    const messages: string[] = []
    if (!rep || rep.length > 100) messages.push('agent name must contain between 1 and 100 characters')
    if (!date) messages.push('date must be a real date in YYYY-MM-DD or DD/MM/YYYY format')
    if (!status) messages.push('status must be Present, Absent, Leave, Sick, or Off')
    const key = `${date}:${rep.toLocaleLowerCase()}`
    if (!messages.length && seen.has(key)) messages.push('duplicate agent and date attendance row in this import')
    if (messages.length) {
      issues.push({ row: index + 1, message: messages.join('; ') })
      return
    }
    seen.add(key)
    valid.push({ rep, date: date as string, status: status as AttendanceStatus })
  })
  return { rows: valid, issues }
}

export function parseDailyNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const source = value.trim()
  if (!/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(source)) return null
  const parsed = Number(source.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}
