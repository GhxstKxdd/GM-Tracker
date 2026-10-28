import { Check, Eraser, Save } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import type { KpiSummary, RepScorecard } from '../../../shared/models'
import { formatMetric } from '../components/MetricCard'

function ScorecardRow({ metric, rep, onSave }: { metric: KpiSummary; rep: string; onSave: (rep: string, code: string, target: number, actual: number, note: string) => Promise<boolean> }) {
  const [target, setTarget] = useState(metric.target?.toString() ?? '')
  const [actual, setActual] = useState(metric.actual?.toString() ?? '')
  const [note, setNote] = useState(metric.note)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTarget(metric.target?.toString() ?? '')
    setActual(metric.actual?.toString() ?? '')
    setNote(metric.note)
    setSaved(false)
  }, [metric.actual, metric.note, metric.target])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    const success = await onSave(rep, metric.code, Number(target), Number(actual), note)
    setSaving(false)
    if (success) {
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1600)
    }
  }

  return (
    <form className="scorecard-row" onSubmit={submit}>
      <div className="scorecard-kpi"><strong>{metric.name}</strong><span>{metric.description}</span></div>
      <div className="scorecard-entry"><label className="sr-only" htmlFor={`${rep}-${metric.code}-target`}>{metric.name} target</label><input id={`${rep}-${metric.code}-target`} type="number" step="any" required value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Target" /></div>
      <div className="scorecard-entry"><label className="sr-only" htmlFor={`${rep}-${metric.code}-actual`}>{metric.name} actual</label><input id={`${rep}-${metric.code}-actual`} type="number" step="any" required value={actual} onChange={(event) => setActual(event.target.value)} placeholder="Actual" /></div>
      <div className="scorecard-result">
        {metric.achievement === null ? <span className="status-label neutral">Not entered</span> : (
          <><span className={`status-label ${metric.status}`}>{metric.achievement.toFixed(0)}%</span><span className="scorecard-actual">{formatMetric(metric.actual, metric.unit)} actual</span></>
        )}
      </div>
      <div className="scorecard-note"><label className="sr-only" htmlFor={`${rep}-${metric.code}-note`}>{metric.name} note</label><input id={`${rep}-${metric.code}-note`} type="text" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="KPI note (optional)" /></div>
      <button className={`icon-button save-button ${saved ? 'saved' : ''}`} type="submit" disabled={saving} aria-label={`Save ${metric.name}`} title={saved ? 'Saved' : 'Save'}>{saved ? <Check size={17} /> : <Save size={17} />}</button>
    </form>
  )
}

function SignaturePad({ onChange }: { onChange: (signature: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }
  }
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    drawing.current = true
    canvas.setPointerCapture(event.pointerId)
    const p = point(event)
    canvas.getContext('2d')!.beginPath()
    canvas.getContext('2d')!.moveTo(p.x, p.y)
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const context = canvasRef.current!.getContext('2d')!
    const p = point(event)
    context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = '#235c4d'
    context.lineTo(p.x, p.y); context.stroke()
  }
  const stop = () => {
    if (!drawing.current) return
    drawing.current = false
    onChange(canvasRef.current?.toDataURL('image/png') ?? '')
  }
  const clear = () => {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    onChange('')
  }
  return <div className="signature-pad-wrap"><canvas ref={canvasRef} className="signature-pad" width={560} height={150} aria-label="Draw your signature" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} /><div className="signature-pad-actions"><span>Sign above with your mouse or trackpad</span><button className="text-button" type="button" onClick={clear}><Eraser size={13} /> Clear</button></div></div>
}

function AttendanceValue({ label, value }: { label: string; value: number }) {
  return <div className="attendance-value"><span>{label}</span><strong>{value}</strong></div>
}

