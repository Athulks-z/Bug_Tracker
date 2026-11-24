import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [project, setProject] = useState(null)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedBacklog, setSelectedBacklog] = useState(null)
  const [moveForm, setMoveForm] = useState({ assignee:'',startDate:today(),dueDate:'',milestone:'',estimatedHours:'' })
  const [savingMove, setSavingMove] = useState(false)

  const loadProject = useCallback(async () => {
    try {
      const result = await api.get(`/projects/${id}`)
      setProject(result)
    } catch (error) {
      toast.error(error.message)
      setProject(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadProject()
    api.get('/users', { taskAssignees:true })
      .then(setUsers)
      .catch((error) => toast.error(error.message))
  }, [loadProject])

  const chartData = useMemo(() => (project?.taskDistribution || []).flatMap((member) => [
    { ...member, name:`${member.name} finished`, value:member.finished, color:member.color },
    { ...member, name:`${member.name} pending`, value:member.pending, color:'#cbd5e1' }
  ]).filter((entry) => entry.value > 0), [project])

  const startMove = (task) => {
    setSelectedBacklog(task)
    setMoveForm({
      assignee:task.assignee?._id || '',
      startDate:task.startDate || today(),
      dueDate:task.endDate || '',
      milestone:task.milestone || '',
      estimatedHours:task.estimatedHours || ''
    })
  }

  const moveTask = async () => {
    if (!selectedBacklog) return
    if (!moveForm.assignee || !moveForm.startDate || !moveForm.dueDate) {
      toast.error('Assignee, start date, and due date are required')
      return
    }
    setSavingMove(true)
    try {
      const response = await api.post(`/projects/${id}/backlog/${selectedBacklog._id}/move`, moveForm)
      if (response.emailNotification?.queued === false) toast.error(response.emailNotification.message)
      else toast.success('Backlog item moved to Tasks')
      setSelectedBacklog(null)
      await loadProject()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSavingMove(false)
    }
  }

  if (loading) return <div className="empty-state" style={{ padding:80 }}>Loading project…</div>
  if (!project) return <div className="empty-state" style={{ padding:80 }}>Project not found</div>

  const status = project.statusLabel || (project.status === 'active' ? 'In Progress' : project.status)
  const totalTasks = project.overall?.total || 0
  const completedTasks = project.overall?.completed || 0
  const assignedTaskTotal = (project.taskDistribution || []).reduce((total, member) => total + member.total, 0)

  return (
    <div style={{ padding:28,maxWidth:1200 }}>
      <Link to="/projects" className="btn btn-ghost" style={{ marginBottom:14 }}><i className="ti ti-arrow-left" /> Projects</Link>
      <section className="card" style={{ padding:24 }}>
        <div style={{ display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap' }}>
          <div>
            <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
              <span className="badge" style={{ background:'#eff6ff',color:'#1d4ed8' }}>{status}</span>
              <span className="badge" style={{ background:'#f8fafc',color:'#475569' }}>{project.priority} priority</span>
            </div>
            <h1 style={{ fontSize:25,marginTop:10 }}>{project.name} <small style={{ fontSize:14,color:'#64748b' }}>{project.key}</small></h1>
            {project.description && <p style={{ color:'#64748b',marginTop:8 }}>{project.description}</p>}
          </div>
          <div style={{ display:'grid',gap:8,alignContent:'start',fontSize:13 }}>
            <div><strong>Project Owner:</strong> {project.owner?.name || '—'}</div>
            <div><strong>Created By:</strong> {project.createdBy?.name || '—'}</div>
            <div><strong>Dates:</strong> {project.startDate || '—'} – {project.targetEndDate || '—'}</div>
          </div>
        </div>
      </section>

      <section className="card" style={{ padding:20,marginTop:16 }}>
        <h2 style={{ fontSize:16,marginBottom:12 }}>Project Stakeholders</h2>
        {(project.stakeholders || []).length === 0
          ? <p style={{ color:'#64748b',fontSize:13 }}>No stakeholders assigned.</p>
          : <div style={{ display:'flex',flexWrap:'wrap',gap:12 }}>
            {project.stakeholders.map((person) => (
              <div key={person._id} style={{ display:'flex',gap:8,alignItems:'center',border:'1px solid #e2e8f0',borderRadius:8,padding:'8px 12px' }}>
                <div className="avatar" aria-hidden="true">{person.name?.slice(0,1) || '?'}</div>
                <span style={{ fontSize:13 }}>{person.name}</span>
                <small style={{ color:'#64748b' }}>Stakeholder</small>
              </div>
            ))}
          </div>}
      </section>

      <section className="card" style={{ padding:20,marginTop:16 }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap' }}>
          <h2 style={{ fontSize:16 }}>Project Milestones</h2>
          {user?.role !== 'trainee' && <button className="btn btn-primary" onClick={() => navigate(`/tasks?mode=backlog&project=${encodeURIComponent(id)}`)}>
            <i className="ti ti-plus" /> Create Backlog
          </button>}
        </div>
        {(project.milestones || []).length === 0
          ? <p style={{ color:'#64748b',fontSize:13,marginTop:12 }}>No milestones configured.</p>
          : <div style={{ display:'grid',gap:12,marginTop:14 }}>
            {project.milestones.map((milestone) => (
              <div key={milestone.id}>
                <div style={{ display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:5 }}>
                  <span>{milestone.name}</span><strong>{milestone.percentage}%</strong>
                </div>
                <div role="progressbar" aria-label={`${milestone.name} completion`} aria-valuenow={milestone.percentage} aria-valuemin={0} aria-valuemax={100}
                  style={{ height:9,borderRadius:6,background:'#e2e8f0',overflow:'hidden' }}>
                  <div style={{ width:`${milestone.percentage}%`,height:'100%',background:'#378add' }} />
                </div>
                <small style={{ color:'#64748b' }}>
                  {milestone.completed} of {milestone.total} active tasks complete
                  {milestone.dueDate ? ` · Due ${milestone.dueDate}` : ''}
                  {milestone.ownerName ? ` · Owner ${milestone.ownerName}` : ''}
                </small>
              </div>
            ))}
          </div>}
      </section>

      <section style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:16,marginTop:16 }}>
        <div className="card" style={{ padding:20 }}>
          <h2 style={{ fontSize:16 }}>Project Overview</h2>
          <div style={{ display:'flex',justifyContent:'space-between',marginTop:18,fontSize:14 }}>
            <span>{completedTasks} completed of {totalTasks} active tasks</span><strong>{project.overall?.percentage || 0}%</strong>
          </div>
          <div role="progressbar" aria-label="Overall project completion" aria-valuenow={project.overall?.percentage || 0} aria-valuemin={0} aria-valuemax={100}
            style={{ height:12,borderRadius:8,background:'#e2e8f0',overflow:'hidden',marginTop:8 }}>
            <div style={{ width:`${project.overall?.percentage || 0}%`,height:'100%',background:'#1d9e75' }} />
          </div>
          <Link className="btn btn-ghost" style={{ marginTop:14 }} to={`/tasks?project=${encodeURIComponent(id)}`}>View active Tasks</Link>
        </div>

        <div className="card" style={{ padding:20 }}>
          <h2 style={{ fontSize:16 }}>Task Distribution by Assignee</h2>
          {chartData.length === 0 ? <p style={{ color:'#64748b',fontSize:13,marginTop:14 }}>No tasks yet</p> : (
            <>
              <div role="img" aria-label="Donut chart showing finished and unfinished active task distribution by assignee">
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={0}
                      onClick={(entry) => {
                        if (entry?.userId) navigate(`/tasks?project=${encodeURIComponent(id)}&assignee=${encodeURIComponent(entry.userId)}`)
                      }}>
                      {chartData.map((entry, index) => <Cell key={`${entry.userId}-${entry.name}-${index}`} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(value, _name, item) => {
                      const member = item.payload
                      const percentage = assignedTaskTotal ? Math.round((member.total / assignedTaskTotal) * 100) : 0
                      return [`${value} · ${member.name} · ${member.finished} finished · ${member.pending} pending · ${percentage}% of assigned tasks`, 'Tasks']
                    }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display:'grid',gap:6 }}>
                {(project.taskDistribution || []).map((member) => (
                  <button key={member.userId} type="button"
                    onClick={() => navigate(`/tasks?project=${encodeURIComponent(id)}&assignee=${encodeURIComponent(member.userId)}`)}
                    style={{ display:'flex',alignItems:'center',gap:8,background:'transparent',border:0,padding:4,textAlign:'left',cursor:'pointer',fontSize:12 }}>
                    <span aria-hidden="true" style={{ width:12,height:12,borderRadius:3,background:member.color }} />
                    <span style={{ flex:1 }}>{member.name}</span>
                    <span>{member.total} total · {member.finished} finished · {member.pending} pending · {assignedTaskTotal ? Math.round((member.total / assignedTaskTotal) * 100) : 0}%</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="card" style={{ padding:20,marginTop:16 }}>
        <h2 style={{ fontSize:16,marginBottom:12 }}>Project Backlog</h2>
        {(project.backlog || []).length === 0 ? <p style={{ color:'#64748b',fontSize:13 }}>No backlog items.</p> : (
          <div style={{ display:'grid',gap:8 }}>
            {project.backlog.map((task) => (
              <div key={task._id} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,borderTop:'1px solid #f1f5f9',paddingTop:10 }}>
                <div>
                  <strong>{task.taskKey} · {task.title}</strong>
                  <div style={{ color:'#64748b',fontSize:12 }}>{task.typeLabel} · {task.assignee?.name || 'Unassigned'}</div>
                </div>
                {user?.role !== 'trainee' && <button className="btn btn-ghost btn-sm" onClick={() => startMove(task)}>Move to Tasks</button>}
              </div>
            ))}
          </div>
        )}
      </section>

      {selectedBacklog && (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelectedBacklog(null) }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="move-backlog-title">
            <div className="modal-header"><h2 id="move-backlog-title">Move {selectedBacklog.taskKey} to Tasks</h2>
              <button className="btn-icon" aria-label="Close" onClick={() => setSelectedBacklog(null)}><i className="ti ti-x" /></button>
            </div>
            <div className="modal-body" style={{ display:'grid',gap:12 }}>
              <label className="form-group"><span className="form-label">Assignee *</span>
                <select className="form-control" value={moveForm.assignee} onChange={(event) => setMoveForm((current) => ({ ...current,assignee:event.target.value }))}>
                  <option value="">Select assignee</option>{users.map((person) => <option key={person._id} value={person._id}>{person.name}</option>)}
                </select>
              </label>
              <label className="form-group"><span className="form-label">Start date *</span>
                <input className="form-control" type="date" value={moveForm.startDate} onChange={(event) => setMoveForm((current) => ({ ...current,startDate:event.target.value }))} />
              </label>
              <label className="form-group"><span className="form-label">Due date *</span>
                <input className="form-control" type="date" value={moveForm.dueDate} onChange={(event) => setMoveForm((current) => ({ ...current,dueDate:event.target.value }))} />
              </label>
              {(project.milestones || []).length > 0 && <label className="form-group"><span className="form-label">Milestone</span>
                <select className="form-control" value={moveForm.milestone} onChange={(event) => setMoveForm((current) => ({ ...current,milestone:event.target.value }))}>
                  <option value="">No milestone</option>{project.milestones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>}
              <label className="form-group"><span className="form-label">Estimated hours</span>
                <input className="form-control" type="number" min="0" step="0.25" value={moveForm.estimatedHours} onChange={(event) => setMoveForm((current) => ({ ...current,estimatedHours:event.target.value }))} />
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setSelectedBacklog(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={savingMove} onClick={moveTask}>{savingMove ? 'Moving…' : 'Move to Tasks'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
