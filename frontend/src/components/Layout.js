import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navStyle = (active) => ({
  display:'flex', alignItems:'center', gap:10, padding:'9px 16px',
  color: active ? '#fff' : 'rgba(255,255,255,0.5)',
  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
  borderRadius:6, fontSize:13, transition:'all 0.15s', textDecoration:'none'
});

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const initials = (n) => n?.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const colors = ['#e24b4a','#378add','#1d9e75','#ef9f27','#534ab7','#d4537e'];
  const color = colors[user?.name?.charCodeAt(0) % colors.length] || '#378add';

  return (
    <div style={{ display:'flex', height:'100vh', background:'#f5f7fa' }}>
      {/* Sidebar */}
      <aside style={{ width: collapsed ? 60 : 220, background:'#0f1724', display:'flex', flexDirection:'column', transition:'width 0.2s', overflow:'hidden', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'16px', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ width:32, height:32, background:'#e24b4a', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:16, flexShrink:0 }}>
            <i className="ti ti-bug" />
          </div>
          {!collapsed && <span style={{ color:'#fff', fontSize:15, fontWeight:600, whiteSpace:'nowrap' }}>BugTracker</span>}
          <button onClick={() => setCollapsed(!collapsed)} style={{ marginLeft:'auto', background:'none', border:'none', color:'rgba(255,255,255,0.4)', fontSize:16 }}>
            <i className={`ti ti-${collapsed ? 'layout-sidebar-right' : 'layout-sidebar'}`} />
          </button>
        </div>

        <nav style={{ padding:'10px 8px', flex:1, overflow:'hidden' }}>
          {[
            { to:'/', icon:'ti-layout-dashboard', label:'Dashboard' },
            { to:'/issues', icon:'ti-bug', label:'Issues' },
            { to:'/tasks', icon:'ti-list-check', label:'Tasks' },
          ].map(item => (
            <NavLink key={item.to} to={item.to} end={item.to==='/'} style={({ isActive }) => navStyle(isActive)}>
              <i className={`ti ${item.icon}`} style={{ fontSize:16, flexShrink:0 }} />
              {!collapsed && item.label}
            </NavLink>
          ))}

          {user?.role === 'admin' && (
            <>
              {!collapsed && <div style={{ padding:'12px 8px 4px', fontSize:10, color:'rgba(255,255,255,0.25)', textTransform:'uppercase', letterSpacing:'0.08em' }}>Admin</div>}
              {[
                { to:'/admin/users', icon:'ti-users', label:'Users' },
                { to:'/admin/projects', icon:'ti-folder', label:'Projects' },
              ].map(item => (
                <NavLink key={item.to} to={item.to} style={({ isActive }) => navStyle(isActive)}>
                  <i className={`ti ${item.icon}`} style={{ fontSize:16, flexShrink:0 }} />
                  {!collapsed && item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div style={{ padding:'12px 10px', borderTop:'1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:32, height:32, borderRadius:'50%', background:color, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:12, fontWeight:600, flexShrink:0 }}>{initials(user?.name)}</div>
            {!collapsed && (
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ color:'#fff', fontSize:12, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.name}</div>
                <div style={{ color:'rgba(255,255,255,0.4)', fontSize:11 }}>{user?.role}</div>
              </div>
            )}
            {!collapsed && (
              <button onClick={() => { logout(); navigate('/login'); }} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.4)', fontSize:16 }} title="Logout">
                <i className="ti ti-logout" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex:1, overflow:'auto', background:'#f5f7fa' }}>
        <Outlet />
      </main>
    </div>
  );
}
