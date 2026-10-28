import { LockKeyhole, Plus, RotateCcw, UserPlus, UserRoundX } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { TeamLeaderInput, UserAccountSummary } from '../../../shared/models'

export function UsersPage({
  onList,
  onCreate,
  onResetPassword,
  onDisable,
  onNotice
}: {
  onList: () => Promise<UserAccountSummary[]>
  onCreate: (input: TeamLeaderInput) => Promise<UserAccountSummary>
  onResetPassword: (userId: string, password: string) => Promise<void>
  onDisable: (userId: string) => Promise<void>
  onNotice: (message: string, isError?: boolean) => void
}) {
  const [accounts, setAccounts] = useState<UserAccountSummary[]>([])
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwords, setPasswords] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setAccounts(await onList()) }
    catch (caught) { onNotice(caught instanceof Error ? caught.message : 'Could not load user accounts.', true) }
    finally { setLoading(false) }
  }, [onList, onNotice])

  useEffect(() => { void refresh() }, [refresh])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await onCreate({ displayName, username, password })
      setDisplayName('')
      setUsername('')
      setPassword('')
      onNotice('Team leader account created. Share the initial password privately.')
      await refresh()
    } catch (caught) { onNotice(caught instanceof Error ? caught.message : 'Could not create the account.', true) }
    finally { setBusy(false) }
  }

  const resetPassword = async (userId: string) => {
    const value = passwords[userId] ?? ''
    setBusy(true)
    try {
      await onResetPassword(userId, value)
      setPasswords((current) => ({ ...current, [userId]: '' }))
      onNotice('Team leader password reset. Share the new password privately.')
    } catch (caught) { onNotice(caught instanceof Error ? caught.message : 'Could not reset the password.', true) }
    finally { setBusy(false) }
  }

  const disable = async (account: UserAccountSummary) => {
    if (!window.confirm(`Disable sign-in for ${account.displayName}?`)) return
    setBusy(true)
    try {
      await onDisable(account.id)
      onNotice('Team leader sign-in disabled.')
      await refresh()
    } catch (caught) { onNotice(caught instanceof Error ? caught.message : 'Could not disable this login.', true) }
    finally { setBusy(false) }
  }

  return (
    <div className="page-stack">
      <section className="page-intro"><div className="eyebrow">GM ACCESS CONTROL</div><h2>Manage team leader logins</h2><p>Create, reset, and disable accounts for people who enter or review team performance.</p></section>

      <section className="panel access-guidance"><LockKeyhole size={19} /><div><strong>Account protection</strong><span>Passwords are salted and hashed in the local database. Use a unique password with at least 12 characters and share initial credentials privately.</span></div></section>

      <section className="panel user-create-panel">
        <div className="panel-heading"><div><div className="eyebrow">NEW ACCESS</div><h3>Create team leader login</h3></div><UserPlus size={19} /></div>
        <form className="user-create-form" onSubmit={(event) => void create(event)}>
          <label>Full name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required minLength={2} maxLength={100} placeholder="Team leader name" /></label>
          <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" placeholder="team.lead" /></label>
          <label>Initial password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={12} maxLength={128} placeholder="At least 12 characters" /></label>
          <button className="button button-primary" disabled={busy} type="submit"><Plus size={15} /> Create login</button>
        </form>
      </section>

      <section className="panel users-list-panel">
        <div className="panel-heading"><div><div className="eyebrow">CURRENT ACCOUNTS</div><h3>GM and team leader access</h3></div><button className="icon-button" onClick={() => void refresh()} title="Refresh accounts" type="button"><RotateCcw size={15} /></button></div>
        {loading ? <div className="loading-state">Loading accounts…</div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>
          {accounts.map((account) => <tr key={account.id}>
            <td><strong>{account.displayName}</strong></td>
            <td>{account.username}</td>
            <td>{account.role === 'GM' ? 'General Manager' : 'Team Leader'}</td>
            <td><span className={`status-label ${account.active ? 'on-track' : 'behind'}`}>{account.active ? 'Active' : 'Disabled'}</span></td>
            <td>{new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(account.createdAt))}</td>
            <td>{account.role === 'TEAM_LEADER' && account.active ? <div className="user-row-actions"><input aria-label={`New password for ${account.displayName}`} type="password" autoComplete="new-password" minLength={12} maxLength={128} value={passwords[account.id] ?? ''} onChange={(event) => setPasswords((current) => ({ ...current, [account.id]: event.target.value }))} placeholder="New password" /><button className="icon-button" disabled={busy || (passwords[account.id] ?? '').length < 12} onClick={() => void resetPassword(account.id)} title="Reset password" type="button"><RotateCcw size={14} /></button><button className="icon-button user-disable-button" disabled={busy} onClick={() => void disable(account)} title="Disable login" type="button"><UserRoundX size={15} /></button></div> : '—'}</td>
          </tr>)}
        </tbody></table></div>}
      </section>
    </div>
  )
}
