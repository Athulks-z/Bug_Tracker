import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import { fmtDate } from '../utils'
import RichTextEditor from '../components/RichTextEditor'

const STATUSES = ['Open','To do','In Progress','In progress','Blocked','Completed','Closed','Rejected','Code Review','QA Testing','Reopened']
const PRIORITIES = ['Critical','High','Medium','Low']
const STATUS_GROUPS = ['Open','In Progress','Completed/Closed','Rejected']
const SEVERITIES = ['Showstopper','Critical','Major','Medium','Low','None']

const today = () => new Date().toISOString().slice(0, 10)

export default function Tasks() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editTask, setEditTask] = useState(null)
  const [saving, setSaving] = useState(false)
  const [pendingFiles, setPendingFiles] = useState([])
  const [uploadProgress, setUploadProgress] = useState({})
  const [page, setPage] = useState(Number(searchParams.get('page') || 1))
  const [total, setTotal] = useState(0)
  const pageSize = 50
  const showTeamControls = ['super_admin','admin','manager'].includes(user?.role)

  const [filters, setFilters] = useState({
    project: searchParams.get('project') || '',
    status: searchParams.get('status') || '',
    statusGroup: searchParams.get('statusGroup') || '',
    assignee: searchParams.getAll('assignee'),
    search: searchParams.get('search') || '',
    customTypeName: searchParams.get('customTypeName') || '',
    type: searchParams.getAll('type')
  })
  const [form, setForm] = useState({
    title:'', description:'', type:'', customTypeName:'', project:'',
    assignee:'', status:'To do', priority:'Medium', startDate:'', endDate:'',
    severity:'', foundInVersion:'', fixedInVersion:'', targetRelease:'', sprint:'', estimatedHours:''
  })

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const params = { ...filters, limit: pageSize, page }
      const [items, count] = await Promise.all([
        api.get('/tasks', params),
        api.get('/tasks/stats/count', params)
      ])
      setTasks(items)
      setTotal(count.total)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  useEffect(() => {
    api.get('/projects').then(setProjects).catch(() => {})
    api.get('/users', { taskAssignees:true }).then(setUsers).catch(() => {})
    api.get('/tasks/types').then(setTypes).catch(() => {})
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => params.append(key, item))
      } else if (value) {
        params.set(key, value)
      }
    })
    if (page > 1) params.set('page', String(page))
    setSearchParams(params, { replace:true })
  }, [filters, page, setSearchParams])

  const openNew = () => {
    setEditTask(null)
    setPendingFiles([])
    setForm({
      title:'', description:'', type:'', customTypeName:'', project:'',
      assignee:'', status:'To do', priority:'Medium', startDate:today(), endDate:'',
      severity:'', foundInVersion:'', fixedInVersion:'', targetRelease:'', sprint:'', estimatedHours:''
    })
    setShowModal(true)
  }

  const openEdit = (task) => {
    setEditTask(task)
    setPendingFiles([])
    setForm({
      title:task.title || '', description:task.description || '', type:task.type || '',
      customTypeName:task.customTypeName || '', project:task.project?._id || task.project || '',
      assignee:task.assignee?._id || task.assignee || '', status:task.status || 'To do',
      priority:task.priority || 'Medium', startDate:task.startDate ? task.startDate.slice(0,10) : today(),
      endDate:task.endDate ? task.endDate.slice(0,10) : '', severity:task.severity || '',
      foundInVersion:task.foundInVersion || '', fixedInVersion:task.fixedInVersion || '',
      targetRelease:task.targetRelease || '', sprint:task.sprint || '',
      estimatedHours:task.estimatedHours || ''
    })
    setShowModal(true)
  }

  const inlineErrors = useMemo(() => {
    const errors = {}
    if (!form.type) errors.type = 'Type is required'
    if (form.type === 'other' && !form.customTypeName.trim()) errors.customTypeName = 'Specify type is required'
    if (form.type === 'other' && form.customTypeName.length > 100) errors.customTypeName = 'Maximum 100 characters'
    if (!form.title.trim()) errors.title = 'Title is required'
    if (!form.project) errors.project = 'Project is required'
    return errors
  }, [form])

  const uploadPending = async (taskId) => {
    for (let index = 0; index < pendingFiles.length; index += 1) {
      const file = pendingFiles[index]
      setUploadProgress((progress) => ({ ...progress, [file.name]: 10 }))
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = reject
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(file)
      })
      setUploadProgress((progress) => ({ ...progress, [file.name]: 75 }))
      await api.post(`/tasks/${taskId}/attachments`, { filename:file.name, mime:file.type, data })
      setUploadProgress((progress) => ({ ...progress, [file.name]: 100 }))
    }
  }

  const save = async () => {
    if (Object.keys(inlineErrors).length) {
      toast.error(inlineErrors.title || inlineErrors.type || inlineErrors.project || inlineErrors.customTypeName)
      return
    }
    setSaving(true)
    try {
      const payload = { ...form }
      payload.startDate = payload.startDate || today()
      if (!payload.assignee) delete payload.assignee
      if (payload.type !== 'bug') payload.severity = ''
      if (payload.type !== 'other') payload.customTypeName = ''
      const result = editTask
        ? await api.put(`/tasks/${editTask._id}`, payload)
        : await api.post('/tasks', payload)
      if (!editTask) await uploadPending(result._id)
      toast.success(editTask ? 'Task updated' : 'Task created')
      setShowModal(false)
      setPendingFiles([])
      setUploadProgress({})
      await loadTasks()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (task) => {
    if (!window.confirm('Delete this task?')) return
    await api.delete(`/tasks/${task._id}`)
    toast.success('Task deleted')
    await loadTasks()
  }

  const addFiles = (files) => {
    const incoming = Array.from(files || [])
    const combined = [...pendingFiles, ...incoming].slice(0, 10)
    setPendingFiles(combined)
  }

  const typeLabel = (task) => task.type === 'other'
    ? (task.customTypeName ? `Other: ${task.customTypeName}` : 'Other')
    : (task.typeLabel || task.type || 'Task')

  const recordId = (value) => typeof value === 'object' && value !== null ? value._id : value
  const canManage = (task) => ['super_admin','admin'].includes(user?.role)
    || (user?.role === 'manager' && (task.project?.owner?._id === user?._id
      || (task.project?.members || []).some((member) => recordId(member) === user?._id)))

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:22 }}>
        <div><h1 style={{ fontSize:22,fontWeight:700 }}>Tasks</h1><p style={{ color:'#64748b',fontSize:13 }}>{total} tasks</p></div>
        {user?.role !== 'trainee' && <button className="btn btn-primary" onClick={openNew}><i className="ti ti-plus" /> New Task</button>}
      </div>

      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:18 }}>
        <input className="form-control" placeholder="Search tasks…" value={filters.search}
          onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, search:event.target.value })) }} />
        <select className="form-control" value={filters.project}
          onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, project:event.target.value })) }}>
          <option value="">All projects</option>{projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
        </select>
        <select className="form-control" value={filters.status}
          onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, status:event.target.value })) }}>
          <option value="">All statuses</option>{STATUSES.map((status) => <option key={status}>{status}</option>)}
        </select>
        <select className="form-control" value={filters.statusGroup}
          onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, statusGroup:event.target.value })) }}>
          <option value="">All status groups</option>{STATUS_GROUPS.map((group) => <option key={group}>{group}</option>)}
        </select>
        {showTeamControls && <select className="form-control" multiple size={3} aria-label="Filter by assignee"
          value={filters.assignee}
          onChange={(event) => {
            setPage(1)
            setFilters((current) => ({ ...current, assignee:Array.from(event.target.selectedOptions, (option) => option.value) }))
          }}>
          {users.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
        </select>}
        <select className="form-control" multiple size={3} aria-label="Filter by type"
          value={filters.type}
          onChange={(event) => {
            setPage(1)
            setFilters((current) => ({ ...current, type:Array.from(event.target.selectedOptions, (option) => option.value) }))
          }}>
          {types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
      </div>

      <div className="card" style={{ overflow:'hidden' }}>
        <div className="table-wrap">
          <table>
            <thead><tr>{['Task','Type','Project',...(showTeamControls ? ['Assignee'] : []),'Status','Priority','Start','End',''].map((header) => <th key={header}>{header}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={showTeamControls ? 9 : 8} style={{ textAlign:'center',padding:40 }}>Loading…</td></tr>
              : tasks.length === 0 ? <tr><td colSpan={showTeamControls ? 9 : 8} style={{ textAlign:'center',padding:40,color:'#64748b' }}>No tasks found</td></tr>
              : tasks.map((task) => (
                <tr key={task._id} onDoubleClick={() => navigate(`/tasks/${task._id}`)} style={{ cursor:'pointer' }}>
                  <td onClick={() => navigate(`/tasks/${task._id}`)}><div style={{ fontWeight:600 }}>{task.title}</div></td>
                  <td><span className="badge" style={{ background:'#eff6ff',color:'#1d4ed8' }}>{typeLabel(task)}</span></td>
                  <td>{task.project?.name || '—'}</td>
                  {showTeamControls && <td>{task.assignee?.name || 'Unassigned'}</td>}
                  <td>{task.status}</td>
                  <td>{task.priority}</td>
                  <td>{task.startDate ? fmtDate(task.startDate) : '—'}</td>
                  <td>{task.endDate ? fmtDate(task.endDate) : '—'}</td>
                  <td>
                    {(canManage(task) || [recordId(task.reporter),recordId(task.assignee)].includes(user?._id)) &&
                      <button className="btn-icon" title="Edit" onClick={(event) => { event.stopPropagation(); openEdit(task) }}><i className="ti ti-edit" /></button>}
                    {canManage(task) && <button className="btn-icon" title="Delete" onClick={(event) => { event.stopPropagation(); remove(task) }}><i className="ti ti-trash" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ display:'flex',justifyContent:'flex-end',gap:8,marginTop:12 }}>
        <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1,value-1))}>Previous</button>
        <span style={{ alignSelf:'center',fontSize:13,color:'#64748b' }}>Page {page}</span>
        <button className="btn btn-ghost" disabled={page * pageSize >= total} onClick={() => setPage((value) => value+1)}>Next</button>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setShowModal(false) }}>
          <div className="modal" style={{ maxWidth:760 }}>
            <div className="modal-header"><h3>{editTask ? 'Edit Task' : 'Assign Task'}</h3><button className="btn-icon" onClick={() => setShowModal(false)}><i className="ti ti-x" /></button></div>
            <div className="modal-body" style={{ maxHeight:'70vh',overflowY:'auto' }}>
              <div className="form-group">
                <label className="form-label">Title *</label>
                <input className="form-control" value={form.title} onChange={(event) => setForm((current) => ({ ...current,title:event.target.value }))} />
                {inlineErrors.title && <span style={{ color:'#dc2626',fontSize:12 }}>{inlineErrors.title}</span>}
              </div>
              <RichTextEditor label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current,description:value }))} />

              <div className="form-group" style={{ marginTop:12 }}>
                <label className="form-label">Type *</label>
                <select className="form-control" value={form.type} onChange={(event) => setForm((current) => ({
                  ...current,type:event.target.value,
                  customTypeName:event.target.value === 'other' ? current.customTypeName : '',
                  severity:event.target.value === 'bug' ? current.severity : ''
                }))}>
                  <option value="">Select type</option>
                  {types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                {inlineErrors.type && <span style={{ color:'#dc2626',fontSize:12 }}>{inlineErrors.type}</span>}
              </div>
              {form.type === 'other' && (
                <div className="form-group">
                  <label className="form-label">Specify type *</label>
                  <input className="form-control" maxLength={100} value={form.customTypeName}
                    onChange={(event) => setForm((current) => ({ ...current,customTypeName:event.target.value }))} />
                  {inlineErrors.customTypeName && <span style={{ color:'#dc2626',fontSize:12 }}>{inlineErrors.customTypeName}</span>}
                </div>
              )}

              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
                <div className="form-group"><label className="form-label">Project *</label>
                  <select className="form-control" value={form.project} onChange={(event) => setForm((current) => ({ ...current,project:event.target.value }))}>
                    <option value="">Select project</option>{projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
                  </select>{inlineErrors.project && <span style={{ color:'#dc2626',fontSize:12 }}>{inlineErrors.project}</span>}
                </div>
                <div className="form-group"><label className="form-label">Assignee</label>
                  <select className="form-control" value={form.assignee} onChange={(event) => setForm((current) => ({ ...current,assignee:event.target.value }))}>
                    <option value="">Unassigned</option>{users.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                  </select>
                </div>
                {form.type === 'bug' && <div className="form-group"><label className="form-label">Severity</label>
                  <select className="form-control" value={form.severity} onChange={(event) => setForm((current) => ({ ...current,severity:event.target.value }))}>
                    <option value="">Select severity</option>{SEVERITIES.map((severity) => <option key={severity}>{severity}</option>)}
                  </select>
                </div>}
                <div className="form-group"><label className="form-label">Status</label>
                  <select className="form-control" value={form.status} onChange={(event) => setForm((current) => ({ ...current,status:event.target.value }))}>
                    {STATUSES.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Priority</label>
                  <select className="form-control" value={form.priority} onChange={(event) => setForm((current) => ({ ...current,priority:event.target.value }))}>
                    {PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Start Date</label>
                  <input className="form-control" type="date" placeholder={today()} value={form.startDate} onChange={(event) => setForm((current) => ({ ...current,startDate:event.target.value }))} />
                </div>
                <div className="form-group"><label className="form-label">End Date</label>
                  <input className="form-control" type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current,endDate:event.target.value }))} /></div>
              </div>

              <div className="form-group">
                <label className="form-label">Attachments</label>
                <div
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}
                  style={{ border:'1px dashed #94a3b8',borderRadius:8,padding:16,textAlign:'center',background:'#f8fafc' }}>
                  <input type="file" multiple onChange={(event) => addFiles(event.target.files)} />
                  <div style={{ fontSize:12,color:'#64748b',marginTop:6 }}>Drag and drop files here; 10 MB per file, maximum 10 files</div>
                </div>
                {pendingFiles.map((file) => (
                  <div key={file.name} style={{ display:'flex',alignItems:'center',gap:8,marginTop:8,fontSize:13 }}>
                    <span style={{ flex:1 }}>{file.name}</span>
                    {uploadProgress[file.name] !== undefined && <span>{uploadProgress[file.name]}%</span>}
                    <button type="button" className="btn-icon" onClick={() => setPendingFiles((current) => current.filter((item) => item !== file))}><i className="ti ti-x" /></button>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : (editTask ? 'Update Task' : 'Create Task')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
