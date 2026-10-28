import ExcelJS from 'exceljs'
import type { AttendanceRecordInput, CampaignActivityInput, ImportColumn, ImportDataset, ImportIssue, ImportSheetLayout, ImportSheetMapping, ImportSheetProfile, PerformanceRecordInput } from '../../shared/models'
import { parseImportNumber, validateImportRows, type ParsedImport } from './csv-import'
import { normalizeActivityDate, normalizeAttendanceStatus, parseDailyNumber, validateAttendanceRows, validateCampaignActivityRows } from './daily-import'
import { normalizeReportingPeriod } from './performance'

function unwrapCellValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if ('result' in value) return (value as { result?: unknown }).result
  if ('text' in value && typeof (value as { text?: unknown }).text === 'string') return (value as { text: string }).text
  if ('richText' in value && Array.isArray((value as { richText?: unknown }).richText)) {
    return (value as { richText: { text: string }[] }).richText.map((piece) => piece.text).join('')
  }
  return value
}

function valueAsText(value: unknown): string {
  const unwrapped = unwrapCellValue(value)
  if (unwrapped instanceof Date) return `${unwrapped.getFullYear()}-${String(unwrapped.getMonth() + 1).padStart(2, '0')}`
  if (unwrapped === null || unwrapped === undefined) return ''
  return String(unwrapped).trim()
}

function valueAsNumber(value: unknown): number | null {
  return parseImportNumber(unwrapCellValue(value))
}

