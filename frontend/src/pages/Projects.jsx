import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

const COLORS = ['#378add','#e24b4a','#1d9e75','#ef9f27','#534ab7','#d4537e','#0f6e56']

export default function Projects() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editProject, setEditProject] = useState(null)
  const [form, setForm] = useState({ name:'', description:'', prefix:'', color:'#378add', members:[] })

  const fetchProjects = () => {
    api.get('/projects').then(r => setProjects(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchProjects()
    api.get('/users').then(r => setUsers(r.data))
  }, [])

  const openNew = () => {
    setEditProject(null)
    setForm({ name:'', description:'', prefix:'', color:'#378add', members:[] })
    setShowModal(true)
  }
  const openEdit = (p) => {
    setEditProject(p)
    setForm({ name:p.name, description:p.description||'', prefix:p.prefix, color:p.color||'#378add', members:p.members.map(m=>m._id||m) })
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    try {
      if (editProject) {
        await api.put(`/projects/${editProject._id}`, form)
        toast.success('Project updated')
      } else {
        await api.post('/projects', form)
        toast.success('Project created')
      }
      setShowModal(false)
      fetchProjects()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving project')
    }
  }

  const deleteProject = async (id) => {
    if (!confirm('Delete this project and all its issues?')) return
    await api.delete(`/projects/${id}`)
    toast.success('Project deleted')
    fetchProjects()
  }

  const toggleMember = (id) => {
    setForm(f => ({
      ...f,
      members: f.members.includes(id) ? f.members.filter(m=>m!==id) : [...f.members, id]
    }))
  }

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <h1 style={{ fontSize:20, fontWeight:600 }}>Projects</h1>
        <button className="btn btn-primary" onClick={openNew}><i className="ti ti-plus" /> New Project</button>
      </div>

      {loading && <div className="empty-state"><i className="ti ti-loader-2" style={{ animation:'spin 1s linear infinite' }} /><style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style></div>}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:16 }}>
        {projects.map(p => (
          <div key={p._id} className="card" style={{ position:'relative', borderTop:`3px solid ${p.color||'#378add'}` }}>
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:10 }}>
              <div>
                <div style={{ fontWeight:600, fontSize:15 }}>{p.name}</div>
                <div style={{ fontSize:11, color:'#9ca3af', fontFamily:'monospace', marginTop:2 }}>{p.prefix}</div>
              </div>
              <div style={{ display:'flex', gap:4 }}>
                <button className="btn-icon" onClick={()=>openEdit(p)} title="Edit"><i className="ti ti-edit" style={{ fontSize:15 }} /></button>
                {user?.role==='admin' && <button className="btn-icon" style={{ color:'#ef4444' }} onClick={()=>deleteProject(p._id)}><i className="ti ti-trash" style={{ fontSize:15 }} /></button>}
              </div>
            </div>
            {p.description && <p style={{ fontSize:13, color:'#6b7280', marginBottom:12, lineHeight:1.5 }}>{p.description}</p>}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:12, paddingTop:12, borderTop:'1px solid #f1f5f9' }}>
              <div style={{ display:'flex', gap:-4 }}>
                {p.members.slice(0,4).map(m => (
                  <div key={m._id} className="avatar" style={{ background:'#378add', border:'2px solid #fff', marginLeft:m===p.members[0]?0:-8 }} title={m.name}>
                    {(m.name||'?')[0]}
                  </div>
                ))}
                {p.members.length > 4 && <div style={{ fontSize:11, color:'#9ca3af', marginLeft:8, display:'flex', alignItems:'center' }}>+{p.members.length-4}</div>}
              </div>
              <Link to={`/issues?project=${p._id}`} className="btn btn-ghost btn-sm">
                View Issues <i className="ti ti-arrow-right" />
              </Link>
            </div>
          </div>
        ))}
        {!loading && projects.length === 0 && (
          <div className="empty-state" style={{ gridColumn:'1/-1' }}>
            <i className="ti ti-folder-off" /><p>No projects yet. Create one to get started.</p>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={e=>{ if(e.target===e.currentTarget) setShowModal(false) }}>
          <div className="modal">
            <div className="modal-header">
              <h3>{editProject ? 'Edit Project' : 'New Project'}</h3>
              <button className="btn-icon" onClick={()=>setShowModal(false)}><i className="ti ti-x" /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Project Name *</label>
                  <input className="form-control" required value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Donnelly Apartments" />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea className="form-control" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Brief description…" />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <div className="form-group">
                    <label className="form-label">Prefix *</label>
                    <input className="form-control" required maxLength={5} value={form.prefix}
                      onChange={e=>setForm(f=>({...f,prefix:e.target.value.toUpperCase()}))}
                      placeholder="e.g. PR" style={{ fontFamily:'monospace' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Color</label>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap', paddingTop:4 }}>
                      {COLORS.map(c=>(
                        <button key={c} type="button" onClick={()=>setForm(f=>({...f,color:c}))}
                          style={{ width:24, height:24, borderRadius:'50%', background:c, border:`3px solid ${form.color===c?'#374151':'transparent'}`, cursor:'pointer' }} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Team Members</label>
                  <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:180, overflowY:'auto', border:'1px solid #e5e7eb', borderRadius:8, padding:8 }}>
                    {users.map(u => (
                      <label key={u._id} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'4px 6px', borderRadius:6, background: form.members.includes(u._id) ? '#eff6ff' : 'transparent' }}>
                        <input type="checkbox" checked={form.members.includes(u._id)} onChange={()=>toggleMember(u._id)} />
                        <span style={{ fontSize:13 }}>{u.name}</span>
                        <span style={{ fontSize:11, color:'#9ca3af', marginLeft:'auto' }}>{u.email}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editProject ? 'Update' : 'Create Project'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
