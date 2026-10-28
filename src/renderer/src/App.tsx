import { CalendarDays, CircleAlert, CircleCheck, KeyRound, LogOut, MapPin } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AuthState, DashboardData, InitialGmInput, LoginInput, TeamLeaderInput } from '../../shared/models'
import { ProfileDialog } from './components/ProfileDialog'
import { Sidebar, type PageId } from './components/Sidebar'
import { AuthPage } from './pages/AuthPage'
import { DashboardPage } from './pages/DashboardPage'
import { ImportPage } from './pages/ImportPage'
import { ReportsPage } from './pages/ReportsPage'
import { ScorecardPage } from './pages/ScorecardPage'
import { UsersPage } from './pages/UsersPage'

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const pageMeta: Record<PageId, { title: string; eyebrow: string }> = {
  overview: { title: 'Overview', eyebrow: 'SALES PERFORMANCE' },
  scorecard: { title: 'Agent scorecards', eyebrow: 'MONTHLY PERFORMANCE' },
  reports: { title: 'Reports', eyebrow: 'MONTH-END REVIEW' },
  import: { title: 'Import', eyebrow: 'SCORECARD DATA' },
  users: { title: 'User access', eyebrow: 'ACCOUNT MANAGEMENT' }
}

export default function App() {
  const [page, setPage] = useState<PageId>('overview')
  const [period, setPeriod] = useState(currentPeriod)
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  function showNotice(kind: 'success' | 'error', text: string): void {
    setNotice({ kind, text })
  }

  useEffect(() => {
    let active = true
    void window.performanceTracker.getAuthState().then((state) => { if (active) setAuthState(state) }).catch((caught) => {
      if (active) showNotice('error', caught instanceof Error ? caught.message : 'Could not check the user login.')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4800)
    return () => window.clearTimeout(timer)
  }, [notice])

  const refresh = useCallback(async () => {
    if (!authState?.user) { setLoading(false); return }
    setLoading(true)
    try {
      setDashboard(await window.performanceTracker.getDashboard(period))
    } catch (caught) {
      showNotice('error', caught instanceof Error ? caught.message : 'Could not load the workspace.')
    } finally {
      setLoading(false)
    }
  }, [authState?.user?.id, period, refreshKey])

  useEffect(() => { void refresh() }, [refresh])

  const reload = () => setRefreshKey((key) => key + 1)

  const setupInitialGm = async (input: InitialGmInput) => {
    const user = await window.performanceTracker.setupInitialGm(input)
    setAuthState({ initialized: true, user })
    setPage('overview')
    reload()
  }

  const login = async (input: LoginInput) => {
    const user = await window.performanceTracker.login(input)
    setAuthState({ initialized: true, user })
    setPage('overview')
    reload()
  }

  const logout = async () => {
    await window.performanceTracker.logout()
    setAuthState({ initialized: true, user: null })
    setDashboard(null)
    setPage('overview')
  }

  const changeMyPassword = async (currentPassword: string, newPassword: string) => {
    try {
      await window.performanceTracker.changeMyPassword(currentPassword, newPassword)
      showNotice('success', 'Your password has been changed.')
    } catch (caught) {
      showNotice('error', caught instanceof Error ? caught.message : 'Could not change your password.')
      throw caught
    }
  }

  const saveRecord = async (rep: string, code: string, target: number, actual: number, note: string) => {
    try {
      await window.performanceTracker.saveRecord({ rep, code, period, target, actual, note })
      showNotice('success', `${code.replaceAll('_', ' ')} saved for ${rep} in ${period}.`)
      reload()
      return true
    } catch (caught) {
      showNotice('error', caught instanceof Error ? caught.message : 'Could not save this KPI.')
      return false
    }
  }

  const saveReviewFeedback = async (repId: string, managerFeedback: string, agentFeedback: string) => {
    try {
      await window.performanceTracker.saveReviewFeedback({ repId, period, managerFeedback, agentFeedback })
      showNotice('success', 'Monthly feedback saved.')
      reload()
      return true
    } catch (caught) {
      showNotice('error', caught instanceof Error ? caught.message : 'Could not save monthly feedback.')
      return false
    }
  }

  const acknowledgeReview = async (repId: string, signatureData: string) => {
    try {
      await window.performanceTracker.acknowledgeReview({ repId, period, signatureData })
      showNotice('success', 'Signature saved and monthly scorecard acknowledged.')
      reload()
      return true
    } catch (caught) {
      showNotice('error', caught instanceof Error ? caught.message : 'Could not record the acknowledgment.')
      return false
    }
  }

  const loadDemo = async () => {
    try {
      const result = await window.performanceTracker.seedDemoData()
      showNotice(result.seeded ? 'success' : 'error', result.message)
      reload()
    } catch (caught) {
      showNotice('error', caught instanceof Error ? caught.message : 'Could not load sample data.')
    }
  }

  const meta = pageMeta[page]
  let pageContent = null
  if (authState?.user && page === 'users' && authState.user.role === 'GM') {
    pageContent = <UsersPage
      onList={() => window.performanceTracker.listUserAccounts()}
      onCreate={(input: TeamLeaderInput) => window.performanceTracker.createTeamLeader(input)}
      onResetPassword={(userId, password) => window.performanceTracker.resetUserPassword(userId, password)}
      onDisable={(userId) => window.performanceTracker.disableUser(userId)}
      onNotice={(message, isError) => showNotice(isError ? 'error' : 'success', message)}
    />
  } else if (dashboard) {
    if (page === 'overview' || page === 'users') pageContent = <DashboardPage dashboard={dashboard} onNavigate={setPage} onLoadDemo={() => void loadDemo()} onRefresh={() => void refresh()} canSeedDemo={authState?.user?.role === 'GM'} />
    else if (page === 'scorecard') pageContent = <ScorecardPage scorecards={dashboard.scorecards} period={period} onSave={saveRecord} onSaveFeedback={saveReviewFeedback} onAcknowledge={acknowledgeReview} />
    else if (page === 'reports') pageContent = <ReportsPage period={period} />
    else if (page === 'import') pageContent = <ImportPage onImported={reload} />
  }

  if (!authState) return <div className="auth-loading">Opening secure workspace…</div>
  if (!authState.user) return <AuthPage initialized={authState.initialized} onLogin={login} onSetup={setupInitialGm} onRecover={(input) => window.performanceTracker.recoverGmLogin(input)} />

  return (
    <div className="app-shell">
      <Sidebar current={page} onNavigate={setPage} user={authState.user} />
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-context"><span className="breadcrumb-root">Workspace</span><span className="breadcrumb-divider">/</span><strong>{meta.title}</strong></div>
          <div className="topbar-controls">
            <div className="prototype-pill"><span className="prototype-pulse" /> SIGNED IN · {authState.user.role === 'GM' ? 'GM' : 'TEAM LEADER'}</div>
            <label className="period-control"><CalendarDays size={15} /><span>Reporting month</span><input aria-label="Reporting month" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
            <button className="account-button" onClick={() => setProfileOpen(true)} type="button"><KeyRound size={14} /><span>{authState.user.displayName}</span></button>
            <button className="account-icon-button" aria-label="Sign out" title="Sign out" onClick={() => void logout()} type="button"><LogOut size={16} /></button>
          </div>
        </header>
        <div className="page-heading"><div><div className="eyebrow">{meta.eyebrow}</div><h1>{meta.title}</h1></div><div className="workspace-location"><MapPin size={15} /> On this computer</div></div>
        <div className="content-scroll">
          {loading && !dashboard ? <div className="loading-state">Opening your workspace…</div> : pageContent}
        </div>
        {notice && <div className={`toast ${notice.kind}`} role="status">{notice.kind === 'success' ? <CircleCheck size={18} /> : <CircleAlert size={18} />}<span>{notice.text}</span><button aria-label="Dismiss" onClick={() => setNotice(null)} type="button">×</button></div>}
      </main>
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} onChange={changeMyPassword} />}
    </div>
  )
}
