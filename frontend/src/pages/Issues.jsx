import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import { statusBadgeClass, severityBadgeClass, fmtDate, avatarColor, initials } from '../utils'
import toast from 'react-hot-toast'
import IssueModal from '../components/IssueModal'

const STATUSES = ['Open','To do','In progress','Reopen','Closed']
const SEVERITIES = ['Showstopper','Major','Medium','Low','None']

export default function Issues() {
  const [issues, setIssues] = useState([])
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ project:'', status:'', severity:'', search:'' })
  const [showModal, setShowModal] = useState(false)
  const [editIssue, setEditIssue] = useState(null)

  const fetchIssues = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (filters.project) params.project = filters.project
      if (filters.status) params.status = filters.status
      if (filters.severity) params.severity = filters.severity
      if (filters.search) params.search = filters.search
      const r = await api.get('/issues', { params })
      setIssues(r.data)
    } finally { setLoading(false) }
  }, [filters])

  useEffect(() => { fetchIssues() }, [fetchIssues])

  useEffect(() => {
    api.get('/projects').then(r => setProjects(r.data))
    api.get('/users').then(r => setUsers(r.data))
  }, [])

  const deleteIssue = async (id) => {
    if (!confirm('Delete this issue?')) return
    await api.delete(`/issues/${id}`)
    toast.success('Issue deleted')
    fetchIssues()
  }

  const handleSave = async (data) => {
    try {
      if (editIssue) {
        await api.put(`/issues/${editIssue._id}`, data)
        toast.success('Issue updated')
      } else {
        await api.post('/issues', data)
        toast.success('Issue created')
      }
      setShowModal(false)
      setEditIssue(null)
      fetchIssues()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving issue')
    }
  }

  const openEdit = (issue) => { setEditIssue(issue); setShowModal(true) }
  const openNew = () => { setEditIssue(null); setShowModal(true) }

  return (
    <div style={{ padding:28 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:600 }}>Issues</h1>
          <p style={{ color:'#6b7280', fontSize:13, marginTop:2 }}>{issues.length} issue{issues.length!==1?'s':''} found</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <i className="ti ti-plus" /> Submit Issue
        </button>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:18, flexWrap:'wrap' }}>
        <input
          className="form-control" style={{ width:220 }}
          placeholder="🔍  Search issues…"
          value={filters.search}
          onChange={e => setFilters(f=>({...f,search:e.target.value}))}
        />
        <select className="form-control" style={{ width:180 }} value={filters.project} onChange={e=>setFilters(f=>({...f,project:e.target.value}))}>
          <option value="">All projects</option>
          {projects.map(p=><option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
        <select className="form-control" style={{ width:150 }} value={filters.status} onChange={e=>setFilters(f=>({...f,status:e.target.value}))}>
          <option value="">All statuses</option>
          {STATUSES.map(s=><option key={s}>{s}</option>)}
        </select>
        <select className="form-control" style={{ width:150 }} value={filters.severity} onChange={e=>setFilters(f=>({...f,severity:e.target.value}))}>
          <option value="">All severities</option>
          {SEVERITIES.map(s=><option key={s}>{s}</option>)}
        </select>
        {(filters.project||filters.status||filters.severity||filters.search) && (
          <button className="btn btn-ghost btn-sm" onClick={()=>setFilters({project:'',status:'',severity:'',search:''})}>
            <i className="ti ti-x" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th style={{ width:'30%' }}>Issue</th>
              <th>Project</th>
              <th>Reporter</th>
              <th>Created</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Severity</th>
              <th></th>
            </tr></thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8}><div className="empty-state"><i className="ti ti-loader-2" style={{ animation:'spin 1s linear infinite' }} /><p>Loading…</p><style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style></div></td></tr>
              )}
              {!loading && issues.length === 0 && (
                <tr><td colSpan={8}><div className="empty-state"><i className="ti ti-bug-off" /><p>No issues found</p></div></td></tr>
              )}
              {!loading && issues.map(i => (
                <tr key={i._id}>
                  <td>
                    <div style={{ fontWeight:500, color:'#111827' }}>{i.title}</div>
                    <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>{i.project?.prefix}-{i.issueNumber}</div>
                  </td>
                  <td style={{ fontSize:12, color:'#4b5563' }}>{i.project?.name||'—'}</td>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <div className="avatar" style={{ background:avatarColor(i.reporter?.name) }}>{initials(i.reporter?.name)}</div>
                      <span style={{ fontSize:12 }}>{i.reporter?.name}</span>
                    </div>
                  </td>
                  <td style={{ color:'#9ca3af', fontSize:12 }}>{fmtDate(i.createdAt)}</td>
                  <td><span className={statusBadgeClass(i.status)}>{i.status}</span></td>
                  <td>
                    {i.assignee ? (
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <div className="avatar" style={{ background:avatarColor(i.assignee.name) }}>{initials(i.assignee.name)}</div>
                        <span style={{ fontSize:12 }}>{i.assignee.name}</span>
                      </div>
                    ) : <span style={{ color:'#9ca3af', fontSize:12 }}>—</span>}
                  </td>
                  <td><span className={severityBadgeClass(i.severity)}>{i.severity}</span></td>
                  <td>
                    <div style={{ display:'flex', gap:4 }}>
                      <button className="btn-icon" onClick={()=>openEdit(i)} title="Edit"><i className="ti ti-edit" style={{ fontSize:15 }} /></button>
                      <button className="btn-icon" style={{ color:'#ef4444' }} onClick={()=>deleteIssue(i._id)} title="Delete"><i className="ti ti-trash" style={{ fontSize:15 }} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <IssueModal
          issue={editIssue}
          projects={projects}
          users={users}
          onSave={handleSave}
          onClose={()=>{ setShowModal(false); setEditIssue(null) }}
        />
      )}
    </div>
  )
}
