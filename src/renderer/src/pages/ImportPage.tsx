import { AlertCircle, CheckCircle2, FileSpreadsheet, FileUp, RotateCcw, Upload } from 'lucide-react'
import { useState } from 'react'
import type { FileImportPreview, ImportColumn, ImportDataset, ImportSheetMapping } from '../../../shared/models'

const datasetOptions: { value: ImportDataset; label: string }[] = [
  { value: 'monthly-kpis', label: 'Monthly KPI totals' },
  { value: 'campaign-results', label: 'Campaign results' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'skip', label: 'Skip this sheet' }
]

const fieldsByDataset: Record<Exclude<ImportDataset, 'skip'>, { field: ImportColumn; label: string; required?: boolean }[]> = {
  'monthly-kpis': [
    { field: 'period', label: 'Reporting month', required: true }, { field: 'rep', label: 'Agent name', required: true },
    { field: 'kpi', label: 'KPI code', required: true }, { field: 'target', label: 'Target', required: true },
    { field: 'actual', label: 'Actual', required: true }, { field: 'note', label: 'Note' }
  ],
  'campaign-results': [
    { field: 'date', label: 'Date', required: true }, { field: 'rep', label: 'Agent name', required: true },
    { field: 'campaign', label: 'Campaign', required: true }, { field: 'target', label: 'Target', required: true },
    { field: 'actual', label: 'Actual', required: true }
  ],
  attendance: [
    { field: 'date', label: 'Date', required: true }, { field: 'rep', label: 'Agent name', required: true },
    { field: 'status', label: 'Attendance status', required: true }
  ]
}

const layoutLabel: Record<string, string> = {
  'performance-template': 'Monthly KPI totals',
  'campaign-activity': 'Daily campaign results',
  'lead-activity': 'Lead activity needs target and actual',
  'qa-review': 'QA review activity',
  attendance: 'Daily attendance',
  'contact-list': 'Contact list',
  unrecognized: 'Needs mapping'
}

