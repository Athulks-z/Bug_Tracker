import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'

const STATUSES = ['Open','Triaged','Assigned','In Progress','Code Review','QA Testing','Resolved','Closed','Reopened']
const SEVERITIES = ['Showstopper','Critical','Major','Medium','Low','None']

export default function IssueModal({ issue, projects, users, onSave, onClose }) {
  const { user } = useAuth()
  const [localIssue, setLocalIssue] = useState(issue || null)
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
  const [templates, setTemplates] = useState([])
  const [sprints, setSprints] = useState([])
  const [releases, setReleases] = useState([])
  const [comment, setComment] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    api.get('/templates').then(setTemplates).catch(()=>{})
    api.get('/sprints').then(setSprints).catch(()=>{})
    api.get('/releases').then(setReleases).catch(()=>{})
    setLocalIssue(issue || null)
  }, [issue])

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

  const postComment = async () => {
    if (!localIssue || !comment.trim()) return
    try {
      const res = await api.post(`/issues/${localIssue._id}/comments`, { text: comment })
      setLocalIssue(res)
      setComment('')
    } catch (err) { console.error(err); }
  }

  const uploadFile = async (file) => {
    if (!localIssue || !file) return
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        const data = reader.result
        const res = await api.post(`/issues/${localIssue._id}/attachments`, { filename: file.name, data })
        setLocalIssue(res)
      }
      reader.readAsDataURL(file)
    } catch (err) { console.error(err) }
    setUploading(false)
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
                <label className="form-label">Template</label>
                <select className="form-control" onChange={e => {
                  const id = e.target.value
                  const t = templates.find(x=>x._id===id)
                  if (t) setForm(f => ({ ...f, title: t.fields.title || f.title, description: t.body || f.description }))
                }}>
                  <option value="">Select template (optional)</option>
                  {templates.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                </select>
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
              <div className="form-group">
                <label className="form-label">Sprint</label>
                <select className="form-control" value={form.sprint || ''} onChange={e=>set('sprint', e.target.value)}>
                  <option value="">None</option>
                  {sprints.map(sp => <option key={sp._id} value={sp._id}>{sp.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Target release / Fixed in</label>
                <select className="form-control" value={form.targetRelease || ''} onChange={e=>set('targetRelease', e.target.value)}>
                  <option value="">None</option>
                  {releases.map(r => <option key={r._id} value={r._id}>{r.version || r.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Estimated hours</label>
                <input className="form-control" type="number" min={0} value={form.estimatedHours || ''} onChange={e=>set('estimatedHours', e.target.value)} />
              </div>
            </div>
          </div>
          {localIssue && (
            <>
              <div style={{ borderTop:'1px solid #eef2f6', paddingTop:12, marginTop:8 }}>
                <div style={{ fontSize:12, color:'#64748b', marginBottom:8 }}>Attachments</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                  {(localIssue.attachments || []).map((att, i) => (
                    <a key={i} href={att.path} target="_blank" rel="noreferrer" style={{ fontSize:13, color:'#0f172a' }}>{att.filename}</a>
                  ))}
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <input type="file" onChange={e => uploadFile(e.target.files?.[0])} />
                  {uploading && <div style={{ fontSize:12, color:'#64748b' }}>Uploading…</div>}
                </div>
              </div>

              <div style={{ borderTop:'1px solid #eef2f6', paddingTop:12, marginTop:8 }}>
                <div style={{ fontSize:12, color:'#64748b', marginBottom:8 }}>Comments</div>
                <div style={{ display:'grid', gap:8, maxHeight:200, overflowY:'auto', marginBottom:8 }}>
                  {(localIssue.comments || []).slice().reverse().map((c, idx) => (
                    <div key={idx} style={{ fontSize:13 }}>
                      <strong style={{ color:'#0f172a' }}>{c.author?.name || c.author}</strong>
                      <div style={{ color:'#475569', fontSize:13 }}>{c.text}</div>
                      <div style={{ color:'#94a3b8', fontSize:11 }}>{new Date(c.createdAt).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <input className="form-control" placeholder="Add a comment…" value={comment} onChange={e=>setComment(e.target.value)} />
                  <button className="btn btn-primary" onClick={postComment}>Post</button>
                </div>
              </div>

              <div style={{ borderTop:'1px solid #eef2f6', paddingTop:12, marginTop:8 }}>
                <div style={{ fontSize:12, color:'#64748b', marginBottom:8 }}>Activity</div>
                <div style={{ display:'grid', gap:8, maxHeight:160, overflowY:'auto' }}>
                  {(localIssue.activity || []).slice().reverse().map((a, idx) => (
                    <div key={idx} style={{ fontSize:13, color:'#334155' }}>
                      <strong style={{ color:'#0f172a' }}>{a.action}</strong>
                      <div style={{ color:'#475569', fontSize:12 }}>
                        {a.details}
                      </div>
                      <div style={{ color:'#94a3b8', fontSize:11 }}>
                        {new Date(a.createdAt).toLocaleString()} — {a.user?.name ? <a href={`/users/${a.user._id}`}>{a.user.name}</a> : (a.user || 'Unknown')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
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
