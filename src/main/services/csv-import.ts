import { parse } from 'csv-parse/sync'
import type { AttendanceRecordInput, CampaignActivityInput, ImportColumn, ImportDataset, ImportIssue, ImportSheetMapping, ImportSheetProfile, PerformanceRecordInput } from '../../shared/models'
import { parseDailyNumber, validateAttendanceRows, validateCampaignActivityRows } from './daily-import'
import { isValidPeriod, normalizeReportingPeriod } from './performance'

export interface ParsedImport {
  rows: PerformanceRecordInput[]
  campaignRows?: CampaignActivityInput[]
  attendanceRows?: AttendanceRecordInput[]
  issues: ImportIssue[]
  sheets?: ImportSheetProfile[]
}

export interface ImportBatch extends ParsedImport {
  sourceName: string
}

type CsvRow = Record<string, string | undefined>

export function parseImportNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const source = value.trim()
  if (!/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(source)) return null
  const normalized = source.replace(/,/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const CSV_HEADER_ALIASES: Record<ImportColumn, string[]> = {
  period: ['period', 'month', 'reportingmonth', 'reviewmonth', 'monthyear', 'yearmonth'],
  date: ['date', 'activitydate', 'calldate', 'closeddate', 'createddate', 'dateldrmadesale', 'day', 'workdate', 'leaddate'],
  rep: ['rep', 'representative', 'salesrep', 'repname', 'agent', 'agentname', 'agentfullname', 'owner', 'ldrname', 'esl', 'employee', 'employeename', 'staffname', 'consultant', 'consultantname', 'sdr', 'sdrname', 'caller', 'username'],
  kpi: ['kpicode', 'kpi', 'metric', 'metriccode', 'measure', 'measurecode', 'indicator'],
  target: ['target', 'goal', 'monthlytarget', 'dailytarget', 'quota', 'expected', 'required', 'targetleads', 'leadstarget', 'calltarget'],
  actual: ['actual', 'value', 'achieved', 'result', 'completed', 'total', 'actualleads', 'leadsactual', 'calls', 'callsmade', 'dealsclosed'],
  note: ['note', 'notes', 'comment', 'comments'],
  campaign: ['campaign', 'campaignname', 'project', 'client', 'programme', 'program'],
  status: ['status', 'attendance', 'attendancestatus', 'shiftstatus', 'daystatus', 'workstatus']
}

function csvHeaderSuggestions(headers: string[]): Partial<Record<ImportColumn, number>> {
  const normalized = headers.map((header) => header.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ''))
  const result: Partial<Record<ImportColumn, number>> = {}
  for (const field of Object.keys(CSV_HEADER_ALIASES) as ImportColumn[]) {
    const index = normalized.findIndex((header) => CSV_HEADER_ALIASES[field].includes(header))
    if (index >= 0) result[field] = index
  }
  return result
}

function datasetLayout(dataset: ImportDataset): ImportSheetProfile['layout'] {
  if (dataset === 'monthly-kpis') return 'performance-template'
  if (dataset === 'campaign-results') return 'campaign-activity'
  if (dataset === 'attendance') return 'attendance'
  return 'unrecognized'
}

