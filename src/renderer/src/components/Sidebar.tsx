import {
  BarChart3,
  FileBarChart2,
  Gauge,
  LayoutDashboard,
  Upload,
  UsersRound
} from 'lucide-react'
import type { AuthUser } from '../../../shared/models'

export type PageId = 'overview' | 'scorecard' | 'reports' | 'import' | 'users'

const navigation: { id: PageId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'scorecard', label: 'Agent scorecards', icon: Gauge },
  { id: 'reports', label: 'Monthly reports', icon: FileBarChart2 },
  { id: 'import', label: 'Import performance', icon: Upload }
]

export function Sidebar({ current, onNavigate, user }: { current: PageId; onNavigate: (page: PageId) => void; user: AuthUser }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><BarChart3 size={21} strokeWidth={2.5} /></div>
        <div>
          <div className="brand-name">Performance</div>
          <div className="brand-subtitle">TRACKER</div>
        </div>
      </div>

      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="primary-nav" aria-label="Main navigation">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            className={`nav-item ${current === id ? 'active' : ''}`}
            key={id}
            onClick={() => onNavigate(id)}
            type="button"
          >
            <Icon size={18} strokeWidth={1.9} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {user.role === 'GM' && <>
        <div className="sidebar-section-label sidebar-admin-label">ADMINISTRATION</div>
        <nav className="primary-nav" aria-label="Administration">
          <button className={`nav-item ${current === 'users' ? 'active' : ''}`} onClick={() => onNavigate('users')} type="button"><UsersRound size={18} strokeWidth={1.9} /><span>User access</span></button>
        </nav>
      </>}

      <div className="sidebar-bottom">
        <div className="storage-card">
          <div className="storage-icon"><BarChart3 size={17} /></div>
          <div className="storage-copy">
            <strong>Local workspace</strong>
            <span>Saved on this computer</span>
          </div>
          <span className="status-dot" aria-label="Available" />
        </div>
        <div className="sidebar-footer">Performance Tracker <span>Local secured workspace</span></div>
      </div>
    </aside>
  )
}
