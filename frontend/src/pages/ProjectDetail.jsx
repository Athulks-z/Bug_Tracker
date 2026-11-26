import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import useAutoRefresh from '../hooks/useAutoRefresh'

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
  const [closureStep, setClosureStep] = useState('')
  const [closureForm, setClosureForm] = useState({ remarks:'',links:[{ label:'',url:'' }] })
  const [closureFiles, setClosureFiles] = useState([])
  const [uploadProgress, setUploadProgress] = useState('')
  const [closureError, setClosureError] = useState('')
  const [savingClosure, setSavingClosure] = useState(false)
  const [closureSummary, setClosureSummary] = useState(null)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopeningRemarks, setReopeningRemarks] = useState('')
  const [savingReopen, setSavingReopen] = useState(false)
  const appreciationHeadingRef = useRef(null)

  const loadProject = useCallback(async ({ silent = false } = {}) => {
    try {
      const result = await api.get(`/projects/${id}`)
      setProject(result)
    } catch (error) {
      toast.error(error.message)
      setProject(null)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadProject()
    api.get('/users', { taskAssignees:true })
      .then(setUsers)
      .catch((error) => toast.error(error.message))
  }, [loadProject])
  useAutoRefresh(loadProject)

  useEffect(() => {
    if (closureStep === 'appreciation') appreciationHeadingRef.current?.focus()
  }, [closureStep])

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

  const uploadClosureFiles = async (fileList) => {
    if (uploadProgress) {
      setClosureError('Wait for the current attachment upload to finish')
      return
    }
    const files = Array.from(fileList || [])
    const maxFiles = project?.closureAttachmentLimits?.maxFiles || 10
    const maxMb = project?.closureAttachmentLimits?.maxMb || 10
    if (closureFiles.length + files.length > maxFiles) {
      setClosureError(`A maximum of ${maxFiles} attachments is allowed`)
      return
    }
    setClosureError('')
    for (const file of files) {
      const extension = file.name.toLowerCase().split('.').pop()
      if (/\.(exe|bat|cmd|sh|msi|js|vbs|scr|com|cpl|jar|ps1|hta|reg|lnk|dll)(\.|$)/i.test(file.name)
        || ['exe','bat','cmd','sh','msi','js','vbs','scr','com','cpl','jar','ps1','hta','reg','lnk','dll'].includes(extension)) {
        setClosureError(`${file.name}: this file extension is blocked`)
        continue
      }
      if (file.size > maxMb * 1024 * 1024) {
        setClosureError(`${file.name}: attachments must be ${maxMb} MB or smaller`)
        continue
      }
      setUploadProgress(`Reading ${file.name}`)
      try {
        const data = await new Promise((resolve,reject) => {
          const reader = new FileReader()
          reader.onprogress = (event) => {
            if (event.lengthComputable) {
              setUploadProgress(`Reading ${file.name}: ${Math.round((event.loaded / event.total) * 100)}%`)
            }
          }
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(new Error(`Unable to read ${file.name}`))
          reader.readAsDataURL(file)
        })
        setUploadProgress(`Uploading ${file.name}`)
        const staged = await api.post(`/projects/${id}/closure-uploads`, {
          filename:file.name,mime:file.type || 'application/octet-stream',data
        })
        setClosureFiles((current) => [...current,staged])
      } catch (error) {
        setClosureError(error.message)
      } finally {
        setUploadProgress('')
      }
    }
  }

  const removeClosureFile = async (file) => {
    try {
      await api.delete(`/projects/${id}/closure-uploads/${file.id}`)
      setClosureFiles((current) => current.filter((entry) => entry.id !== file.id))
    } catch (error) {
      setClosureError(error.message)
    }
  }

  const cancelClosure = async () => {
    await Promise.all(closureFiles.map(async (file) => {
      try {
        await api.delete(`/projects/${id}/closure-uploads/${file.id}`)
      } catch (error) {
        toast.error(`Unable to remove staged attachment: ${error.message}`)
      }
    }))
    setClosureFiles([])
    setClosureForm({ remarks:'',links:[{ label:'',url:'' }] })
    setClosureError('')
    setClosureStep('')
  }

  const confirmProjectClose = async () => {
    setSavingClosure(true)
    setClosureError('')
    try {
      const links = closureForm.links.filter((link) => link.url.trim())
      const result = await api.post(`/projects/${id}/close`, {
        closingRemarks:closureForm.remarks,
        links,
        uploadIds:closureFiles.map((file) => file.id)
      })
      setClosureSummary(result.closure?.snapshot || null)
      if (!result.alreadyClosed && result.emailQueued === false) {
        toast.error('Project closed, but the appreciation email could not be queued. Check server logs.')
      } else if (!result.alreadyClosed) {
        toast.success('Project closed successfully')
      }
      setClosureFiles([])
      await loadProject()
      setClosureStep('appreciation')
    } catch (error) {
      setClosureError(error.message)
    } finally {
      setSavingClosure(false)
    }
  }

  const reopenProject = async () => {
    if (reopeningRemarks.trim().length < 10) {
      toast.error('Reopening remarks must be at least 10 characters')
      return
    }
    setSavingReopen(true)
    try {
      await api.post(`/projects/${id}/reopen`,{ reopeningRemarks })
      setReopenOpen(false)
      setReopeningRemarks('')
      await loadProject()
      toast.success('Project reopened')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSavingReopen(false)
    }
  }

  const downloadClosureAttachment = async (attachment) => {
    try {
      const blob = await api.download(`/projects/${id}/closure-attachments/${attachment.id}/download`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = attachment.filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error.message)
    }
  }

  const closeDetails = () => {
    setClosureForm({ remarks:'',links:[{ label:'',url:'' }] })
    setClosureError('')
    setClosureStep('details')
  }

  const advanceClosure = () => {
    if (closureForm.remarks.trim().length < 10) {
      setClosureError('Closing remarks must be at least 10 characters')
      return
    }
    const links = closureForm.links.filter((link) => link.url.trim())
    if (links.length > 10 || links.some((link) => {
      try {
        const url = new URL(link.url)
        return !['http:','https:'].includes(url.protocol) || link.label.length > 100
      } catch {
        return true
      }
    })) {
      setClosureError('Enter valid HTTP or HTTPS links with labels no longer than 100 characters')
      return
    }
    if (project.blockCloseWithOpenTasks && project.openTaskCount > 0) {
      setClosureError('Resolve open tasks before closing this project')
      return
    }
    setClosureError('')
    setClosureStep('confirm')
  }

  if (loading) return <div className="empty-state" style={{ padding:80 }}>Loading project…</div>
  if (!project) return <div className="empty-state" style={{ padding:80 }}>Project not found</div>

  const isClosed = project.status === 'closed'
  const status = project.statusLabel || (project.status === 'active' ? 'In Progress' : project.status)
  const totalTasks = project.overall?.total || 0
  const completedTasks = project.overall?.completed || 0
  const assignedTaskTotal = (project.taskDistribution || []).reduce((total, member) => total + member.total, 0)

  return (
    <div style={{ padding:28,maxWidth:1200 }}>
      <Link to="/projects" className="btn btn-ghost" style={{ marginBottom:14 }}><i className="ti ti-arrow-left" /> Projects</Link>
      {isClosed && <div role="status" className="card" style={{ padding:14,marginBottom:14,background:'#fff7ed',border:'1px solid #fed7aa',color:'#9a3412' }}>
        <strong>Project closed.</strong> This project is read-only. Reopen it to resume project work.
      </div>}
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
            {!isClosed && project.permissions?.canClose && <button className="btn btn-primary" onClick={closeDetails}>Close Project</button>}
            {isClosed && project.permissions?.canReopen && <button className="btn btn-primary" onClick={() => setReopenOpen(true)}>Reopen Project</button>}
          </div>
        </div>
      </section>

      {(project.closureHistory || []).length > 0 && (
        <section className="card" style={{ padding:20,marginTop:16 }}>
          <h2 style={{ fontSize:17,marginBottom:14 }}>Project Closure</h2>
          <div style={{ display:'grid',gap:20 }}>
            {project.closureHistory.map((closure) => (
              <article key={closure.id} style={{ borderTop:'1px solid #e2e8f0',paddingTop:14 }}>
                <p style={{ color:'#64748b',fontSize:13 }}>
                  Closed by {closure.closedByName} · {new Date(closure.closedAt).toLocaleDateString()}
                  {closure.reopenedAt ? ` · Reopened by ${closure.reopenedByName} on ${new Date(closure.reopenedAt).toLocaleDateString()}` : ''}
                </p>
                <div style={{ marginTop:8 }} dangerouslySetInnerHTML={{ __html:closure.closingRemarksHtml }} />
                {closure.snapshot && <p style={{ marginTop:8,fontSize:13 }}>
                  {closure.snapshot.completionPercent}% complete · {closure.snapshot.completedTasks} of {closure.snapshot.totalTasks} tasks completed
                  · {closure.snapshot.rejectedTasks} rejected · {closure.snapshot.durationDays} days
                  · {closure.snapshot.milestones?.completed || 0} of {closure.snapshot.milestones?.total || 0} milestones complete
                </p>}
                {!!closure.links?.length && <ul style={{ marginTop:8 }}>
                  {closure.links.map((link,index) => <li key={`${closure.id}-${index}`}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label || link.url}</a>
                  </li>)}
                </ul>}
                {!!closure.attachments?.length && <div style={{ display:'grid',gap:6,marginTop:10 }}>
                  <strong style={{ fontSize:13 }}>Attachments</strong>
                  {closure.attachments.map((attachment) => <button key={attachment.id} className="btn btn-ghost btn-sm"
                    style={{ justifySelf:'start' }} onClick={() => downloadClosureAttachment(attachment)}>
                    <i className="ti ti-download" /> {attachment.filename}
                  </button>)}
                </div>}
                {closure.reopeningRemarks && <p style={{ marginTop:8,fontSize:13 }}><strong>Reopening remarks:</strong> {closure.reopeningRemarks}</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="card" style={{ padding:20,marginTop:16 }}>
        <h2 style={{ fontSize:16,marginBottom:12 }}>Project Members</h2>
        {(project.members || []).length === 0
          ? <p style={{ color:'#64748b',fontSize:13 }}>No members assigned.</p>
          : <div style={{ display:'flex',flexWrap:'wrap',gap:12 }}>
            {project.members.map((person) => (
              <div key={person._id} style={{ display:'flex',gap:8,alignItems:'center',border:'1px solid #e2e8f0',borderRadius:8,padding:'8px 12px' }}>
                <div className="avatar" aria-hidden="true">{person.name?.slice(0,1) || '?'}</div>
                <span style={{ fontSize:13 }}>{person.name}</span>
                <small style={{ color:'#64748b' }}>Member</small>
              </div>
            ))}
          </div>}
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
          {!isClosed && user?.role !== 'trainee' && <button className="btn btn-primary" onClick={() => navigate(`/tasks?mode=backlog&project=${encodeURIComponent(id)}`)}>
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
                {!isClosed && user?.role !== 'trainee' && <button className="btn btn-ghost btn-sm" onClick={() => startMove(task)}>Move to Tasks</button>}
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

      {closureStep && (
        <div className="modal-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget && closureStep !== 'appreciation' && !savingClosure && !uploadProgress) void cancelClosure()
        }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-close-title">
            {closureStep === 'details' && <>
              <div className="modal-header">
                <h2 id="project-close-title">Close project</h2>
                <button className="btn-icon" aria-label="Cancel closing project" onClick={() => void cancelClosure()} disabled={savingClosure || !!uploadProgress}>
                  <i className="ti ti-x" />
                </button>
              </div>
              <div className="modal-body" style={{ display:'grid',gap:14,maxHeight:'70vh',overflowY:'auto' }}>
                {project.openTaskCount > 0 && <div role="status" style={{ padding:12,border:'1px solid #facc15',borderRadius:8,background:'#fefce8' }}>
                  <strong>{project.openTaskCount} open task{project.openTaskCount === 1 ? '' : 's'} remain.</strong>
                  {project.blockCloseWithOpenTasks
                    ? <> Resolve these tasks before closing. <Link to={`/tasks?project=${encodeURIComponent(id)}&statusGroup=Open`}
                      onClick={(event) => { if (uploadProgress) event.preventDefault(); else void cancelClosure() }}>View open tasks</Link></>
                    : <> You can still close the project. <Link to={`/tasks?project=${encodeURIComponent(id)}&statusGroup=Open`}
                      onClick={(event) => { if (uploadProgress) event.preventDefault(); else void cancelClosure() }}>View open tasks</Link></>}
                </div>}
                <label className="form-group">
                  <span className="form-label">Closing remarks *</span>
                  <textarea className="form-control" rows="5" maxLength="10000" value={closureForm.remarks}
                    onChange={(event) => setClosureForm((current) => ({ ...current,remarks:event.target.value }))}
                    aria-describedby="closing-remarks-help" />
                  <small id="closing-remarks-help" style={{ color:'#64748b' }}>At least 10 characters.</small>
                </label>
                <div>
                  <div className="form-label">Links (optional)</div>
                  <div style={{ display:'grid',gap:8 }}>
                    {closureForm.links.map((link,index) => <div key={index} style={{ display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1.5fr) auto',gap:8 }}>
                      <input className="form-control" maxLength="100" aria-label={`Link ${index + 1} label`} placeholder="Label (optional)" value={link.label}
                        onChange={(event) => setClosureForm((current) => ({ ...current,links:current.links.map((item,itemIndex) => itemIndex === index ? { ...item,label:event.target.value } : item) }))} />
                      <input className="form-control" type="url" aria-label={`Link ${index + 1} URL`} placeholder="https://" value={link.url}
                        onChange={(event) => setClosureForm((current) => ({ ...current,links:current.links.map((item,itemIndex) => itemIndex === index ? { ...item,url:event.target.value } : item) }))} />
                      <button className="btn btn-ghost btn-sm" aria-label={`Remove link ${index + 1}`} onClick={() => setClosureForm((current) => ({ ...current,links:current.links.filter((_,itemIndex) => itemIndex !== index) }))}>Remove</button>
                    </div>)}
                  </div>
                  {closureForm.links.length < 10 && <button className="btn btn-ghost btn-sm" style={{ marginTop:8 }}
                    onClick={() => setClosureForm((current) => ({ ...current,links:[...current.links,{ label:'',url:'' }] }))}>Add link</button>}
                </div>
                <div>
                  <div className="form-label">Attachments (optional)</div>
                  <label className="card" style={{ display:'block',padding:14,borderStyle:'dashed',cursor:'pointer' }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => { event.preventDefault(); void uploadClosureFiles(event.dataTransfer.files) }}>
                    <span>Choose files or drag and drop. Any safe file type, up to {project.closureAttachmentLimits?.maxMb || 10} MB each.</span>
                    <input type="file" multiple disabled={!!uploadProgress}
                      onChange={(event) => { void uploadClosureFiles(event.target.files); event.target.value = '' }}
                      style={{ display:'block',marginTop:8 }} />
                  </label>
                  {uploadProgress && <div role="status" aria-live="polite" style={{ marginTop:8 }}>
                    {uploadProgress}<progress aria-label="Attachment upload progress" style={{ width:'100%' }} />
                  </div>}
                  {!!closureFiles.length && <ul style={{ marginTop:8 }}>
                    {closureFiles.map((file) => <li key={file.id} style={{ marginBottom:4 }}>
                      {file.filename} ({(file.sizeBytes / 1024 / 1024).toFixed(2)} MB)
                      <button className="btn btn-ghost btn-sm" disabled={!!uploadProgress} onClick={() => void removeClosureFile(file)}>Remove</button>
                    </li>)}
                  </ul>}
                </div>
                {closureError && <p role="alert" style={{ color:'#b91c1c',margin:0 }}>{closureError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={() => void cancelClosure()} disabled={savingClosure || !!uploadProgress}>Cancel</button>
                <button className="btn btn-primary" onClick={advanceClosure}
                  disabled={savingClosure || !!uploadProgress || (project.blockCloseWithOpenTasks && project.openTaskCount > 0)}>Continue</button>
              </div>
            </>}
            {closureStep === 'confirm' && <>
              <div className="modal-header"><h2 id="project-close-title">Confirm project closure</h2></div>
              <div className="modal-body">
                <p>Are you sure you want to close <strong>{project.name}</strong>?</p>
                {closureError && <p role="alert" style={{ color:'#b91c1c' }}>{closureError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-ghost" disabled={savingClosure} onClick={() => setClosureStep('details')}>Back</button>
                <button className="btn btn-ghost" disabled={savingClosure} onClick={() => void cancelClosure()}>Cancel</button>
                <button className="btn btn-primary" disabled={savingClosure} onClick={confirmProjectClose}>
                  {savingClosure ? 'Closing…' : 'Confirm Close'}
                </button>
              </div>
            </>}
            {closureStep === 'appreciation' && <>
              <div className="modal-header">
                <h2 id="project-close-title" ref={appreciationHeadingRef} tabIndex="-1">Thank you for closing this project!</h2>
              </div>
              <div className="modal-body" role="status">
                <p>Congratulations to {project.name} and the whole team. Thank you for the work that brought this project to completion.</p>
                {closureSummary && <ul>
                  <li>{closureSummary.completionPercent}% complete</li>
                  <li>{closureSummary.completedTasks} of {closureSummary.totalTasks} tasks completed</li>
                  <li>{closureSummary.durationDays} days</li>
                </ul>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-primary" onClick={() => { setClosureStep(''); setClosureSummary(null) }}>View project closure</button>
              </div>
            </>}
          </div>
        </div>
      )}

      {reopenOpen && (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !savingReopen) setReopenOpen(false) }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-reopen-title">
            <div className="modal-header"><h2 id="project-reopen-title">Reopen project</h2></div>
            <div className="modal-body">
              <label className="form-group">
                <span className="form-label">Reopening remarks *</span>
                <textarea className="form-control" rows="4" maxLength="10000" value={reopeningRemarks}
                  onChange={(event) => setReopeningRemarks(event.target.value)} />
                <small style={{ color:'#64748b' }}>At least 10 characters.</small>
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setReopenOpen(false)} disabled={savingReopen}>Cancel</button>
              <button className="btn btn-primary" onClick={reopenProject} disabled={savingReopen || reopeningRemarks.trim().length < 10}>
                {savingReopen ? 'Reopening…' : 'Reopen Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