function normalizedHeader(value: unknown): string {
  return valueAsText(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
}

const HEADER_ALIASES: Record<string, string[]> = {
  period: ['period', 'month', 'reportingmonth', 'reviewmonth', 'monthyear', 'yearmonth'],
  date: ['date', 'activitydate', 'calldate', 'closeddate', 'createddate', 'dateldrmadesale', 'day', 'workdate', 'leaddate'],
  rep: ['rep', 'representative', 'salesrep', 'repname', 'agent', 'agentname', 'agentfullname', 'owner', 'ldrname', 'esl', 'employee', 'employeename', 'staffname', 'consultant', 'consultantname', 'sdr', 'sdrname', 'caller', 'username'],
  kpi: ['kpicode', 'kpi', 'metric', 'metriccode', 'measure', 'measurecode', 'indicator'],
  target: ['target', 'goal', 'monthlytarget', 'dailytarget', 'quota', 'expected', 'required', 'targetleads', 'leadstarget', 'calltarget'],
  actual: ['actual', 'value', 'achieved', 'result', 'completed', 'total', 'actualleads', 'leadsactual', 'calls', 'callsmade', 'dealsclosed'],
  note: ['note', 'notes', 'comment', 'comments'],
  outcome: ['outcome', 'result', 'disposition'],
  status: ['status', 'attendance', 'attendancestatus', 'shiftstatus', 'daystatus', 'workstatus'],
  campaign: ['campaign', 'campaignname', 'project', 'client', 'programme', 'program'],
  company: ['company', 'account'],
  prospect: ['prospect', 'contact', 'rpcname'],
  email: ['email', 'emailaddress']
}

const IMPORT_FIELDS: ImportColumn[] = ['period', 'date', 'rep', 'kpi', 'target', 'actual', 'note', 'campaign', 'status']

function suggestedDataset(layout: ImportSheetLayout, headers: string[]): ImportDataset {
  if (layout === 'performance-template') return 'monthly-kpis'
  if (layout === 'campaign-activity') return 'campaign-results'
  if (layout === 'attendance') return 'attendance'
  const has = (field: ImportColumn) => headerIndex(headers, field) >= 0
  if (has('date') && has('rep') && has('campaign') && has('target') && has('actual')) return 'campaign-results'
  if (has('date') && has('rep') && has('status')) return 'attendance'
  if (has('period') && has('rep') && has('kpi') && has('target') && has('actual')) return 'monthly-kpis'
  return 'skip'
}

function suggestedColumns(headers: string[]): Partial<Record<ImportColumn, number>> {
  const columns: Partial<Record<ImportColumn, number>> = {}
  for (const field of IMPORT_FIELDS) {
    const index = headerIndex(headers, field)
    if (index >= 0) columns[field] = index
  }
  return columns
}

function datasetLayout(dataset: ImportDataset): ImportSheetLayout {
  if (dataset === 'monthly-kpis') return 'performance-template'
  if (dataset === 'campaign-results') return 'campaign-activity'
  if (dataset === 'attendance') return 'attendance'
  return 'unrecognized'
}

function headerIndex(headers: string[], field: string): number {
  const aliases = HEADER_ALIASES[field] ?? [field]
  return headers.findIndex((header) => aliases.includes(header))
}

function detectLayout(headers: string[]): ImportSheetLayout {
  const has = (field: string) => headerIndex(headers, field) >= 0
  if (['period', 'rep', 'kpi', 'target', 'actual'].every(has)) return 'performance-template'
  if (has('date') && has('rep') && has('outcome')) return 'qa-review'
  if (has('date') && has('rep') && has('status')) return 'attendance'
  if (has('date') && has('rep') && has('campaign') && has('target') && has('actual')) return 'campaign-activity'
  if (has('date') && has('rep') && (has('campaign') || has('company') || headers.includes('ldrname'))) return 'lead-activity'
  if (has('company') && (has('prospect') || has('email'))) return 'contact-list'
  return 'unrecognized'
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number {
  const limit = Math.min(sheet.rowCount, 15)
  let firstNonEmpty = 0
  for (let rowNumber = 1; rowNumber <= limit; rowNumber += 1) {
    const values = sheet.getRow(rowNumber).values as unknown[]
    const headers = values.slice(1).map(normalizedHeader).filter(Boolean)
    if (!headers.length) continue
    if (!firstNonEmpty) firstNonEmpty = rowNumber
    const layout = detectLayout(headers)
    if (layout !== 'unrecognized') return rowNumber
  }
  return firstNonEmpty || 1
}

function profileMessage(layout: ImportSheetLayout, dataRows: number): string {
  if (!dataRows) return 'No data rows found below the header.'
  switch (layout) {
    case 'performance-template': return 'Monthly KPI rows can be imported from this sheet.'
    case 'campaign-activity': return 'Daily lead targets and actuals by campaign are ready to import.'
    case 'lead-activity': return 'Dated lead activity detected. Add daily target and actual columns to import it into campaign summaries.'
    case 'qa-review': return 'Dated QA outcome rows detected. A KPI mapping is needed before these rows can be aggregated.'
    case 'attendance': return 'Daily attendance statuses are ready to import.'
    case 'contact-list': return 'Contact-list rows detected, but no rep and date fields were found for monthly aggregation.'
    case 'unrecognized': return 'The column layout is not recognized yet and needs a mapping.'
  }
}

function issueForUnmappedSheet(layout: ImportSheetLayout): string {
  switch (layout) {
    case 'campaign-activity': return ''
    case 'lead-activity': return 'This sheet looks like dated lead activity and needs a KPI mapping.'
    case 'qa-review': return 'This sheet looks like dated QA review activity and needs a KPI mapping.'
    case 'attendance': return ''
    case 'contact-list': return 'This sheet has contact records but no rep and date fields for monthly aggregation.'
    case 'unrecognized': return 'This sheet needs a column mapping before it can be imported.'
    case 'performance-template': return ''
  }
}

function isRowEmpty(row: ExcelJS.Row): boolean {
  const values = row.values as unknown[]
  return Array.isArray(values) && values.every((value) => value === null || value === undefined || value === '')
}

function rowKey(record: PerformanceRecordInput): string {
  return `${record.period}:${record.rep.toLocaleLowerCase()}:${record.code.toLocaleUpperCase()}`
}

export async function parseXlsxBuffer(
  buffer: Buffer,
  knownCodes: string[],
  fileName = 'Workbook.xlsx',
  mappings: ImportSheetMapping[] = []
): Promise<ParsedImport> {
  let workbook: ExcelJS.Workbook
  try {
    workbook = new ExcelJS.Workbook()
    // ExcelJS still declares its Buffer parameter using an older Node type shape.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The workbook could not be read.'
    return { rows: [], issues: [{ row: 0, message: `Unable to read XLSX workbook: ${message}` }], sheets: [] }
  }

  if (!workbook.worksheets.length) return { rows: [], issues: [{ row: 1, message: 'The workbook does not contain a worksheet.' }], sheets: [] }

  const rows: PerformanceRecordInput[] = []
  const campaignRows: CampaignActivityInput[] = []
  const attendanceRows: AttendanceRecordInput[] = []
  const issues: ImportIssue[] = []
  const sheets: ImportSheetProfile[] = []
  const seen = new Set<string>()
  let totalSourceRows = 0

  for (const sheet of workbook.worksheets) {
    const mappingId = `${fileName}::${sheet.name}`
    const headerRowNumber = findHeaderRow(sheet)
    const headerRow = sheet.getRow(headerRowNumber)
    const headers = Array.from({ length: headerRow.cellCount }, (_, index) => normalizedHeader(headerRow.getCell(index + 1).value))
    const visibleHeaders = Array.from({ length: headerRow.cellCount }, (_, index) => valueAsText(headerRow.getCell(index + 1).value))
      .filter(Boolean).slice(0, 30)
    const layout = detectLayout(headers)
    const sourceRowNumbers: number[] = []
    for (let number = headerRowNumber + 1; number <= sheet.rowCount; number += 1) {
      if (!isRowEmpty(sheet.getRow(number))) sourceRowNumbers.push(number)
    }
    totalSourceRows += sourceRowNumbers.length
    if (totalSourceRows > 10_000) {
      return {
        rows: [],
        issues: [{ row: 0, message: 'A combined workbook import is limited to 10,000 non-empty data rows.' }],
        sheets
      }
    }

    const campaignColumn = headerIndex(headers, 'campaign') + 1
    const campaignNames = new Set<string>()
    if (campaignColumn > 0) {
      sourceRowNumbers.forEach((number) => {
        const campaign = valueAsText(sheet.getRow(number).getCell(campaignColumn).value).replace(/\s+/g, ' ')
        if (campaign) campaignNames.add(campaign)
      })
    }

    const mapping = mappings.find((candidate) => candidate.mappingId === mappingId)
    sheets.push({
      mappingId,
      fileName,
      sheetName: sheet.name,
      layout: mapping ? datasetLayout(mapping.dataset) : layout,
      suggestedDataset: mapping?.dataset ?? suggestedDataset(layout, headers),
      suggestedColumns: mapping?.columns ?? suggestedColumns(headers),
      dataRows: sourceRowNumbers.length,
      headers: visibleHeaders,
      campaigns: Array.from(campaignNames).slice(0, 30),
      campaignCount: campaignNames.size,
      message: mapping ? (mapping.dataset === 'skip' ? 'Skipped by your mapping.' : `Mapped as ${mapping.dataset.replace('-', ' ')}.`) : profileMessage(layout, sourceRowNumbers.length)
    })

    if (mapping) {
      if (mapping.dataset === 'skip') continue
      const required: ImportColumn[] = mapping.dataset === 'monthly-kpis'
        ? ['period', 'rep', 'kpi', 'target', 'actual']
        : mapping.dataset === 'campaign-results'
          ? ['date', 'rep', 'campaign', 'target', 'actual']
          : ['date', 'rep', 'status']
      const missing = required.filter((field) => !Number.isInteger(mapping.columns[field]) || (mapping.columns[field] as number) < 0)
      if (missing.length) {
        issues.push({ row: headerRowNumber, message: `${sheet.name}: map these required fields: ${missing.join(', ')}.` })
        continue
      }
      const cellText = (row: ExcelJS.Row, field: ImportColumn) => {
        const column = mapping.columns[field]
        return column === undefined ? '' : valueAsText(row.getCell(column + 1).value)
      }
      const cellNumber = (row: ExcelJS.Row, field: ImportColumn) => {
        const column = mapping.columns[field]
        return column === undefined ? null : valueAsNumber(row.getCell(column + 1).value)
      }
      for (const number of sourceRowNumbers) {
        const sourceRow = sheet.getRow(number)
        if (mapping.dataset === 'campaign-results') {
          const validation = validateCampaignActivityRows([{
            rep: cellText(sourceRow, 'rep'), date: normalizeActivityDate(
              mapping.columns.date === undefined ? '' : sourceRow.getCell(mapping.columns.date + 1).value
            ) ?? '',
            campaign: cellText(sourceRow, 'campaign'), target: cellNumber(sourceRow, 'target'), actual: cellNumber(sourceRow, 'actual')
          }])
          if (validation.issues.length) issues.push({ row: number, message: `${sheet.name}: ${validation.issues[0].message}` })
          else campaignRows.push(validation.rows[0])
        } else if (mapping.dataset === 'attendance') {
          const validation = validateAttendanceRows([{
            rep: cellText(sourceRow, 'rep'), date: normalizeActivityDate(
              mapping.columns.date === undefined ? '' : sourceRow.getCell(mapping.columns.date + 1).value
            ) ?? '', status: cellText(sourceRow, 'status')
          }])
          if (validation.issues.length) issues.push({ row: number, message: `${sheet.name}: ${validation.issues[0].message}` })
          else attendanceRows.push(validation.rows[0])
        } else {
          const candidate = {
            period: normalizeReportingPeriod(cellText(sourceRow, 'period')), rep: cellText(sourceRow, 'rep'), code: cellText(sourceRow, 'kpi'),
            target: cellNumber(sourceRow, 'target'), actual: cellNumber(sourceRow, 'actual'), note: cellText(sourceRow, 'note')
          }
          const validation = validateImportRows([candidate], knownCodes)
          if (validation.issues.length) issues.push({ row: number, message: `${sheet.name}: ${validation.issues[0].message}` })
          else {
            const record = validation.rows[0]
            const key = rowKey(record)
            if (seen.has(key)) issues.push({ row: number, message: `${sheet.name}: duplicate rep, KPI, and period across workbook sheets` })
            else { seen.add(key); rows.push(record) }
          }
        }
      }
      continue
    }

    if (layout === 'campaign-activity' || layout === 'attendance') {
      const columns = {
        date: headerIndex(headers, 'date') + 1,
        rep: headerIndex(headers, 'rep') + 1,
        campaign: headerIndex(headers, 'campaign') + 1,
        target: headerIndex(headers, 'target') + 1,
        actual: headerIndex(headers, 'actual') + 1,
        status: headerIndex(headers, 'status') + 1
      }
      const seenDailyRows = new Set<string>()
      const seenAttendanceRows = new Set<string>()
      for (const number of sourceRowNumbers) {
        const sourceRow = sheet.getRow(number)
        const rep = valueAsText(sourceRow.getCell(columns.rep).value).replace(/\s+/g, ' ')
        const date = normalizeActivityDate(sourceRow.getCell(columns.date).value)
        if (layout === 'campaign-activity') {
          const candidate = {
            rep,
            date: date ?? '',
            campaign: valueAsText(sourceRow.getCell(columns.campaign).value).replace(/\s+/g, ' '),
            target: parseDailyNumber(sourceRow.getCell(columns.target).value),
            actual: parseDailyNumber(sourceRow.getCell(columns.actual).value)
          }
          const validation = validateCampaignActivityRows([candidate])
          if (validation.issues.length) {
            issues.push({ row: number, message: `${sheet.name}: ${validation.issues[0].message}` })
            continue
          }
          const record = validation.rows[0]
          const key = `${record.date}:${record.rep.toLocaleLowerCase()}:${record.campaign.toLocaleLowerCase()}`
          if (seenDailyRows.has(key)) {
            issues.push({ row: number, message: `${sheet.name}: duplicate agent, date, and campaign row in this sheet` })
            continue
          }
          seenDailyRows.add(key)
          campaignRows.push(record)
        } else {
          const candidate = { rep, date: date ?? '', status: normalizeAttendanceStatus(valueAsText(sourceRow.getCell(columns.status).value)) ?? 'unknown' }
          const validation = validateAttendanceRows([candidate])
          if (validation.issues.length) {
            issues.push({ row: number, message: `${sheet.name}: ${validation.issues[0].message}` })
            continue
          }
          const record = validation.rows[0]
          const key = `${record.date}:${record.rep.toLocaleLowerCase()}`
          if (seenAttendanceRows.has(key)) {
            issues.push({ row: number, message: `${sheet.name}: duplicate agent and date attendance row in this sheet` })
            continue
          }
          seenAttendanceRows.add(key)
          attendanceRows.push(record)
        }
      }
      continue
    }

    if (layout !== 'performance-template') {
      const explanation = issueForUnmappedSheet(layout)
      if (sourceRowNumbers.length && explanation) issues.push({ row: headerRowNumber, message: `${sheet.name}: ${explanation}` })
      continue
    }

    const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index)
    if (duplicates.length) {
      issues.push({ row: headerRowNumber, message: `${sheet.name}: duplicate column name "${visibleHeaders[headers.indexOf(duplicates[0])] ?? duplicates[0]}".` })
      continue
    }

    const columns = {
      period: headerIndex(headers, 'period') + 1,
      rep: headerIndex(headers, 'rep') + 1,
      kpi: headerIndex(headers, 'kpi') + 1,
      target: headerIndex(headers, 'target') + 1,
      actual: headerIndex(headers, 'actual') + 1,
      note: headerIndex(headers, 'note') + 1
    }

    for (const number of sourceRowNumbers) {
      const sourceRow = sheet.getRow(number)
      const candidate = {
        period: normalizeReportingPeriod(valueAsText(sourceRow.getCell(columns.period).value)),
        rep: valueAsText(sourceRow.getCell(columns.rep).value),
        code: valueAsText(sourceRow.getCell(columns.kpi).value),
        target: valueAsNumber(sourceRow.getCell(columns.target).value),
        actual: valueAsNumber(sourceRow.getCell(columns.actual).value),
        note: columns.note > 0 ? valueAsText(sourceRow.getCell(columns.note).value) : ''
      }
      const hasValues = [candidate.period, candidate.rep, candidate.code, candidate.target, candidate.actual, candidate.note]
        .some((value) => value !== '' && value !== null)
      if (!hasValues) continue

      const validation = validateImportRows([candidate], knownCodes)
      if (validation.issues.length) {
        issues.push({ row: number, message: `${sheet.name}: ${validation.issues[0].message}` })
        continue
      }
      const record = validation.rows[0]
      const key = rowKey(record)
      if (seen.has(key)) {
        issues.push({ row: number, message: `${sheet.name}: duplicate rep, KPI, and period across workbook sheets` })
        continue
      }
      seen.add(key)
      rows.push(record)
    }
  }

  return { rows, campaignRows, attendanceRows, issues, sheets }
}
