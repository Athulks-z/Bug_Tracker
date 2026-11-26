import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import DOMPurify from 'dompurify'
import useAutoRefresh from '../hooks/useAutoRefresh'

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export default function TaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [remarks, setRemarks] = useState('')
  const [comment, setComment] = useState('')
  const [uploading, setUploading] = useState(false)
  const [attachmentAction, setAttachmentAction] = useState('')
  const [preview, setPreview] = useState(null)
  const previewDialogRef = useRef(null)
  const previewReturnFocusRef = useRef(null)

  useEffect(() => {
    if (!preview) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setPreview(null)
        return
      }
      if (event.key !== 'Tab' || !previewDialogRef.current) return
      const focusable = previewDialogRef.current.querySelectorAll('button:not(:disabled), iframe')
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    previewDialogRef.current?.querySelector('button')?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      URL.revokeObjectURL(preview.url)
      previewReturnFocusRef.current?.focus()
    }
  }, [preview])

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      setTask(await api.get(`/tasks/${id}`))
    } catch (err) {
      toast.error(err.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])
  useAutoRefresh(load)

  const recordId = (value) => typeof value === 'object' && value !== null ? value._id : value
  const canAct = task && (['super_admin','admin','manager'].includes(user?.role)
    || [recordId(task.reporter),recordId(task.assignee)].includes(user?._id))

  const rejectTask = async () => {
    if (remarks.trim().length < 3) {
      toast.error('Closing remarks must be at least 3 characters')
      return
    }
    try {
      setTask(await api.post(`/tasks/${id}/reject`, { closingRemarks:remarks.trim() }))
      setRejectOpen(false)
      setRemarks('')
      toast.success('Task rejected')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const reopenTask = async () => {
    try {
      setTask(await api.post(`/tasks/${id}/reopen`))
      toast.success('Task reopened')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const uploadFiles = async (files) => {
    const selected = Array.from(files || []).slice(0, 10 - (task.attachments?.length || 0))
    setUploading(true)
    try {
      for (const file of selected) {
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} exceeds 10 MB`)
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = reject
          reader.onload = () => resolve(reader.result)
          reader.readAsDataURL(file)
        })
        setTask(await api.post(`/tasks/${id}/attachments`, { filename:file.name, mime:file.type, data }))
      }
      toast.success('Attachment uploaded')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setUploading(false)
    }
  }

  const removeAttachment = async (attachmentId) => {
    if (!window.confirm('Delete this attachment?')) return
    try {
      setTask(await api.delete(`/tasks/attachments/${attachmentId}`))
      toast.success('Attachment deleted')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const attachmentPreviewType = (attachment) => {
    const mime = String(attachment.mime || '').toLowerCase().split(';')[0]
    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) return mime
    if (mime === 'application/pdf') return mime
    const extension = String(attachment.filename || '').split('.').pop().toLowerCase()
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)) return `image/${extension === 'jpg' ? 'jpeg' : extension}`
    if (extension === 'pdf') return 'application/pdf'
    return ''
  }

  const downloadAttachment = async (attachment) => {
    setAttachmentAction(attachment._id)
    try {
      const blob = await api.download(`/tasks/attachments/${encodeURIComponent(attachment._id)}/download`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = attachment.filename || 'attachment'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      toast.error(error.message || 'Unable to download attachment')
    } finally {
      setAttachmentAction('')
    }
  }

  const previewAttachment = async (attachment, trigger) => {
    const mime = attachmentPreviewType(attachment)
    if (!mime) return
    previewReturnFocusRef.current = trigger
    setAttachmentAction(attachment._id)
    try {
      const blob = await api.download(`/tasks/attachments/${encodeURIComponent(attachment._id)}/download`)
      setPreview({
        attachmentId: attachment._id,
        filename: attachment.filename || 'Attachment preview',
        mime,
        url: URL.createObjectURL(blob)
      })
    } catch (error) {
      toast.error(error.message || 'Unable to preview attachment')
    } finally {
      setAttachmentAction('')
    }
  }

  const postComment = async () => {
    if (!comment.trim()) return
    try {
      setTask(await api.post(`/tasks/${id}/comments`, { text:comment.trim() }))
      setComment('')
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (loading) return <div className="empty-state" style={{ padding:80 }}>Loading…</div>
  if (!task) return <div className="empty-state" style={{ padding:80 }}>Task not found</div>

  const typeLabel = task.type === 'other'
    ? (task.customTypeName ? `Other: ${task.customTypeName}` : 'Other')
    : (task.typeLabel || task.type || 'Task')

  return (
    <div style={{ padding:28,maxWidth:1100 }}>
      <button className="btn btn-ghost" onClick={() => navigate('/tasks')} style={{ marginBottom:16 }}><i className="ti ti-arrow-left" /> Back to Tasks</button>
      <div className="card" style={{ padding:24 }}>
        <div style={{ display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap' }}>
          <div>
            <span className="badge" style={{ background:'#eff6ff',color:'#1d4ed8',marginBottom:10 }}>{typeLabel}</span>
            <h1 style={{ fontSize:24 }}>{task.title}</h1>
            {task.taskKey && <p style={{ color:'#64748b',fontSize:13,marginTop:4 }}>Task ID: {task.taskKey}</p>}
            <p style={{ color:'#64748b',marginTop:6 }}>{task.project?.name || 'No project'} · {task.status}</p>
          </div>
          {canAct && (
            <div style={{ display:'flex',gap:8,alignItems:'flex-start' }}>
              {task.status === 'Rejected'
                ? <button className="btn btn-primary" onClick={reopenTask}>Reopen</button>
                : <button className="btn" style={{ color:'#dc2626',border:'1px solid #fecaca' }} onClick={() => setRejectOpen(true)}>Reject</button>}
            </div>
          )}
        </div>

        <div style={{ display:'grid',gridTemplateColumns:'2fr 1fr',gap:24,marginTop:24 }}>
          <div>
            <h3 style={{ fontSize:14,marginBottom:10 }}>Description</h3>
            {task.description
              ? <div dangerouslySetInnerHTML={{ __html:DOMPurify.sanitize(task.description,{ADD_ATTR:['target','rel']}) }} style={{ lineHeight:1.65,whiteSpace:'pre-wrap' }} />
              : <p style={{ color:'#94a3b8' }}>No description</p>}

            <h3 style={{ fontSize:14,margin:'24px 0 10px' }}>Comments</h3>
            <div style={{ display:'grid',gap:10,marginBottom:12 }}>
              {(task.comments || []).map((item, index) => (
                <div key={index} style={{ border:'1px solid #e2e8f0',borderRadius:8,padding:10 }}>
                  <strong style={{ fontSize:13 }}>{item.author?.name || 'User'}</strong>
                  <div style={{ fontSize:13,marginTop:4 }}>{item.text}</div>
                </div>
              ))}
            </div>
            <div style={{ display:'flex',gap:8 }}>
              <input className="form-control" placeholder="Add a comment…" value={comment} onChange={(event) => setComment(event.target.value)} />
              <button className="btn btn-primary" onClick={postComment}>Post</button>
            </div>
          </div>

          <aside style={{ display:'grid',gap:14,alignContent:'start' }}>
            <div><strong style={{ fontSize:12,color:'#64748b' }}>Assignee</strong><div>{task.assignee?.name || 'Unassigned'}</div></div>
            <div><strong style={{ fontSize:12,color:'#64748b' }}>Priority</strong><div>{task.priority || '—'}</div></div>
            <div><strong style={{ fontSize:12,color:'#64748b' }}>Start date</strong><div>{task.startDate || 'Today'}</div></div>
            <div><strong style={{ fontSize:12,color:'#64748b' }}>End date</strong><div>{task.endDate || '—'}</div></div>
            {task.type === 'bug' && <div><strong style={{ fontSize:12,color:'#64748b' }}>Severity</strong><div>{task.severity || '—'}</div></div>}
            {task.issueNumber != null && <div><strong style={{ fontSize:12,color:'#64748b' }}>Legacy issue number</strong><div>{task.issueNumber}</div></div>}

            <div>
              <strong style={{ fontSize:12,color:'#64748b' }}>Attachments ({(task.attachments || []).length})</strong>
              <div style={{ display:'grid',gap:6,marginTop:8 }}>
                {(task.attachments || []).length ? (task.attachments || []).map((attachment) => {
                  const previewType = attachmentPreviewType(attachment)
                  const isBusy = attachmentAction === attachment._id
                  const size = Number(attachment.size)
                  const sizeLabel = Number.isFinite(size) && size >= 0
                    ? size < 1024
                      ? `${size} B`
                      : size < 1024 * 1024
                        ? `${Math.round(size / 1024)} KB`
                        : `${(size / (1024 * 1024)).toFixed(1)} MB`
                    : ''
                  return (
                    <div key={attachment._id} className="task-attachment-item">
                      <div className="task-attachment-info">
                        <i className="ti ti-paperclip" aria-hidden="true" />
                        <span title={attachment.filename}>{attachment.filename}</span>
                        {sizeLabel && <small>{sizeLabel}</small>}
                      </div>
                      <div className="task-attachment-actions">
                        {previewType
                          ? <button type="button" className="btn-icon" title={`Preview ${attachment.filename}`} aria-label={`Preview ${attachment.filename}`} disabled={isBusy} onClick={(event) => previewAttachment(attachment, event.currentTarget)}><i className="ti ti-eye" /></button>
                          : <span className="task-attachment-preview-unavailable" title="Preview isn't supported for this file type">No preview</span>}
                        <button type="button" className="btn-icon" title={`Download ${attachment.filename}`} aria-label={`Download ${attachment.filename}`} disabled={isBusy} onClick={() => downloadAttachment(attachment)}><i className="ti ti-download" /></button>
                        {canAct && <button type="button" className="btn-icon" title="Delete attachment" aria-label={`Delete ${attachment.filename}`} disabled={isBusy} onClick={() => removeAttachment(attachment._id)}><i className="ti ti-trash" /></button>}
                      </div>
                    </div>
                  )
                }) : <p style={{ color:'#94a3b8',fontSize:12,marginTop:8 }}>No attachments</p>}
              </div>
              {canAct && <input type="file" multiple disabled={uploading} onChange={(event) => uploadFiles(event.target.files)} style={{ marginTop:10 }} />}
            </div>
          </aside>
        </div>

        <h3 style={{ fontSize:14,margin:'24px 0 10px' }}>History</h3>
        <div style={{ display:'grid',gap:8 }}>
          {(task.activity || []).slice().reverse().map((item, index) => (
            <div key={index} style={{ fontSize:13,color:'#475569' }}>
              <strong>{item.action}</strong>{item.details ? ` · ${item.details}` : ''}
            </div>
          ))}
        </div>
      </div>

      {preview && (
        <div className="attachment-preview-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPreview(null)
        }}>
          <section ref={previewDialogRef} className="attachment-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="attachment-preview-title">
            <header className="attachment-preview-header">
              <div>
                <h2 id="attachment-preview-title">Attachment preview</h2>
                <p title={preview.filename}>{preview.filename}</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Close preview" onClick={() => setPreview(null)}><i className="ti ti-x" /></button>
            </header>
            <div className="attachment-preview-content">
              {preview.mime === 'application/pdf'
                ? <iframe title={`Preview of ${preview.filename}`} src={preview.url} sandbox="" />
                : <img src={preview.url} alt={preview.filename} />}
            </div>
            <footer className="attachment-preview-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setPreview(null)}>Close</button>
              <button type="button" className="btn btn-primary" onClick={() => downloadAttachment({
                _id: preview.attachmentId,
                filename: preview.filename
              })}>Download</button>
            </footer>
          </section>
        </div>
      )}

      {rejectOpen && (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setRejectOpen(false) }}>
          <div className="modal" style={{ maxWidth:520 }}>
            <div className="modal-header"><h3>Reject Task</h3><button className="btn-icon" onClick={() => setRejectOpen(false)}><i className="ti ti-x" /></button></div>
            <div className="form-group">
              <label className="form-label">Closing remarks *</label>
              <textarea className="form-control" rows={5} minLength={3} maxLength={2000} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
              {remarks.trim().length > 0 && remarks.trim().length < 3 && <span style={{ color:'#dc2626',fontSize:12 }}>At least 3 characters are required</span>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setRejectOpen(false)}>Cancel</button>
              <button className="btn" style={{ background:'#dc2626',color:'#fff' }} disabled={remarks.trim().length < 3} onClick={rejectTask}>Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
