import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { initials, avatarColor } from '../utils'

const navItems = [
  { to: '/dashboard', icon: 'ti-layout-dashboard', label: 'Dashboard' },
  { to: '/projects', icon: 'ti-folder', label: 'Projects' },
  { to: '/issues', icon: 'ti-bug', label: 'All Issues' },
  { to: '/reports', icon: 'ti-chart-bar', label: 'Reports' },
]

export default function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <aside style={{
      width: 216, background: '#0f1724', display: 'flex', flexDirection: 'column',
      flexShrink: 0, height: '100vh', position: 'sticky', top: 0,
    }}>
      {/* Logo */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'18px 16px 14px', borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ width:32, height:32, background:'#e24b4a', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:16 }}>
          <i className="ti ti-bug" />
        </div>
        <span style={{ color:'#fff', fontWeight:600, fontSize:15 }}>BugTracker</span>
      </div>

      {/* Nav */}
      <nav style={{ flex:1, padding:'10px 0', overflowY:'auto' }}>
        {navItems.map(n => (
          <NavLink key={n.to} to={n.to} style={({ isActive }) => ({
            display:'flex', alignItems:'center', gap:10, padding:'9px 16px',
            color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
            background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
            fontSize: 13, transition:'all 0.15s', borderRadius:0,
            textDecoration:'none',
          })}>
            <i className={`ti ${n.icon}`} style={{ fontSize:16 }} />
            {n.label}
          </NavLink>
        ))}
        {user?.role === 'admin' && (
          <>
            <div style={{ padding:'14px 16px 6px', fontSize:10, color:'rgba(255,255,255,0.25)', letterSpacing:'0.08em', textTransform:'uppercase' }}>Admin</div>
            <NavLink to="/admin/users" style={({ isActive }) => ({
              display:'flex', alignItems:'center', gap:10, padding:'9px 16px',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
              background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
              fontSize:13, transition:'all 0.15s', textDecoration:'none',
            })}>
              <i className="ti ti-users" style={{ fontSize:16 }} />
              User Management
            </NavLink>
          </>
        )}
      </nav>

      {/* User */}
      <div style={{ padding:'12px 16px', borderTop:'1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div className="avatar" style={{ background: avatarColor(user?.name), width:30, height:30, fontSize:11 }}>
            {initials(user?.name)}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:'#fff', fontSize:12, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.name}</div>
            <div style={{ color:'rgba(255,255,255,0.35)', fontSize:10 }}>{user?.role}</div>
          </div>
          <button className="btn-icon" style={{ color:'rgba(255,255,255,0.4)' }} onClick={() => { logout(); navigate('/login') }} title="Logout">
            <i className="ti ti-logout" style={{ fontSize:16 }} />
          </button>
        </div>
      </div>
    </aside>
  )
}
