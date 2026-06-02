import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

const STATUSES = ['Open','To do','In progress','Reopen','Closed']
const SEVERITIES = ['Showstopper','Major','Medium','Low','None']

export default function IssueModal({ issue, projects, users, onSave, onClose }) {
  const { user } = useAuth()
  const [form, setForm] = useState({
    title: issue?.title || '',
    description: issue?.description || '',
    project: issue?.project?._id || issue?.project || '',
    assignee: issue?.assignee?._id || issue?.assignee || '',
    status: issue?.status || 'Open',
    severity: issue?.severity || 'Medium',
    dueDate: issue?.dueDate ? issue.dueDate.slice(0,10) : '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const data = { ...form }
    if (!data.assignee) delete data.assignee
    if (!data.dueDate) delete data.dueDate
    await onSave(data)
    setSaving(false)
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-header">
          <h3>{issue ? 'Edit Issue' : 'Submit New Issue'}</h3>
          <button className="btn-icon" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Issue Title *</label>
              <input className="form-control" required placeholder="e.g. Login button not responding"
                value={form.title} onChange={e=>set('title',e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-control" placeholder="Describe the issue in detail…"
                value={form.description} onChange={e=>set('description',e.target.value)} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div className="form-group">
                <label className="form-label">Project *</label>
                <select className="form-control" required value={form.project} onChange={e=>set('project',e.target.value)}>
                  <option value="">Select project</option>
                  {projects.map(p=><option key={p._id} value={p._id}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Assignee</label>
                <select className="form-control" value={form.assignee} onChange={e=>set('assignee',e.target.value)}>
                  <option value="">Unassigned</option>
                  {users.map(u=><option key={u._id} value={u._id}>{u.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-control" value={form.status} onChange={e=>set('status',e.target.value)}>
                  {STATUSES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Severity</label>
                <select className="form-control" value={form.severity} onChange={e=>set('severity',e.target.value)}>
                  {SEVERITIES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Due Date</label>
                <input className="form-control" type="date" value={form.dueDate} onChange={e=>set('dueDate',e.target.value)} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : (issue ? 'Update Issue' : 'Create Issue')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
