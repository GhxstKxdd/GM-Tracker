import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { combinePerformanceImports, parsePerformanceCsv, validateImportRows } from './csv-import'

const codes = ['CALLS_MADE', 'DEALS_CLOSED', 'CONVERSION_RATE']

describe('sales CSV import validation', () => {
  it('parses rep-specific rows, trims values, and accepts comma-grouped numbers', () => {
    const result = parsePerformanceCsv(
      'period,rep,kpi_code,target,actual,notes\n2026-01, Aisha Patel ,calls_made,"1,200,000","1,250,000",January\n',
      codes
    )
    expect(result.issues).toEqual([])
    expect(result.rows[0]).toMatchObject({ rep: 'Aisha Patel', period: '2026-01', code: 'CALLS_MADE', target: 1200000, actual: 1250000 })
  })

  it('parses daily campaign targets and attendance from simple CSV sheets', () => {
    const campaigns = parsePerformanceCsv('Agent Name,Date,Campaign,Target,Actual\nAisha Patel,2026-10-01,Campaign A,12,10\n', codes)
    const attendance = parsePerformanceCsv('Agent Name,Date,Status\nAisha Patel,2026-10-01,Present\n', codes)
    expect(campaigns.issues).toEqual([])
    expect(campaigns.campaignRows).toEqual([{ rep: 'Aisha Patel', date: '2026-10-01', campaign: 'Campaign A', target: 12, actual: 10 }])
    expect(attendance.issues).toEqual([])
    expect(attendance.attendanceRows).toEqual([{ rep: 'Aisha Patel', date: '2026-10-01', status: 'present' }])
  })

  it('reports invalid periods, unknown KPIs, missing reps, and duplicate rep/KPI/month pairs', () => {
    const result = parsePerformanceCsv(
      'period,rep,kpi_code,target,actual\n2026-13,Aisha Patel,CALLS_MADE,100,110\n2026-02,Aisha Patel,UNKNOWN,100,110\n2026-02,,CALLS_MADE,100,95\n2026-02,Aisha Patel,CALLS_MADE,100,95\n2026-02,Aisha Patel,CALLS_MADE,100,96\n',
      codes
    )
    expect(result.rows).toHaveLength(1)
    expect(result.issues).toHaveLength(4)
    expect(result.issues[3].message).toContain('duplicate')
  })

  it('requires the rep column', () => {
    const result = parsePerformanceCsv('period,kpi_code,target,actual\n2026-01,CALLS_MADE,100,120\n', codes)
    expect(result.rows).toEqual([])
    expect(result.issues[0].message).toContain('rep')
  })

  it('keeps the downloadable sample file sales-only and valid for import', () => {
    const source = readFileSync('sample-data/sales-performance-sample.csv', 'utf8')
    const result = parsePerformanceCsv(source, codes)
    expect(result.issues).toEqual([])
    expect(result.rows).toHaveLength(15)
    expect(new Set(result.rows.map((row) => row.rep)).size).toBe(5)
    expect(new Set(result.rows.map((row) => row.code))).toEqual(new Set(codes))
  })

  it('combines separate monthly KPI exports by rep and month', () => {
    const calls = parsePerformanceCsv('period,rep,kpi_code,target,actual\n2026-01,Aisha Patel,CALLS_MADE,350,410\n', codes)
    const deals = parsePerformanceCsv('period,rep,kpi_code,target,actual\n2026-01,Aisha Patel,DEALS_CLOSED,40,39\n', codes)
    const combined = combinePerformanceImports([
      { sourceName: 'calls.csv', ...calls },
      { sourceName: 'deals.xlsx', ...deals }
    ], codes)
    expect(combined.issues).toEqual([])
    expect(combined.rows.map((row) => row.code)).toEqual(['CALLS_MADE', 'DEALS_CLOSED'])
    expect(new Set(combined.rows.map((row) => `${row.rep}:${row.period}`)).size).toBe(1)
  })

  it('flags duplicate rep/KPI/month records across selected files with the source name', () => {
    const first = parsePerformanceCsv('period,rep,kpi_code,target,actual\n2026-01,Aisha Patel,CALLS_MADE,350,410\n', codes)
    const second = parsePerformanceCsv('period,rep,kpi_code,target,actual\n2026-01,Aisha Patel,CALLS_MADE,350,420\n', codes)
    const combined = combinePerformanceImports([
      { sourceName: 'calls-a.csv', ...first },
      { sourceName: 'calls-b.csv', ...second }
    ], codes)
    expect(combined.rows).toHaveLength(1)
    expect(combined.issues).toEqual([{ row: 2, message: 'calls-b.csv · duplicate rep, KPI, and period in this import' }])
  })

  it('revalidates rows received by the database boundary', () => {
    const result = validateImportRows([
      { rep: 'Daniel Mokoena', period: '2026-01', code: 'DEALS_CLOSED', target: 100, actual: 120 },
      { rep: '', period: '2026-13', code: 'DEALS_CLOSED', target: 100, actual: 120 }
    ], codes)
    expect(result.rows).toHaveLength(1)
    expect(result.issues).toHaveLength(1)
  })

  it('rejects inbound-only revenue from the outbound scorecard', () => {
    const result = parsePerformanceCsv('period,rep,kpi_code,target,actual\n2026-01,Aisha Patel,REVENUE,200000,210000\n', codes)
    expect(result.rows).toEqual([])
    expect(result.issues[0].message).toContain('unknown KPI code')
  })
})
