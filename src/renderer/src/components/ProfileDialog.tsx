import { KeyRound, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'

export function ProfileDialog({ onClose, onChange }: { onClose: () => void; onChange: (currentPassword: string, newPassword: string) => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.')
      return
    }
    setBusy(true)
    try { await onChange(currentPassword, newPassword); onClose() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not change the password.') }
    finally { setBusy(false) }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="password-title">
        <div className="dialog-heading"><div className="auth-icon"><KeyRound size={20} /></div><button className="icon-button" aria-label="Close" onClick={onClose} type="button"><X size={16} /></button></div>
        <div className="eyebrow">ACCOUNT SECURITY</div><h2 id="password-title">Change your password</h2><p>Choose a unique password with at least 12 characters.</p>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label>Current password<input type="password" autoComplete="current-password" autoFocus required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <div className="dialog-actions"><button className="button button-outline" onClick={onClose} type="button">Cancel</button><button className="button button-primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Update password'}</button></div>
        </form>
      </section>
    </div>
  )
}
