import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

export default function Projects() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    setLoading(true)
    api.getWithMeta('/projects', { page, limit:100,status:statusFilter })
      .then((result) => {
        setProjects(result.data)
        setTotal(result.total)
      })
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false))
  }, [page,statusFilter])

  const statusLabel = (project) => project.statusLabel
    || (project.status === 'active' ? 'In Progress' : project.status)

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:22 }}>
        <div>
          <h1 style={{ fontSize:22,fontWeight:700 }}>Projects</h1>
          <p style={{ color:'#64748b',fontSize:13 }}>{total} projects</p>
        </div>
        {['super_admin','admin','manager'].includes(user?.role) &&
          <Link className="btn btn-primary" to="/admin/projects"><i className="ti ti-settings" /> Manage Projects</Link>}
      </div>
      <label style={{ display:'block',maxWidth:240,marginBottom:16 }}>
        <span className="sr-only">Filter projects by status</span>
        <select className="form-control" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          <option value="planning">Planning</option>
          <option value="active">In Progress</option>
          <option value="on_hold">On Hold</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
          <option value="cancelled">Cancelled</option>
          <option value="closed">Closed</option>
        </select>
      </label>

      {loading ? <div className="empty-state" aria-live="polite">Loading projects…</div> : (
        projects.length === 0
          ? <div className="empty-state">
            <i className="ti ti-folder-off" />
            <p>{['employee','trainee'].includes(user?.role) ? 'No projects assigned to you yet.' : 'No projects yet.'}</p>
          </div>
          : <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:16 }}>
            {projects.map((project) => (
              <Link key={project._id} to={`/projects/${project._id}`} className="card"
                style={{ padding:20,textDecoration:'none',color:'inherit',borderTop:'3px solid #378add' }}>
                <div style={{ display:'flex',justifyContent:'space-between',gap:12 }}>
                  <div>
                    <h2 style={{ fontSize:16,fontWeight:650 }}>{project.name}</h2>
                    <small style={{ color:'#64748b',fontFamily:'monospace' }}>{project.key}</small>
                  </div>
                  <span className="badge" style={{ background:'#eff6ff',color:'#1d4ed8' }}>{statusLabel(project)}</span>
                </div>
                <p style={{ color:'#64748b',fontSize:13,margin:'12px 0' }}>{project.description || 'No description'}</p>
                <div style={{ display:'flex',justifyContent:'space-between',fontSize:12,color:'#64748b' }}>
                  <span>Owner: {project.owner?.name || '—'}</span>
                  <span>{project.members?.length || 0} members</span>
                </div>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:14,paddingTop:12,borderTop:'1px solid #f1f5f9' }}>
                  <span className="badge" style={{ background:'#f8fafc',color:'#475569' }}>{project.priority || 'Medium'} priority</span>
                  <span style={{ fontSize:12,color:'#2563eb' }}>Project details <i className="ti ti-arrow-right" /></span>
                </div>
              </Link>
            ))}
          </div>
      )}
      {!loading && total > 100 && <div style={{ display:'flex',justifyContent:'center',alignItems:'center',gap:12,marginTop:20 }}>
        <button className="btn btn-ghost" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
        <span aria-live="polite">Page {page} of {Math.ceil(total / 100)}</span>
        <button className="btn btn-ghost" disabled={page >= Math.ceil(total / 100)} onClick={() => setPage((current) => current + 1)}>Next</button>
      </div>}
    </div>
  )
}
