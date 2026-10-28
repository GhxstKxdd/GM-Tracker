import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalStore } from './local-store'
import { parseXlsxBuffer } from './xlsx-import'

const codes = ['CALLS_MADE', 'DEALS_CLOSED', 'CONVERSION_RATE']

async function createWorkbookBuffer(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Sales')
  rows.forEach((row) => worksheet.addRow(row))
  const data = await workbook.xlsx.writeBuffer()
  return Buffer.from(data as unknown as Uint8Array)
}

describe('sales XLSX import validation', () => {
  it('reads rep, target, and actual values from a worksheet', async () => {
    const buffer = await createWorkbookBuffer([
      ['period', 'rep', 'kpi_code', 'target', 'actual', 'notes'],
      ['2026-01', 'Aisha Patel', 'CALLS_MADE', 1200, 1265, 'January calls']
    ])
    const result = await parseXlsxBuffer(buffer, codes)
    expect(result.issues).toEqual([])
    expect(result.rows).toEqual([{ rep: 'Aisha Patel', period: '2026-01', code: 'CALLS_MADE', target: 1200, actual: 1265, note: 'January calls' }])
  })

  it('maps invalid periods and duplicate rep/KPI/month records to worksheet rows', async () => {
    const buffer = await createWorkbookBuffer([
      ['period', 'rep', 'kpi_code', 'target', 'actual'],
      ['2026-13', 'Aisha Patel', 'CALLS_MADE', 100, 110],
      ['2026-02', 'Aisha Patel', 'CALLS_MADE', 70, 72],
      ['2026-02', 'Aisha Patel', 'CALLS_MADE', 70, 74]
    ])
    const result = await parseXlsxBuffer(buffer, codes)
    expect(result.rows).toHaveLength(1)
    expect(result.issues.map((issue) => issue.row)).toEqual([2, 4])
    expect(result.issues[1].message).toContain('duplicate')
  })

  it('combines matching KPI-template tabs in one workbook', async () => {
    const workbook = new ExcelJS.Workbook()
    const january = workbook.addWorksheet('January')
    january.addRows([
      ['period', 'rep', 'kpi_code', 'target', 'actual'],
      ['2026-01', 'Aisha Patel', 'CALLS_MADE', 350, 410]
    ])
    const february = workbook.addWorksheet('February')
    february.addRows([
      ['Monthly results'],
      ['period', 'rep', 'kpi_code', 'target', 'actual', 'campaign'],
      ['2026-02', 'Aisha Patel', 'DEALS_CLOSED', 20, 25, 'Campaign A']
    ])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array)

    const result = await parseXlsxBuffer(buffer, codes, 'monthly.xlsx')
    expect(result.issues).toEqual([])
    expect(result.rows.map((row) => row.period)).toEqual(['2026-01', '2026-02'])
    expect(result.sheets?.map((sheet) => sheet.layout)).toEqual(['performance-template', 'performance-template'])
  })

  it('imports campaign target and attendance tabs together by agent and date', async () => {
    const workbook = new ExcelJS.Workbook()
    const campaigns = workbook.addWorksheet('Campaign Results')
    campaigns.addRows([
      ['Agent Name', 'Date', 'Campaign', 'Target', 'Actual'],
      ['Aisha Patel', '2026-10-01', 'Campaign A', 12, 10],
      ['Aisha Patel', '2026-10-02', 'Campaign B', 12, 14]
    ])
    const attendance = workbook.addWorksheet('Attendance')
    attendance.addRows([
      ['Agent Name', 'Date', 'Status'],
      ['Aisha Patel', '2026-10-01', 'Present'],
      ['Aisha Patel', '2026-10-02', 'Sick Leave']
    ])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array)

    const result = await parseXlsxBuffer(buffer, codes, 'monthly-review.xlsx')
    expect(result.issues).toEqual([])
    expect(result.campaignRows).toEqual([
      { rep: 'Aisha Patel', date: '2026-10-01', campaign: 'Campaign A', target: 12, actual: 10 },
      { rep: 'Aisha Patel', date: '2026-10-02', campaign: 'Campaign B', target: 12, actual: 14 }
    ])
    expect(result.attendanceRows).toEqual([
      { rep: 'Aisha Patel', date: '2026-10-01', status: 'present' },
      { rep: 'Aisha Patel', date: '2026-10-02', status: 'sick' }
    ])
    expect(result.sheets?.map((sheet) => sheet.layout)).toEqual(['campaign-activity', 'attendance'])
  })

  it('reads the shipped sample workbook with the same import parser', async () => {
    const buffer = readFileSync(join(process.cwd(), 'sample-data', 'outbound-performance-sample.xlsx'))
    const result = await parseXlsxBuffer(buffer, codes, 'outbound-performance-sample.xlsx')
    expect(result.issues).toEqual([])
    expect(result.campaignRows).toHaveLength(15)
    expect(result.attendanceRows).toHaveLength(15)
    expect(result.sheets?.map((sheet) => sheet.layout)).toEqual(['campaign-activity', 'attendance'])
    expect(result.campaignRows?.[0].date).toBe('2026-10-01')

    const store = new LocalStore(':memory:')
    try {
      const imported = store.importRecords({ rows: result.rows, campaignRows: result.campaignRows ?? [], attendanceRows: result.attendanceRows ?? [] })
      expect(imported).toMatchObject({ imported: 0, campaignImported: 15, attendanceImported: 15, issues: [] })
      const aisha = store.getDashboard('2026-10').scorecards.find((card) => card.repName === 'Aisha Patel')
      expect(aisha?.campaigns.find((campaign) => campaign.campaign === 'HPE')).toMatchObject({ target: 24, actual: 23, achievement: 95.83 })
      expect(aisha?.attendance).toMatchObject({ daysRecorded: 5, presentDays: 4, absentDays: 1, attendanceRate: 80 })
      expect(new Set(result.campaignRows?.map((row) => row.campaign))).toEqual(new Set(['HPE', 'Dell', 'Lenovo']))
    } finally {
      store.close()
    }
  })

  it('identifies lead activity and QA tabs without importing their contact rows as KPI data', async () => {
    const workbook = new ExcelJS.Workbook()
    const leads = workbook.addWorksheet('Monthly activity')
    leads.addRows([
      ['DATE LDR MADE SALE', 'LDR NAME', 'CAMPAIGN', 'COMPANY', 'EMAIL'],
      ['2026-01-03', 'Sample Rep', 'Campaign A', 'Sample Company', 'sample@example.test']
    ])
    const qa = workbook.addWorksheet('QA review')
    qa.addRows([
      ['DATE', 'RPC NAME', 'OUTCOME', 'ESL'],
      ['2026-01-04', 'Sample Prospect', 'PASS', 'Sample Rep']
    ])
    const attendance = workbook.addWorksheet('Attendance')
    attendance.addRows([
      ['DATE', 'AGENT', 'STATUS'],
      ['2026-01-05', 'Sample Rep', 'PRESENT']
    ])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array)

    const result = await parseXlsxBuffer(buffer, codes, 'source.xlsx')
    expect(result.rows).toEqual([])
    expect(result.sheets?.map((sheet) => sheet.layout)).toEqual(['lead-activity', 'qa-review', 'attendance'])
    expect(result.attendanceRows).toEqual([{ rep: 'Sample Rep', date: '2026-01-05', status: 'present' }])
    expect(result.sheets?.[0].headers).toContain('CAMPAIGN')
    expect(result.sheets?.[0].campaigns).toEqual(['Campaign A'])
    expect(result.issues).toHaveLength(2)
    expect(result.issues[0].message).toContain('KPI mapping')
    expect(result.issues[1].message).toContain('QA review activity')
  })
})
