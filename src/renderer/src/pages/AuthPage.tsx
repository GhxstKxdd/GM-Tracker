import { BarChart3, KeyRound, ShieldCheck, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { GmRecoveryInput, InitialGmInput, LoginInput } from '../../../shared/models'

export function AuthPage({
  initialized,
  onLogin,
  onSetup,
  onRecover
}: {
  initialized: boolean
  onLogin: (input: LoginInput) => Promise<void>
  onSetup: (input: InitialGmInput) => Promise<void>
  onRecover: (input: GmRecoveryInput) => Promise<void>
}) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [recoveryUsername, setRecoveryUsername] = useState('')
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [recoveryConfirm, setRecoveryConfirm] = useState('')
  const [success, setSuccess] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    if (recoveryMode) {
      if (recoveryPassword !== recoveryConfirm) {
        setError('The passwords do not match.')
        return
      }
      setBusy(true)
      try {
        await onRecover({ username: recoveryUsername, password: recoveryPassword })
        setUsername(recoveryUsername)
        setPassword('')
        setRecoveryPassword('')
        setRecoveryConfirm('')
        setRecoveryMode(false)
        setSuccess('GM login reset. Sign in with the new username and password.')
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not recover the GM login.')
      } finally {
        setBusy(false)
      }
      return
    }
    if (!initialized && password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    try {
      if (initialized) await onLogin({ username, password })
      else await onSetup({ username, displayName, password })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand"><div className="brand-mark"><BarChart3 size={21} strokeWidth={2.5} /></div><div><div className="brand-name">Performance Tracker</div><div className="brand-subtitle">B2B OUTBOUND REVIEWS</div></div></div>
        <div className="auth-icon">{initialized ? <KeyRound size={21} /> : <ShieldCheck size={21} />}</div>
        <div className="eyebrow">{recoveryMode ? 'LOCAL GM RECOVERY' : initialized ? 'SECURE SIGN IN' : 'FIRST-TIME SETUP'}</div>
        <h1>{recoveryMode ? 'Reset the GM login' : initialized ? 'Welcome back' : 'Create the GM account'}</h1>
        <p className="auth-intro">{recoveryMode ? 'Set a new GM username and password for this computer. Your performance data will stay in place.' : initialized ? 'Sign in to open the team performance workspace.' : 'Set up the first account. This account manages access for the GM and team leaders.'}</p>

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {!initialized && <>
            <label>GM display name<input autoComplete="name" autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} maxLength={100} placeholder="General Manager" /></label>
            <label>GM username<div className="auth-input-wrap"><UserRound size={16} /><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" title="Use 3–32 letters, numbers, dots, dashes, or underscores." placeholder="gm.manager" /></div></label>
          </>}
          {recoveryMode ? <>
            <label>New GM username<div className="auth-input-wrap"><UserRound size={16} /><input autoComplete="username" autoFocus value={recoveryUsername} onChange={(event) => setRecoveryUsername(event.target.value)} required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" placeholder="gm.manager" /></div></label>
            <label>New password<div className="auth-input-wrap"><KeyRound size={16} /><input type="password" autoComplete="new-password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} required minLength={12} maxLength={128} placeholder="At least 12 characters" /></div></label>
            <label>Confirm new password<div className="auth-input-wrap"><KeyRound size={16} /><input type="password" autoComplete="new-password" value={recoveryConfirm} onChange={(event) => setRecoveryConfirm(event.target.value)} required minLength={12} maxLength={128} placeholder="Enter it again" /></div></label>
            <p className="recovery-warning">Anyone with access to this computer can use local recovery. Keep your Windows account protected.</p>
          </> : <>
            {initialized && <label>Username<div className="auth-input-wrap"><UserRound size={16} /><input autoComplete="username" autoFocus value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" placeholder="gm.manager" /></div></label>}
            <label>Password<div className="auth-input-wrap"><KeyRound size={16} /><input type="password" autoComplete={initialized ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={128} placeholder="At least 12 characters" /></div></label>
            {!initialized && <label>Confirm password<div className="auth-input-wrap"><KeyRound size={16} /><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={12} maxLength={128} placeholder="Enter it again" /></div></label>}
          </>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          {success && <div className="auth-success" role="status">{success}</div>}
          <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? 'Please wait…' : recoveryMode ? 'Reset GM login' : initialized ? 'Sign in' : 'Create GM account'}</button>
        </form>
        {initialized && !recoveryMode && <div className="login-recovery"><button className="text-button" type="button" onClick={() => setShowRecovery((value) => !value)}>Forgot username or password?</button>{showRecovery && <p role="status">Team Leaders can ask the GM to look up a username or reset a password. For a forgotten GM login, use <button className="text-button" type="button" onClick={() => { setRecoveryMode(true); setShowRecovery(false); setError(null); setSuccess(null) }}>Recover GM login on this computer</button>.</p>}</div>}
        {recoveryMode && <button className="text-button recovery-cancel" type="button" onClick={() => { setRecoveryMode(false); setError(null) }}>Back to sign in</button>}
        <div className="auth-security-note"><ShieldCheck size={15} /><span>Passwords are stored as salted hashes. The app asks you to sign in again after it closes.</span></div>
      </section>
    </main>
  )
}
