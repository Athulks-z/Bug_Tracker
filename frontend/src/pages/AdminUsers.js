import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const inputStyle = { width:'100%', padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, color:'#1a202c', outline:'none' };
const AVATAR_COLORS = ['#e24b4a','#378add','#1d9e75','#ef9f27','#534ab7','#d4537e'];

function Avatar({ name, size=36 }) {
  const c = AVATAR_COLORS[name?.charCodeAt(0) % AVATAR_COLORS.length] || '#378add';
  const initials = name?.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return <div style={{ width:size, height:size, borderRadius:'50%', background:c, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:size*0.35, fontWeight:600, flexShrink:0 }}>{initials}</div>;
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ name:'', email:'', password:'', role:'member', domain:'Other', jobTitle:'', phone:'', skills:'', reportingManager:'', assignedProjects:[], active:true });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/users'), api.get('/projects')])
      .then(([u, p]) => {
        setUsers(u);
        setProjects(p);
      })
      .finally(()=>setLoading(false));
  };
  useEffect(()=>{ load(); },[]);

  const openNew = () => {
    setEditUser(null);
    setForm({ name:'', email:'', password:'', role:'member', domain:'Other', jobTitle:'', phone:'', skills:'', reportingManager:'', assignedProjects:[], active:true });
    setError(''); setShowModal(true);
  };

  const openEdit = (u) => {
    setEditUser(u);
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      domain: u.domain || 'Other',
      jobTitle: u.jobTitle || '',
      phone: u.phone || '',
      skills: u.skills || '',
      reportingManager: u.reportingManager?._id || u.reportingManager || '',
      assignedProjects: (u.assignedProjects || []).map(p => p._id || p),
      active: u.active
    });
    setError(''); setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.email.trim()) { setError('Name and email required'); return; }
    if (!editUser && !form.password) { setError('Password required for new user'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form };
      if (editUser && !form.password) delete payload.password;
      if (editUser) {
        const updated = await api.put(`/users/${editUser._id}`, payload);
        setUsers(us => us.map(u => u._id===updated._id ? updated : u));
      } else {
        const created = await api.post('/users', payload);
        setUsers(us => [created, ...us]);
      }
      setShowModal(false);
    } catch(err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this user?')) return;
    await api.delete(`/users/${id}`);
    setUsers(us => us.filter(u => u._id !== id));
  };

  const toggleActive = async (u) => {
    const updated = await api.put(`/users/${u._id}`, { active: !u.active });
    setUsers(us => us.map(x => x._id===updated._id ? updated : x));
  };

  const filtered = users.filter(u => !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#1a202c' }}>User Management</h1>
          <p style={{ color:'#64748b', fontSize:13, marginTop:2 }}>{users.length} total users</p>
        </div>
        <button onClick={openNew} style={{ background:'#378add', color:'#fff', border:'none', borderRadius:8, padding:'9px 18px', fontSize:13, fontWeight:500, display:'flex', alignItems:'center', gap:6 }}>
          <i className="ti ti-user-plus" />Add User
        </button>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:14, marginBottom:24 }}>
        {[
          { label:'Total Users', value:users.length, icon:'ti-users', color:'#378add' },
          { label:'Admins', value:users.filter(u=>u.role==='admin').length, icon:'ti-shield', color:'#534ab7' },
          { label:'Active', value:users.filter(u=>u.active).length, icon:'ti-circle-check', color:'#1d9e75' },
          { label:'Inactive', value:users.filter(u=>!u.active).length, icon:'ti-circle-x', color:'#e24b4a' },
        ].map(s=>(
          <div key={s.label} style={{ background:'#fff', borderRadius:10, padding:'16px', border:'1px solid #e2e8f0', display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:38, height:38, background:`${s.color}18`, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center' }}>
              <i className={`ti ${s.icon}`} style={{ fontSize:18, color:s.color }} />
            </div>
            <div>
              <div style={{ fontSize:20, fontWeight:700, color:'#1a202c' }}>{s.value}</div>
              <div style={{ fontSize:12, color:'#64748b' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ display:'flex', alignItems:'center', gap:6, background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 12px', marginBottom:16, maxWidth:320 }}>
        <i className="ti ti-search" style={{ color:'#94a3b8', fontSize:15 }} />
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search users…" style={{ border:'none', outline:'none', fontSize:13, width:'100%' }} />
      </div>

      <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:40, textAlign:'center', color:'#94a3b8' }}>Loading...</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['User','Email','Role','Domain','Manager','Status','Joined','Actions'].map(h=>(
                  <th key={h} style={{ padding:'10px 16px', textAlign:'left', color:'#64748b', fontSize:11, fontWeight:600, borderBottom:'1px solid #e2e8f0', textTransform:'uppercase', letterSpacing:'0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u._id} style={{ borderBottom:'1px solid #f1f5f9', opacity: u.active ? 1 : 0.6 }}>
                  <td style={{ padding:'12px 16px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <Avatar name={u.name} />
                      <div>
                        <div style={{ fontWeight:500, color:'#1a202c' }}>{u.name}</div>
                        {u._id === me?._id && <div style={{ fontSize:11, color:'#378add' }}>You</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding:'12px 16px', color:'#475569' }}>{u.email}</td>
                  <td style={{ padding:'12px 16px' }}>
                    <span style={{ background: u.role==='admin' ? '#534ab718' : '#37add818', color: u.role==='admin' ? '#534ab7' : '#378add', padding:'3px 10px', borderRadius:12, fontSize:12, fontWeight:500 }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ padding:'12px 16px', color:'#475569', fontSize:12 }}>{u.domain || 'Other'}</td>
                  <td style={{ padding:'12px 16px', color:'#475569', fontSize:12 }}>{u.reportingManager?.name || '—'}</td>
                  <td style={{ padding:'12px 16px' }}>
                    <span style={{ background: u.active ? '#1d9e7518' : '#e24b4a18', color: u.active ? '#1d9e75' : '#e24b4a', padding:'3px 10px', borderRadius:12, fontSize:12, fontWeight:500 }}>
                      {u.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding:'12px 16px', color:'#64748b', fontSize:12 }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding:'12px 16px' }}>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={()=>openEdit(u)} style={{ background:'none', border:'1px solid #e2e8f0', borderRadius:6, padding:'5px 10px', fontSize:13, color:'#64748b' }} title="Edit"><i className="ti ti-edit" /></button>
                      {u._id !== me?._id && <>
                        <button onClick={()=>toggleActive(u)} style={{ background:'none', border:`1px solid ${u.active?'#fde68a':'#bbf7d0'}`, borderRadius:6, padding:'5px 10px', fontSize:13, color: u.active?'#d97706':'#16a34a' }} title={u.active?'Deactivate':'Activate'}>
                          <i className={`ti ti-${u.active?'user-off':'user-check'}`} />
                        </button>
                        <button onClick={()=>remove(u._id)} style={{ background:'none', border:'1px solid #fecaca', borderRadius:6, padding:'5px 10px', fontSize:13, color:'#ef4444' }} title="Delete"><i className="ti ti-trash" /></button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div onClick={()=>setShowModal(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:14, padding:28, width:'100%', maxWidth:460, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
              <h2 style={{ fontSize:16, fontWeight:600 }}>{editUser ? 'Edit User' : 'Add New User'}</h2>
              <button onClick={()=>setShowModal(false)} style={{ background:'none', border:'none', fontSize:20, color:'#94a3b8' }}><i className="ti ti-x" /></button>
            </div>
            {error && <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'#dc2626', padding:'10px 14px', borderRadius:8, marginBottom:14, fontSize:13 }}>{error}</div>}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div style={{ gridColumn:'1/-1' }}>
                <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Full Name *</label>
                <input style={inputStyle} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="John Doe" />
              </div>
              <div style={{ gridColumn:'1/-1' }}>
                <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Email *</label>
                <input type="email" style={inputStyle} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="john@example.com" />
              </div>
              <div style={{ gridColumn:'1/-1' }}>
                <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>{editUser ? 'New Password (optional)' : 'Password *'}</label>
                <input type="password" style={inputStyle} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="••••••••" />
              </div>
              <div>
                <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Role</label>
                <select style={inputStyle} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Domain</label>
                <select style={inputStyle} value={form.domain} onChange={e=>setForm({...form,domain:e.target.value})}>
                  <option value="Firmware">Firmware</option>
                  <option value="Hardware">Hardware</option>
                  <option value="Project Manager">Project Manager</option>
                  <option value="Tester">Tester</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Job Title</label>
                <input style={inputStyle} value={form.jobTitle} onChange={e=>setForm({...form,jobTitle:e.target.value})} placeholder="e.g. QA Engineer" />
              </div>
              <div>
                <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Phone</label>
                <input style={inputStyle} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+1 555 0123" />
              </div>
              <div>
                <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Reporting Manager</label>
                <select style={inputStyle} value={form.reportingManager} onChange={e=>setForm({...form,reportingManager:e.target.value})}>
                  <option value="">None</option>
                  {users.filter(u => u._id !== editUser?._id).map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
                </select>
              </div>
              <div style={{ gridColumn:'1/-1' }}>
                <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Skills</label>
                <textarea style={{ ...inputStyle, minHeight:70, resize:'vertical' }} value={form.skills} onChange={e=>setForm({...form,skills:e.target.value})} placeholder="e.g. React, Embedded C, Test automation" />
              </div>
              <div style={{ gridColumn:'1/-1' }}>
                <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Assigned Projects</label>
                <div style={{ border:'1px solid #e2e8f0', borderRadius:8, padding:10, maxHeight:180, overflowY:'auto' }}>
                  {projects.map(project => (
                    <label key={project._id} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, cursor:'pointer' }}>
                      <input type="checkbox" checked={form.assignedProjects.includes(project._id)} onChange={() => {
                        setForm(f => ({
                          ...f,
                          assignedProjects: f.assignedProjects.includes(project._id)
                            ? f.assignedProjects.filter(pid => pid !== project._id)
                            : [...f.assignedProjects, project._id]
                        }))
                      }} />
                      <span style={{ fontSize:13, color:'#334155' }}>{project.name} ({project.key})</span>
                    </label>
                  ))}
                </div>
              </div>
              {editUser && (
                <div>
                  <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Status</label>
                  <select style={inputStyle} value={form.active} onChange={e=>setForm({...form,active:e.target.value==='true'})}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              )}
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
              <button onClick={()=>setShowModal(false)} style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'none', fontSize:13, color:'#64748b' }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding:'9px 18px', background:'#378add', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:500, opacity:saving?0.7:1 }}>
                {saving ? 'Saving...' : editUser ? 'Update User' : 'Add User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