export function ImportPage({ onImported }: { onImported: () => void }) {
  const [preview, setPreview] = useState<FileImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [mappings, setMappings] = useState<Record<string, ImportSheetMapping>>({})

  const chooseFile = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await window.performanceTracker.previewImportFile()
      if (result) {
        setPreview(result)
        setMappings(Object.fromEntries(result.sheets.map((sheet) => [sheet.mappingId, {
          mappingId: sheet.mappingId, dataset: sheet.suggestedDataset, columns: sheet.suggestedColumns
        }])))
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to read this performance data file.')
    } finally {
      setBusy(false)
    }
  }

  const previewMapped = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await window.performanceTracker.previewImportFileWithMapping({
        sessionId: preview.sessionId,
        mappings: Object.values(mappings)
      })
      setPreview(result)
      setMessage('Column mapping applied. Review the preview below before importing.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not apply the column mapping.')
    } finally {
      setBusy(false)
    }
  }

  const updateDataset = (mappingId: string, dataset: ImportDataset) => {
    setMappings((current) => ({
      ...current,
      [mappingId]: { ...(current[mappingId] ?? { mappingId, columns: {} }), dataset }
    }))
  }

  const updateColumn = (mappingId: string, field: ImportColumn, rawIndex: string) => {
    setMappings((current) => {
      const existing = current[mappingId]
      if (!existing) return current
      const columns = { ...existing.columns }
      if (rawIndex === '') delete columns[field]
      else columns[field] = Number(rawIndex)
      return { ...current, [mappingId]: { ...existing, columns } }
    })
  }

  const saveSample = async () => {
    setBusy(true)
    setError('')
    try {
      const saved = await window.performanceTracker.saveSampleTemplate()
      if (saved) setMessage('Sample workbook saved. Open it, replace the sample rows with your agent data, then import the workbook here.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the sample workbook.')
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await window.performanceTracker.importRows({
        rows: preview.rows,
        campaignRows: preview.campaignRows,
        attendanceRows: preview.attendanceRows
      })
      if (result.issues.length) {
        setError(result.issues.map((issue) => `Row ${issue.row}: ${issue.message}`).join('\n'))
      } else {
        setMessage(`Imported ${result.campaignImported} campaign result${result.campaignImported === 1 ? '' : 's'}, ${result.attendanceImported} attendance row${result.attendanceImported === 1 ? '' : 's'}, and ${result.imported} monthly KPI row${result.imported === 1 ? '' : 's'}.`)
        setPreview(null)
        onImported()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  const hasRows = Boolean(preview && (preview.rows.length || preview.campaignRows.length || preview.attendanceRows.length))
  const totalRows = preview ? preview.rows.length + preview.campaignRows.length + preview.attendanceRows.length : 0

  return (
    <div className="page-stack">
      <section className="page-intro"><div className="eyebrow">MONTHLY REVIEW DATA</div><h2>Import team performance</h2><p>Combine monthly KPI totals, campaign results, and attendance sheets in one preview before they update agent scorecards.</p></section>

      <section className="panel import-guide">
        <div className="import-illustration"><FileSpreadsheet size={30} strokeWidth={1.7} /></div>
        <div className="import-guide-copy"><div className="eyebrow">SUPPORTED FORMATS · XLSX + CSV</div><h3>Bring your monthly data together</h3><p>Import one workbook with multiple tabs or select several files at once. Daily campaign results and attendance are combined by agent and date.</p></div>
        <button className="button button-primary" disabled={busy} onClick={() => void chooseFile()} type="button"><FileUp size={16} />{busy ? 'Reading…' : 'Choose source files'}</button>
      </section>

      <div className="import-columns">
        <section className="panel import-format-panel">
          <div className="panel-heading"><div><div className="eyebrow">SAMPLE WORKBOOK</div><h3>Start with this simple layout</h3></div><button className="text-button" disabled={busy} onClick={() => void saveSample()} type="button">Save sample workbook</button></div>
          <div className="format-list">
            <div><strong>Campaign Results</strong><span>Agent name · Date · Campaign · Target · Actual</span><i>Daily</i></div>
            <div><strong>Attendance</strong><span>Agent name · Date · Status</span><i>Daily</i></div>
            <div><strong>Monthly KPIs</strong><span>Optional: Period · Rep · KPI code · Target · Actual</span><i>Optional</i></div>
          </div>
          <div className="info-note"><AlertCircle size={16} /><span>Use one row per agent, date, and campaign. Attendance is one row per agent per date. Import supports Present, Absent, Leave, Sick, and Off statuses.</span></div>
        </section>

        <section className="panel import-safety-panel">
          <div className="eyebrow">WHAT THE APP BUILDS</div>
          <h3>One review per agent</h3>
          <div className="check-list">
            <div><CheckCircle2 size={17} /><span>Monthly leads target versus actual for each campaign</span></div>
            <div><CheckCircle2 size={17} /><span>Present, absent, sick, leave, and off day counts</span></div>
            <div><CheckCircle2 size={17} /><span>Attendance rate based on scheduled days</span></div>
            <div><CheckCircle2 size={17} /><span>Dates, duplicates, campaigns, and numbers checked before saving</span></div>
          </div>
          <div className="info-note"><AlertCircle size={16} /><span>Importing the same agent, date, and campaign updates that row. Attendance updates by agent and date.</span></div>
        </section>
      </div>

      {message && <div className="inline-notice success"><CheckCircle2 size={17} />{message}</div>}
      {error && <div className="inline-notice error"><AlertCircle size={17} /><span>{error}</span></div>}

      {preview && (
        <section className="panel preview-panel">
          <div className="panel-heading"><div><div className="eyebrow">IMPORT PREVIEW · {preview.fileNames.length} FILE{preview.fileNames.length === 1 ? '' : 'S'}</div><h3>{preview.fileNames.join(', ')}</h3></div><button className="button button-outline" onClick={() => setPreview(null)} type="button"><RotateCcw size={15} /> Clear</button></div>
          <div className="preview-summary"><span className="preview-valid"><CheckCircle2 size={15} />{totalRows} valid row{totalRows === 1 ? '' : 's'}</span><span className={preview.issues.length ? 'preview-invalid' : 'preview-valid'}><AlertCircle size={15} />{preview.issues.length} issue{preview.issues.length === 1 ? '' : 's'}</span></div>
          {preview.sheets.length > 0 && <div className="source-layout-list" aria-label="Detected worksheet layouts">{preview.sheets.map((sheet, index) => <div className="source-layout-item" key={`${sheet.mappingId}-${index}`}><div className="source-layout-top"><strong>{sheet.fileName} · {sheet.sheetName}</strong><span>{layoutLabel[sheet.layout] ?? sheet.layout}</span></div><p>{sheet.dataRows.toLocaleString('en-ZA')} non-empty rows · {sheet.message}</p>{sheet.headers.length > 0 && <small>Columns: {sheet.headers.join(', ')}</small>}{sheet.campaignCount > 0 && <small>Campaigns detected ({sheet.campaignCount}): {sheet.campaigns.join(', ')}{sheet.campaignCount > sheet.campaigns.length ? ', …' : ''}</small>}</div>)}</div>}
          {preview.sheets.length > 0 && <section className="column-mapping-panel">
            <div className="panel-heading"><div><div className="eyebrow">COLUMN MAPPING</div><h3>Match your spreadsheet to the tracker</h3></div></div>
            <p className="mapping-intro">Choose what each sheet contains, then match its columns to the tracker fields. Suggested matches are filled in when the headings look familiar.</p>
            <div className="column-mapping-list">{preview.sheets.map((sheet) => {
              const mapping = mappings[sheet.mappingId] ?? { mappingId: sheet.mappingId, dataset: sheet.suggestedDataset, columns: sheet.suggestedColumns }
              const fields = mapping.dataset === 'skip' ? [] : fieldsByDataset[mapping.dataset]
              return <div className="column-mapping-card" key={sheet.mappingId}>
                <div className="source-layout-top"><strong>{sheet.fileName} · {sheet.sheetName}</strong><span>{sheet.dataRows.toLocaleString('en-ZA')} rows</span></div>
                <label className="form-field mapping-dataset">This sheet contains
                  <select value={mapping.dataset} onChange={(event) => updateDataset(sheet.mappingId, event.target.value as ImportDataset)}>
                    {datasetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {mapping.dataset !== 'skip' && <div className="column-mapping-fields">{fields.map(({ field, label, required }) => <label className="form-field" key={field}>{label}{required ? ' *' : ''}
                  <select value={mapping.columns[field] ?? ''} onChange={(event) => updateColumn(sheet.mappingId, field, event.target.value)}>
                    <option value="">Choose a column…</option>
                    {sheet.headers.map((header, headerIndex) => <option key={`${header}-${headerIndex}`} value={headerIndex}>{header || `Column ${headerIndex + 1}`}</option>)}
                  </select>
                </label>)}</div>}
              </div>
            })}</div>
            <button className="button button-outline" disabled={busy} onClick={() => void previewMapped()} type="button">{busy ? 'Applying mapping…' : 'Apply mapping & preview'}</button>
            <span className="mapping-required-note">Fields marked * are needed for that type of data. Choose “Skip this sheet” for tabs you do not want to import.</span>
          </section>}
          {preview.campaignRows.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Agent</th><th>Campaign</th><th>Target</th><th>Actual</th></tr></thead><tbody>{preview.campaignRows.slice(0, 8).map((row, index) => <tr key={`${row.date}-${row.rep}-${row.campaign}-${index}`}><td>{row.date}</td><td>{row.rep}</td><td>{row.campaign}</td><td>{row.target.toLocaleString('en-ZA')}</td><td>{row.actual.toLocaleString('en-ZA')}</td></tr>)}</tbody></table>{preview.campaignRows.length > 8 && <div className="table-more">Showing 8 of {preview.campaignRows.length} campaign rows.</div>}</div>}
          {preview.attendanceRows.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Agent</th><th>Attendance</th></tr></thead><tbody>{preview.attendanceRows.slice(0, 8).map((row, index) => <tr key={`${row.date}-${row.rep}-${index}`}><td>{row.date}</td><td>{row.rep}</td><td>{row.status}</td></tr>)}</tbody></table>{preview.attendanceRows.length > 8 && <div className="table-more">Showing 8 of {preview.attendanceRows.length} attendance rows.</div>}</div>}
          {preview.rows.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th>Month</th><th>Rep</th><th>KPI</th><th>Target</th><th>Actual</th><th>Note</th></tr></thead><tbody>{preview.rows.slice(0, 8).map((row, index) => <tr key={`${row.period}-${row.rep}-${row.code}-${index}`}><td>{row.period}</td><td>{row.rep}</td><td>{row.code}</td><td>{row.target.toLocaleString('en-ZA')}</td><td>{row.actual.toLocaleString('en-ZA')}</td><td>{row.note || '—'}</td></tr>)}</tbody></table>{preview.rows.length > 8 && <div className="table-more">Showing 8 of {preview.rows.length} monthly KPI rows.</div>}</div>}
          {preview.issues.length > 0 && <div className="import-issues">{preview.issues.slice(0, 20).map((issue, index) => <div key={`${issue.row}-${index}`}><strong>Row {issue.row}</strong><span>{issue.message}</span></div>)}{preview.issues.length > 20 && <span>And {preview.issues.length - 20} more issue(s).</span>}</div>}
          {hasRows && <div className="form-actions"><button className="button button-primary" disabled={busy || preview.issues.length > 0} onClick={() => void commit()} type="button"><Upload size={15} />{busy ? 'Importing…' : `Import ${totalRows} rows`}</button></div>}
        </section>
      )}
    </div>
  )
}