export function ScorecardPage({
  scorecards,
  period,
  onSave,
  onSaveFeedback,
  onAcknowledge,
}: {
  scorecards: RepScorecard[]
  period: string
  onSave: (rep: string, code: string, target: number, actual: number, note: string) => Promise<boolean>
  onSaveFeedback: (repId: string, managerFeedback: string, agentFeedback: string) => Promise<boolean>
  onAcknowledge: (repId: string, signatureData: string) => Promise<boolean>
}) {
  const [repId, setRepId] = useState(scorecards[0]?.repId ?? '')
  const [tab, setTab] = useState<'performance' | 'campaignAttendance' | 'feedback'>('performance')
  const [managerFeedback, setManagerFeedback] = useState('')
  const [agentFeedback, setAgentFeedback] = useState('')
  const [signatureData, setSignatureData] = useState('')
  const [feedbackSaving, setFeedbackSaving] = useState(false)
  const [signing, setSigning] = useState(false)
  const selected = scorecards.find((scorecard) => scorecard.repId === repId)
  const complete = Boolean(selected?.campaigns.length && selected.attendance.daysRecorded)

  useEffect(() => {
    if (!scorecards.some((scorecard) => scorecard.repId === repId)) setRepId(scorecards[0]?.repId ?? '')
  }, [repId, scorecards])

  useEffect(() => {
    setManagerFeedback(selected?.managerFeedback ?? '')
    setAgentFeedback(selected?.agentFeedback ?? '')
    setSignatureData('')
  }, [selected?.repId, selected?.managerFeedback, selected?.agentFeedback, selected?.signedAt, period])

  const saveFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    setFeedbackSaving(true)
    await onSaveFeedback(selected.repId, managerFeedback, agentFeedback)
    setFeedbackSaving(false)
  }

  const submitAcknowledgement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || !signatureData) return
    setSigning(true)
    const saved = await onAcknowledge(selected.repId, signatureData)
    setSigning(false)
    if (saved) setSignatureData('')
  }

  return (
    <div className="page-stack">
      <section className="page-intro"><div className="eyebrow">INDIVIDUAL MONTHLY REVIEW · {period}</div><h2>Agent scorecards</h2><p>Choose one agent to review their targets, campaign results, attendance, feedback, and acknowledgment.</p></section>
      {scorecards.length ? <>
        <nav className="agent-tabs" aria-label="Agent scorecards">
          {scorecards.map((scorecard) => <button key={scorecard.repId} className={`agent-tab ${scorecard.repId === repId ? 'selected' : ''}`} onClick={() => setRepId(scorecard.repId)} type="button">{scorecard.repName}</button>)}
        </nav>
        {selected && <>
          <section className="selected-agent-heading"><div><div className="eyebrow">MONTHLY SCORECARD</div><h3>{selected.repName}</h3><span>{period}</span></div><span className={`status-label ${selected.signedAt ? 'on-track' : 'neutral'}`}>{selected.signedAt ? 'Acknowledged' : 'Awaiting acknowledgment'}</span></section>
          <nav className="review-tabs" aria-label={`${selected.repName} review sections`}>
            <button className={tab === 'performance' ? 'selected' : ''} onClick={() => setTab('performance')} type="button">Performance</button>
            <button className={tab === 'campaignAttendance' ? 'selected' : ''} onClick={() => setTab('campaignAttendance')} type="button">Campaign & attendance</button>
            <button className={tab === 'feedback' ? 'selected' : ''} onClick={() => setTab('feedback')} type="button">Feedback & sign-off</button>
          </nav>

          {tab === 'performance' && <section className="panel scorecard-panel">
            <div className="scorecard-table-head"><span>KPI</span><span>Target</span><span>Actual</span><span>Achievement</span><span>Note</span><span /></div>
            {selected.kpis.map((metric) => <ScorecardRow key={metric.code} metric={metric} rep={selected.repName} onSave={onSave} />)}
            <div className="scorecard-footnote">Conversion rate is calculated from the agent’s deals closed divided by calls made.</div>
          </section>}

          {tab === 'campaignAttendance' && <div className="page-stack campaign-attendance-stack">
            <section className="panel campaign-summary-panel">
              <div className="panel-heading"><div><div className="eyebrow">LEADS BY CAMPAIGN</div><h3>{selected.repName} · {period}</h3></div></div>
              {selected.campaigns.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Campaign</th><th>Days</th><th>Lead target</th><th>Leads made</th><th>Target met</th></tr></thead><tbody>
                {selected.campaigns.map((campaign) => <tr key={campaign.campaign}><td><strong>{campaign.campaign}</strong></td><td>{campaign.daysTracked}</td><td>{formatMetric(campaign.target, 'count')}</td><td>{formatMetric(campaign.actual, 'count')}</td><td>{campaign.achievement === null ? '—' : <span className={`status-label ${campaign.achievement >= 100 ? 'on-track' : campaign.achievement >= 80 ? 'watch' : 'behind'}`}>{campaign.achievement.toFixed(0)}%</span>}</td></tr>)}
              </tbody></table></div> : <div className="data-empty">No campaign results imported for this agent and month.</div>}
            </section>
            <section className="panel attendance-panel">
              <div className="panel-heading"><div><div className="eyebrow">MONTHLY ATTENDANCE</div><h3>Attendance record</h3></div><span className="attendance-rate">{selected.attendance.attendanceRate === null ? '—' : `${selected.attendance.attendanceRate.toFixed(1)}%`}<small>attendance</small></span></div>
              <div className="attendance-summary-grid">
                <AttendanceValue label="Present" value={selected.attendance.presentDays} />
                <AttendanceValue label="Absent" value={selected.attendance.absentDays} />
                <AttendanceValue label="Sick" value={selected.attendance.sickDays} />
                <AttendanceValue label="Leave" value={selected.attendance.leaveDays} />
                <AttendanceValue label="Off" value={selected.attendance.offDays} />
                <AttendanceValue label="Scheduled days" value={selected.attendance.scheduledDays} />
              </div>
              {!selected.attendance.daysRecorded && <div className="data-empty">No attendance rows imported for this agent and month.</div>}
              <p className="attendance-method">Attendance rate = present days ÷ scheduled days. Leave and off days are excluded from scheduled days.</p>
            </section>
          </div>}

          {tab === 'feedback' && <div className="review-feedback-grid">
            <form className="panel review-feedback-panel" onSubmit={(event) => void saveFeedback(event)}>
              <div className="panel-heading"><div><div className="eyebrow">MONTHLY CONVERSATION</div><h3>Feedback</h3></div></div>
              <label className="form-field"><span>Manager feedback</span><textarea rows={5} maxLength={5000} value={managerFeedback} onChange={(event) => setManagerFeedback(event.target.value)} placeholder="Record the review discussion, strengths, and areas to improve." /></label>
              <label className="form-field"><span>Agent feedback</span><textarea rows={4} maxLength={5000} value={agentFeedback} onChange={(event) => setAgentFeedback(event.target.value)} placeholder="Give the agent space to add their comments." /></label>
              <div className="form-actions"><button className="button button-primary" type="submit" disabled={feedbackSaving}>{feedbackSaving ? 'Saving…' : 'Save feedback'}</button></div>
            </form>
            <section className="panel acknowledgment-panel">
              <div className="panel-heading"><div><div className="eyebrow">AGENT REVIEW</div><h3>Acknowledge this month’s review</h3></div></div>
              {selected.signedAt && <div className="acknowledgment-signed"><span className="status-label on-track">Signed acknowledgment</span><strong>{selected.signedBy}</strong>{selected.signatureData && <img className="saved-signature" src={selected.signatureData} alt={`Signature from ${selected.signedBy}`} />}<span>{new Date(selected.signedAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>}
              <form className="identity-sign-form" onSubmit={(event) => void submitAcknowledgement(event)}>
                <div className="eyebrow">MONTHLY SIGN-OFF</div>
                <p className="acknowledgment-copy">The agent confirms they have reviewed their KPI, campaign, and attendance figures. Draw a signature below to acknowledge this month’s review.</p>
                <SignaturePad key={`${selected.repId}-${period}`} onChange={setSignatureData} />
                <button className="button button-primary acknowledgment-button" type="submit" disabled={signing || !complete || !signatureData}>{signing ? 'Saving…' : selected.signedAt ? 'Save new signature' : 'Sign and acknowledge'}</button>
                {!complete && <p className="acknowledgment-help">Import this agent’s campaign results and attendance before signing.</p>}
              </form>
              <p className="signature-limit">The signature is saved with this review on this computer. It records acknowledgment and does not independently verify who drew it.</p>
            </section>
          </div>}
        </>}
      </> : <section className="panel empty-state"><strong>No sales reps yet</strong><span>Import the sample workbook or load the sample team to create individual scorecards.</span></section>}
    </div>
  )
}
