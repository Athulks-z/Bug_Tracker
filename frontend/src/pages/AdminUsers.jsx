import { useState, useEffect } from 'react'
import api from '../api'
import { avatarColor, initials } from '../utils'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

export default function AdminUsers() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [form, setForm] = useState({ name:'', email:'', password:'', role:'member' })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const fetchUsers = () => {
    api.get('/users').then(r => setUsers(r.data)).finally(() => setLoading(false))
  }
  useEffect(() => { fetchUsers() }, [])

  const openNew = () => {
    setEditUser(null)
    setForm({ name:'', email:'', password:'', role:'member' })
    setShowModal(true)
  }
  const openEdit = (u) => {
    setEditUser(u)
    setForm({ name:u.name, email:u.email, password:'', role:u.role })
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const data = { name:form.name, email:form.email, role:form.role }
      if (form.password) data.password = form.password
      if (editUser) {
        await api.put(`/users/${editUser._id}`, data)
        toast.success('User updated')
      } else {
        if (!form.password) { toast.error('Password is required'); setSaving(false); return }
        await api.post('/users', { ...data, password:form.password })
        toast.success('User created')
      }
      setShowModal(false)
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving user')
    } finally { setSaving(false) }
  }

  const toggleActive = async (u) => {
    if (u._id === me._id) { toast.error("Can't deactivate yourself"); return }
    await api.put(`/users/${u._id}`, { active: !u.active })
    toast.success(u.active ? 'User deactivated' : 'User activated')
    fetchUsers()
  }

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:600 }}>User Management</h1>
          <p style={{ color:'#6b7280', fontSize:13, marginTop:2 }}>{users.length} total users</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}><i className="ti ti-user-plus" /> Add User</button>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:14, marginBottom:24 }}>
        {[
          { label:'Total', value:users.length, color:'#378add' },
          { label:'Admins', value:users.filter(u=>u.role==='admin').length, color:'#ef9f27' },
          { label:'Members', value:users.filter(u=>u.role==='member').length, color:'#1d9e75' },
          { label:'Inactive', value:users.filter(u=>!u.active).length, color:'#9ca3af' },
        ].map(s=>(
          <div key={s.label} className="card" style={{ padding:'14px 16px' }}>
            <div style={{ fontSize:22, fontWeight:700, color:s.color }}>{s.value}</div>
            <div style={{ fontSize:12, color:'#6b7280', marginTop:3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9' }}>
          <input className="form-control" style={{ width:260 }} placeholder="🔍  Search users…"
            value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6}><div className="empty-state"><i className="ti ti-loader-2" style={{ animation:'spin 1s linear infinite' }} /><style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style></div></td></tr>}
              {filtered.map(u => (
                <tr key={u._id} style={{ opacity: u.active ? 1 : 0.5 }}>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div className="avatar avatar-lg" style={{ background:avatarColor(u.name) }}>{initials(u.name)}</div>
                      <div>
                        <div style={{ fontWeight:500 }}>{u.name} {u._id===me._id && <span style={{ fontSize:10, background:'#eff6ff', color:'#1d4ed8', padding:'2px 6px', borderRadius:99 }}>You</span>}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ color:'#4b5563', fontSize:13 }}>{u.email}</td>
                  <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                  <td>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12 }}>
                      <span style={{ width:7, height:7, borderRadius:'50%', background:u.active?'#1d9e75':'#9ca3af', display:'inline-block' }} />
                      {u.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ color:'#9ca3af', fontSize:12 }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display:'flex', gap:4' }}>
                      <button className="btn btn-ghost btn-sm" onClick={()=>openEdit(u)}>
                        <i className="ti ti-edit" style={{ fontSize:13 }} /> Edit
                      </button>
                      <button
                        className={`btn btn-sm ${u.active?'btn-danger':'btn-ghost'}`}
                        onClick={()=>toggleActive(u)}
                        disabled={u._id===me._id}
                      >
                        <i className={`ti ${u.active?'ti-user-off':'ti-user-check'}`} style={{ fontSize:13 }} />
                        {u.active?'Deactivate':'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length===0 && <tr><td colSpan={6}><div className="empty-state"><i className="ti ti-users-off" /><p>No users found</p></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={e=>{ if(e.target===e.currentTarget) setShowModal(false) }}>
          <div className="modal">
            <div className="modal-header">
              <h3>{editUser ? `Edit ${editUser.name}` : 'Add New User'}</h3>
              <button className="btn-icon" onClick={()=>setShowModal(false)}><i className="ti ti-x" /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full Name *</label>
                  <input className="form-control" required value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="John Doe" />
                </div>
                <div className="form-group">
                  <label className="form-label">Email Address *</label>
                  <input className="form-control" required type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="john@company.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">{editUser ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                  <input className="form-control" type="password" value={form.password}
                    onChange={e=>setForm(f=>({...f,password:e.target.value}))}
                    placeholder={editUser ? '••••••••' : 'Min 6 characters'}
                    required={!editUser} minLength={editUser ? undefined : 6} />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-control" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <p style={{ fontSize:11, color:'#9ca3af', marginTop:5 }}>
                    Admins can manage users, all projects, and all issues.
                  </p>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : (editUser ? 'Update User' : 'Create User')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