export function parsePerformanceCsv(text: string, knownCodes: string[], mappings: ImportSheetMapping[] = [], fileName = 'CSV file'): ParsedImport {
  if (text.length > 10_000_000) {
    return { rows: [], issues: [{ row: 0, message: 'File is larger than the 10 MB import limit.' }] }
  }

  let records: CsvRow[]
  try {
    records = parse(text, {
      bom: true,
      columns: (headers: string[]) => headers.map((header) => header.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false
    }) as CsvRow[]
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The CSV could not be read.'
    return { rows: [], issues: [{ row: 0, message }] }
  }

  if (records.length > 10_000) {
    return { rows: [], issues: [{ row: 0, message: 'A single import is limited to 10,000 rows.' }] }
  }

  const required = ['period', 'rep', 'kpi_code', 'target', 'actual']
  const headers = records.length ? Object.keys(records[0]) : []
  const guessed = csvHeaderSuggestions(headers)
  const valueAt = (record: CsvRow, index: number) => index < 0 ? '' : record[headers[index]] ?? ''
  const dateColumn = guessed.date ?? -1
  const repColumn = guessed.rep ?? -1
  const campaignColumn = guessed.campaign ?? -1
  const targetColumn = guessed.target ?? -1
  const actualColumn = guessed.actual ?? -1
  const statusColumn = guessed.status ?? -1
  const mappingId = `${fileName}::${fileName}`
  const suggestedDataset: ImportDataset = dateColumn >= 0 && repColumn >= 0 && campaignColumn >= 0 && targetColumn >= 0 && actualColumn >= 0
    ? 'campaign-results'
    : dateColumn >= 0 && repColumn >= 0 && statusColumn >= 0
      ? 'attendance'
      : guessed.period !== undefined && guessed.rep !== undefined && guessed.kpi !== undefined && guessed.target !== undefined && guessed.actual !== undefined
        ? 'monthly-kpis'
        : 'skip'
  const mapping = mappings.find((candidate) => candidate.mappingId === mappingId)
  const profile: ImportSheetProfile = {
    mappingId, fileName, sheetName: fileName, layout: mapping ? datasetLayout(mapping.dataset) : datasetLayout(suggestedDataset),
    suggestedDataset: mapping?.dataset ?? suggestedDataset, suggestedColumns: mapping?.columns ?? guessed,
    dataRows: records.length, headers, campaigns: [], campaignCount: 0,
    message: mapping ? (mapping.dataset === 'skip' ? 'Skipped by your mapping.' : `Mapped as ${mapping.dataset.replace('-', ' ')}.`)
      : records.length ? 'Choose how these columns should be used, or skip this file.' : 'No data rows found below the header.'
  }

  if (mapping) {
    if (mapping.dataset === 'skip') return { rows: [], issues: [], sheets: [profile] }
    const required: ImportColumn[] = mapping.dataset === 'monthly-kpis'
      ? ['period', 'rep', 'kpi', 'target', 'actual']
      : mapping.dataset === 'campaign-results'
        ? ['date', 'rep', 'campaign', 'target', 'actual']
        : ['date', 'rep', 'status']
    const missing = required.filter((field) => !Number.isInteger(mapping.columns[field]) || (mapping.columns[field] as number) < 0)
    if (missing.length) return { rows: [], issues: [{ row: 1, message: `Map these required fields: ${missing.join(', ')}.` }], sheets: [profile] }
    const valueAtColumn = (record: CsvRow, field: ImportColumn) => {
      const index = mapping.columns[field]
      return index === undefined ? '' : record[headers[index]] ?? ''
    }
    const rows: PerformanceRecordInput[] = []
    const campaignRows: CampaignActivityInput[] = []
    const attendanceRows: AttendanceRecordInput[] = []
    const issues: ImportIssue[] = []
    const known = new Set(knownCodes.map((code) => code.trim().toUpperCase()))
    const seen = new Set<string>()
    records.forEach((record, index) => {
      const line = index + 2
      if (mapping.dataset === 'campaign-results') {
        const validation = validateCampaignActivityRows([{
          rep: valueAtColumn(record, 'rep'), date: valueAtColumn(record, 'date'), campaign: valueAtColumn(record, 'campaign'),
          target: parseDailyNumber(valueAtColumn(record, 'target')), actual: parseDailyNumber(valueAtColumn(record, 'actual'))
        }])
        if (validation.issues.length) issues.push({ row: line, message: validation.issues[0].message })
        else campaignRows.push(validation.rows[0])
      } else if (mapping.dataset === 'attendance') {
        const validation = validateAttendanceRows([{
          rep: valueAtColumn(record, 'rep'), date: valueAtColumn(record, 'date'), status: valueAtColumn(record, 'status')
        }])
        if (validation.issues.length) issues.push({ row: line, message: validation.issues[0].message })
        else attendanceRows.push(validation.rows[0])
      } else {
        const period = normalizeReportingPeriod(valueAtColumn(record, 'period'))
        const rep = valueAtColumn(record, 'rep').trim().replace(/\s+/g, ' ')
        const code = valueAtColumn(record, 'kpi').trim().toUpperCase()
        const target = parseImportNumber(valueAtColumn(record, 'target'))
        const actual = parseImportNumber(valueAtColumn(record, 'actual'))
        const note = valueAtColumn(record, 'note').trim().slice(0, 1000)
        const messages: string[] = []
        if (!isValidPeriod(period)) messages.push('period must use YYYY-MM with a valid month')
        if (!rep || rep.length > 100) messages.push('rep must contain between 1 and 100 characters')
        if (!known.has(code)) messages.push(`unknown KPI code "${code || '(blank)'}"`)
        if (target === null) messages.push('target must be a valid number')
        if (actual === null) messages.push('actual must be a valid number')
        const key = `${period}:${rep.toLocaleLowerCase()}:${code}`
        if (!messages.length && seen.has(key)) messages.push('duplicate rep, KPI, and period in this file')
        if (messages.length || target === null || actual === null) issues.push({ row: line, message: messages.join('; ') })
        else { seen.add(key); rows.push({ period, rep, code, target, actual, note }) }
      }
    })
    return { rows, campaignRows, attendanceRows, issues, sheets: [profile] }
  }

  if (dateColumn >= 0 && repColumn >= 0 && campaignColumn >= 0 && targetColumn >= 0 && actualColumn >= 0) {
    const candidates = records.map((record) => ({
      rep: valueAt(record, repColumn), date: valueAt(record, dateColumn), campaign: valueAt(record, campaignColumn),
      target: parseDailyNumber(valueAt(record, targetColumn)), actual: parseDailyNumber(valueAt(record, actualColumn))
    }))
    const validation = validateCampaignActivityRows(candidates)
    return {
      rows: [], campaignRows: validation.rows,
      issues: validation.issues.map((issue) => ({ ...issue, row: issue.row + 1 })), sheets: [profile]
    }
  }

  if (dateColumn >= 0 && repColumn >= 0 && statusColumn >= 0) {
    const candidates = records.map((record) => ({ rep: valueAt(record, repColumn), date: valueAt(record, dateColumn), status: valueAt(record, statusColumn) }))
    const validation = validateAttendanceRows(candidates)
    return {
      rows: [], attendanceRows: validation.rows,
      issues: validation.issues.map((issue) => ({ ...issue, row: issue.row + 1 })), sheets: [profile]
    }
  }

  const missing = required.filter((key) => !headers.includes(key))
  if (missing.length) {
    return {
      rows: [],
      issues: [{ row: 1, message: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` }], sheets: [profile]
    }
  }

  const known = new Set(knownCodes.map((code) => code.trim().toUpperCase()))
  const rows: PerformanceRecordInput[] = []
  const issues: ImportIssue[] = []
  const seen = new Set<string>()

  records.forEach((record, index) => {
    const line = index + 2
    const period = normalizeReportingPeriod(record.period ?? '')
    const rep = (record.rep ?? '').trim().replace(/\s+/g, ' ')
    const code = (record.kpi_code ?? '').trim().toUpperCase()
    const target = parseImportNumber(record.target)
    const actual = parseImportNumber(record.actual)
    const messages: string[] = []

    if (!isValidPeriod(period)) messages.push('period must use YYYY-MM with a valid month')
    if (!rep || rep.length > 100) messages.push('rep must contain between 1 and 100 characters')
    if (!known.has(code)) messages.push(`unknown KPI code "${code || '(blank)'}"`)
    if (target === null) messages.push('target must be a valid number')
    if (actual === null) messages.push('actual must be a valid number')

    const key = `${period}:${rep.toLocaleLowerCase()}:${code}`
    if (!messages.length && seen.has(key)) messages.push('duplicate rep, KPI, and period in this file')
    if (!messages.length && target !== null && actual !== null) {
      seen.add(key)
      rows.push({
        rep,
        period,
        code,
        target,
        actual,
        note: (record.notes ?? '').trim().slice(0, 1000)
      })
    } else {
      issues.push({ row: line, message: messages.join('; ') })
    }
  })

  return { rows, issues, sheets: [profile] }
}

export function validateImportRows(rows: unknown[], knownCodes: string[]): ParsedImport {
  const known = new Set(knownCodes.map((code) => code.trim().toUpperCase()))
  const validRows: PerformanceRecordInput[] = []
  const issues: ImportIssue[] = []
  const seen = new Set<string>()

  rows.forEach((item, index) => {
    const rowNumber = index + 1
    if (!item || typeof item !== 'object') {
      issues.push({ row: rowNumber, message: 'row must be an object' })
      return
    }
    const candidate = item as Partial<PerformanceRecordInput>
    const period = typeof candidate.period === 'string' ? candidate.period.trim() : ''
    const rep = typeof candidate.rep === 'string' ? candidate.rep.trim().replace(/\s+/g, ' ') : ''
    const code = typeof candidate.code === 'string' ? candidate.code.trim().toUpperCase() : ''
    const target = candidate.target
    const actual = candidate.actual
    const messages: string[] = []

    if (!isValidPeriod(period)) messages.push('period must use YYYY-MM with a valid month')
    if (!rep || rep.length > 100) messages.push('rep must contain between 1 and 100 characters')
    if (!known.has(code)) messages.push(`unknown KPI code "${code || '(blank)'}"`)
    if (typeof target !== 'number' || !Number.isFinite(target)) messages.push('target must be a valid number')
    if (typeof actual !== 'number' || !Number.isFinite(actual)) messages.push('actual must be a valid number')
    const key = `${period}:${rep.toLocaleLowerCase()}:${code}`
    if (!messages.length && seen.has(key)) messages.push('duplicate rep, KPI, and period in this import')

    if (!messages.length) {
      seen.add(key)
      validRows.push({
        rep,
        period,
        code,
        target: target as number,
        actual: actual as number,
        note: typeof candidate.note === 'string' ? candidate.note.slice(0, 1000) : ''
      })
    } else {
      issues.push({ row: rowNumber, message: messages.join('; ') })
    }
  })

  return { rows: validRows, issues }
}

export function combinePerformanceImports(batches: ImportBatch[], knownCodes: string[]): ParsedImport {
  const rows = batches.flatMap((batch) => batch.rows)
  const sources = batches.flatMap((batch) => batch.rows.map(() => batch.sourceName))
  const sheets = batches.flatMap((batch) => batch.sheets ?? [])
  const issues = batches.flatMap((batch) => batch.issues.map((issue) => ({
    ...issue,
    message: `${batch.sourceName} · ${issue.message}`
  })))
  const validation = validateImportRows(rows, knownCodes)
  validation.issues.forEach((issue) => {
    const source = sources[issue.row - 1]
    issues.push({ ...issue, message: `${source ? `${source} · ` : ''}${issue.message}` })
  })
  const campaignSources = batches.flatMap((batch) => (batch.campaignRows ?? []).map(() => batch.sourceName))
  const campaignValidation = validateCampaignActivityRows(batches.flatMap((batch) => batch.campaignRows ?? []))
  campaignValidation.issues.forEach((issue) => {
    const source = campaignSources[issue.row - 1]
    issues.push({ ...issue, message: `${source ? `${source} · ` : ''}${issue.message}` })
  })
  const attendanceSources = batches.flatMap((batch) => (batch.attendanceRows ?? []).map(() => batch.sourceName))
  const attendanceValidation = validateAttendanceRows(batches.flatMap((batch) => batch.attendanceRows ?? []))
  attendanceValidation.issues.forEach((issue) => {
    const source = attendanceSources[issue.row - 1]
    issues.push({ ...issue, message: `${source ? `${source} · ` : ''}${issue.message}` })
  })
  return {
    rows: validation.rows,
    campaignRows: campaignValidation.rows,
    attendanceRows: attendanceValidation.rows,
    issues,
    sheets
  }
}
