import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import api from '../api'

const EMAIL_EVENTS = [
  { key:'task_assigned',label:'Task assigned',description:'Assignment emails to newly assigned users.' },
  { key:'task_blocked',label:'Task blocked',description:'Emails when a task is marked blocked.' },
  { key:'assignment_rejected',label:'Assignment rejected',description:'Emails when an assignee rejects an assignment.' },
  { key:'project_closed',label:'Project closed',description:'Project closure summary emails.' },
  { key:'announcement',label:'Announcements',description:'Optional emails for published announcements.' }
]
const ANNOUNCEMENT_ROLES = ['super_admin','admin','manager','employee','trainee']
const WARNING = 'The sender mailbox must exist in Microsoft 365 and be permitted for this app (Application Access Policy). Otherwise sending fails with 403.'

const initialForm = () => ({
  title:'',message:'',audienceRole:'all',expiresAt:'',sendEmail:false
})

function Toggle({ checked, disabled, onChange, label }) {
  return (
    <label style={{ display:'flex',alignItems:'center',gap:10,cursor:disabled ? 'not-allowed' : 'pointer',opacity:disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={onChange} aria-label={label} />
      <span>{checked ? 'On' : 'Off'}</span>
    </label>
  )
}

function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return '0 B'
  const units = ['B','KB','MB','GB','TB']
  let value = Number(bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit > 0 ? 1 : 0)} ${units[unit]}`
}

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sender, setSender] = useState('')
  const [testSender, setTestSender] = useState('')
  const [testingSender, setTestingSender] = useState(false)
  const [resettingSender, setResettingSender] = useState(false)
  const [storage, setStorage] = useState(null)
  const [storageLoading, setStorageLoading] = useState(false)
  const [announcements, setAnnouncements] = useState([])
  const [announcementForm, setAnnouncementForm] = useState(initialForm)
  const [editingAnnouncement, setEditingAnnouncement] = useState('')
  const [savingAnnouncement, setSavingAnnouncement] = useState(false)
  const [canChangeSender, setCanChangeSender] = useState(false)

  const loadSettings = async () => {
    setLoading(true)
    try {
      const current = await api.get('/settings')
      setSettings(current)
      setDraft({
        emailEnabled:current.emailEnabled,
        emailEvents:current.emailEvents,
        inAppNotificationsEnabled:current.inAppNotificationsEnabled
      })
      setSender(current.senderSource === 'Custom' ? current.senderEmail : '')
      setTestSender(current.senderSource === 'Custom' ? current.senderEmail : '')
      setCanChangeSender(Boolean(current.canChangeSender))
    } catch (error) {
      toast.error(error.message || 'Unable to load settings')
    } finally {
      setLoading(false)
    }
  }

  const loadStorage = async (forceRefresh = false) => {
    setStorageLoading(true)
    try {
      setStorage(await api.get('/settings/storage-stats',forceRefresh ? { refresh:true } : {}))
    } catch (error) {
      toast.error(error.message || 'Unable to load storage statistics')
    } finally {
      setStorageLoading(false)
    }
  }

  const loadAnnouncements = async () => {
    try {
      setAnnouncements(await api.get('/settings/announcements'))
    } catch (error) {
      toast.error(error.message || 'Unable to load announcements')
    }
  }

  useEffect(() => {
    void loadSettings()
    void loadStorage()
    void loadAnnouncements()
  }, [])

  const dirty = useMemo(() => Boolean(settings && draft && (
    settings.emailEnabled !== draft.emailEnabled
    || settings.inAppNotificationsEnabled !== draft.inAppNotificationsEnabled
    || EMAIL_EVENTS.some(({ key }) => settings.emailEvents?.[key] !== draft.emailEvents?.[key])
  )), [settings, draft])
  const senderDirty = Boolean(canChangeSender && settings && (
    sender.trim().toLowerCase() !== (settings.senderSource === 'Custom' ? settings.senderEmail : '')
    || testSender.trim().toLowerCase() !== (settings.senderSource === 'Custom' ? settings.senderEmail : '')
  ))
  const announcementDirty = Boolean(editingAnnouncement
    || announcementForm.title.trim()
    || announcementForm.message.trim()
    || announcementForm.audienceRole !== 'all'
    || announcementForm.expiresAt
    || announcementForm.sendEmail)
  const hasUnsavedChanges = dirty || senderDirty || announcementDirty

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsavedChanges])

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined
    const guardNavigation = (event) => {
      const link = event.target.closest?.('a[href]')
      if (!link || link.origin !== window.location.origin) return
      if (link.pathname === window.location.pathname && link.search === window.location.search) return
      if (!window.confirm('You have unsaved settings. Leave this page and discard your changes?')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('click',guardNavigation,true)
    return () => document.removeEventListener('click',guardNavigation,true)
  }, [hasUnsavedChanges])

  const updateDraft = (key, value) => setDraft((current) => ({ ...current,[key]:value }))

  const saveSettings = async () => {
    if (!dirty) return
    if (settings.emailEnabled && !draft.emailEnabled
      && !window.confirm('Turn off all outgoing email notifications? In-app notifications will continue.')) return
    setSaving(true)
    try {
      const saved = await api.put('/settings', {
        emailEnabled:draft.emailEnabled,
        emailEvents:draft.emailEvents,
        inAppNotificationsEnabled:draft.inAppNotificationsEnabled
      })
      setSettings(saved)
      setDraft({
        emailEnabled:saved.emailEnabled,
        emailEvents:saved.emailEvents,
        inAppNotificationsEnabled:saved.inAppNotificationsEnabled
      })
      toast.success('Settings saved')
    } catch (error) {
      toast.error(error.message || 'Unable to save settings')
    } finally {
      setSaving(false)
    }
  }

  const sendTestEmail = async () => {
    setTestingSender(true)
    try {
      const result = await api.post('/settings/test-email', { senderEmail:testSender })
      toast.success(result.message)
    } catch (error) {
      toast.error(error.message || 'Test email failed')
    } finally {
      setTestingSender(false)
    }
  }

  const saveSender = async () => {
    const normalized = sender.trim().toLowerCase()
    if (!normalized) {
      toast.error('Enter a custom sender address')
      return
    }
    if (settings.senderSource !== 'Custom' || normalized !== settings.senderEmail) {
      if (!window.confirm(`Change the sender address to ${normalized}? ${WARNING}`)) return
    }
    setSaving(true)
    try {
      const saved = await api.put('/settings', { senderEmail:normalized })
      setSettings((current) => ({ ...current,...saved }))
      setSender(saved.senderEmail)
      setTestSender(saved.senderEmail)
      toast.success('Sender address saved')
    } catch (error) {
      toast.error(error.message || 'Unable to save sender address')
    } finally {
      setSaving(false)
    }
  }

  const resetSender = async () => {
    if (!window.confirm('Use the default sender address from the environment?')) return
    setResettingSender(true)
    try {
      const result = await api.post('/settings/reset-sender', {})
      setSettings((current) => ({ ...current,senderEmail:result.senderEmail,senderSource:result.senderSource }))
      setSender('')
      setTestSender('')
      toast.success('Sender reset to the environment default')
    } catch (error) {
      toast.error(error.message || 'Unable to reset sender address')
    } finally {
      setResettingSender(false)
    }
  }

  const editAnnouncement = (item) => {
    setEditingAnnouncement(item.id)
    setAnnouncementForm({
      title:item.title,
      message:item.message,
      audienceRole:item.audienceRole || 'all',
      expiresAt:item.expiresAt ? new Date(item.expiresAt).toISOString().slice(0,16) : '',
      sendEmail:item.sendEmail
    })
  }

  const saveAnnouncement = async (event) => {
    event.preventDefault()
    setSavingAnnouncement(true)
    try {
      const payload = {
        ...announcementForm,
        expiresAt:announcementForm.expiresAt ? new Date(announcementForm.expiresAt).toISOString() : null
      }
      if (editingAnnouncement) {
        await api.put(`/settings/announcements/${encodeURIComponent(editingAnnouncement)}`, payload)
        toast.success('Announcement updated')
      } else {
        await api.post('/settings/announcements', payload)
        toast.success('Announcement published')
      }
      setAnnouncementForm(initialForm())
      setEditingAnnouncement('')
      await loadAnnouncements()
    } catch (error) {
      toast.error(error.message || 'Unable to save announcement')
    } finally {
      setSavingAnnouncement(false)
    }
  }

  const deleteAnnouncement = async (item) => {
    if (!window.confirm(`Delete "${item.title}"? Users who have not acknowledged it will no longer see it.`)) return
    try {
      await api.delete(`/settings/announcements/${encodeURIComponent(item.id)}`)
      setAnnouncements((current) => current.filter((entry) => entry.id !== item.id))
      toast.success('Announcement deleted')
    } catch (error) {
      toast.error(error.message || 'Unable to delete announcement')
    }
  }

  if (loading) return <div style={{ padding:28,color:'#64748b' }}>Loading settings…</div>
  if (!settings || !draft) return <div style={{ padding:28 }}>Settings could not be loaded.</div>

  const quotaPercent = storage?.limitBytes
    ? Math.min(100,Math.round((storage.totalUsedBytes / storage.limitBytes) * 100))
    : null

  return (
    <div style={{ padding:28,maxWidth:1100,margin:'0 auto' }}>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20 }}>
        <div><h1 style={{ fontSize:22,fontWeight:700 }}>Settings</h1><p style={{ color:'#64748b',fontSize:13 }}>Govern email, notifications, storage, and announcements.</p></div>
        <button className="btn btn-primary" onClick={saveSettings} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      <section className="card" style={{ padding:20,marginBottom:16 }}>
        <h2 style={{ fontSize:17,marginBottom:16 }}>Email and notification controls</h2>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'12px 0',borderBottom:'1px solid #e2e8f0' }}>
          <div><strong>Email notifications</strong><p style={{ color:'#64748b',fontSize:13 }}>Master switch for all outgoing mail.</p></div>
          <Toggle label="Email notifications" checked={draft.emailEnabled} onChange={(event) => updateDraft('emailEnabled',event.target.checked)} />
        </div>
        <div style={{ padding:'12px 0',opacity:draft.emailEnabled ? 1 : 0.55 }}>
          <strong>Per-event email</strong>
          {EMAIL_EVENTS.map((item) => (
            <div key={item.key} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid #f1f5f9' }}>
              <div><div>{item.label}</div><small style={{ color:'#64748b' }}>{item.description}</small></div>
              <Toggle label={`${item.label} emails`} checked={draft.emailEvents?.[item.key] !== false}
                disabled={!draft.emailEnabled}
                onChange={(event) => updateDraft('emailEvents',{ ...draft.emailEvents,[item.key]:event.target.checked })} />
            </div>
          ))}
        </div>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,paddingTop:12 }}>
          <div><strong>In-app notifications</strong><p style={{ color:'#64748b',fontSize:13 }}>Controls the notification list; announcement popups remain available.</p></div>
          <Toggle label="In-app notifications" checked={draft.inAppNotificationsEnabled}
            onChange={(event) => updateDraft('inAppNotificationsEnabled',event.target.checked)} />
        </div>
      </section>

      <section className="card" style={{ padding:20,marginBottom:16 }}>
        <h2 style={{ fontSize:17,marginBottom:6 }}>Sender email address</h2>
        <p style={{ color:'#64748b',fontSize:13,marginBottom:12 }}>
          Current: <strong>{settings.senderEmail || 'Not configured'}</strong> · {settings.senderSource}
        </p>
        <p role="alert" style={{ padding:12,background:'#fffbeb',color:'#92400e',borderRadius:8,fontSize:13,marginBottom:12 }}>{WARNING}</p>
        {canChangeSender ? (
          <>
            <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
              <input className="form-control" style={{ maxWidth:360 }} type="email" autoComplete="email"
                aria-label="Custom sender address" value={sender} onChange={(event) => setSender(event.target.value)} />
              <input className="form-control" style={{ maxWidth:360 }} type="email" autoComplete="email"
                aria-label="Sender address to test" placeholder="Test this sender before saving" value={testSender}
                onChange={(event) => setTestSender(event.target.value)} />
            </div>
            <div style={{ display:'flex',gap:8,flexWrap:'wrap',marginTop:10 }}>
              <button className="btn btn-ghost" onClick={sendTestEmail} disabled={testingSender || !testSender.trim()}>
                {testingSender ? 'Sending test…' : 'Send test email'}
              </button>
              <button className="btn btn-primary" onClick={saveSender} disabled={saving || !sender.trim()}>
                Save sender
              </button>
              <button className="btn btn-ghost" onClick={resetSender} disabled={resettingSender}>
                {resettingSender ? 'Resetting…' : 'Use default (from env)'}
              </button>
            </div>
          </>
        ) : <p style={{ fontSize:13,color:'#64748b' }}>Only a Super Admin can change or reset the sender address.</p>}
      </section>

      <section className="card" style={{ padding:20,marginBottom:16 }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',gap:12 }}>
          <div><h2 style={{ fontSize:17 }}>Storage and database size</h2><p style={{ color:'#64748b',fontSize:13 }}>Read-only PostgreSQL and uploaded-file usage.</p></div>
          <button className="btn btn-ghost" disabled={storageLoading} onClick={() => loadStorage(true)}>{storageLoading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {!storage ? <p style={{ marginTop:14,color:'#64748b' }}>Storage statistics are unavailable.</p> : (
          <>
            <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,margin:'16px 0' }}>
              {[['Database',storage.databaseBytes],['Uploaded files',storage.uploadsBytes],['Total used',storage.totalUsedBytes]].map(([label,bytes]) => (
                <div key={label} style={{ padding:12,background:'#f8fafc',borderRadius:8 }}><small style={{ color:'#64748b' }}>{label}</small><div style={{ fontSize:18,fontWeight:600 }}>{formatBytes(bytes)}</div></div>
              ))}
            </div>
            {storage.limitBytes && <>
              <div style={{ display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6 }}>
                <span>Storage quota</span><span>{formatBytes(storage.totalUsedBytes)} / {formatBytes(storage.limitBytes)} ({quotaPercent}%)</span>
              </div>
              <div role="progressbar" aria-valuenow={quotaPercent} aria-valuemin="0" aria-valuemax="100" style={{ height:9,background:'#e2e8f0',borderRadius:9,overflow:'hidden',marginBottom:12 }}>
                <div style={{ width:`${quotaPercent}%`,height:'100%',background:quotaPercent > 80 ? '#e24b4a' : '#378add' }} />
              </div>
              {quotaPercent > 80 && <p style={{ color:'#b91c1c',fontSize:13,marginBottom:10 }}>Storage usage is above 80% of the configured limit.</p>}
            </>}
            <div className="table-wrap">
              <table><thead><tr><th>Table</th><th>Estimated rows</th><th>Size</th></tr></thead>
                <tbody>{storage.tables.map((table) => <tr key={table.name}><td>{table.name}</td><td>{table.rowCount.toLocaleString()}</td><td>{formatBytes(table.bytes)}</td></tr>)}</tbody>
              </table>
            </div>
            <small style={{ display:'block',color:'#94a3b8',marginTop:8 }}>Last refreshed: {new Date(storage.refreshedAt).toLocaleString()}</small>
          </>
        )}
      </section>

      <section className="card" style={{ padding:20 }}>
        <h2 style={{ fontSize:17,marginBottom:14 }}>Announcements</h2>
        <form onSubmit={saveAnnouncement} style={{ display:'grid',gap:10,marginBottom:20 }}>
          <input className="form-control" maxLength={150} required placeholder="Announcement title"
            value={announcementForm.title} onChange={(event) => setAnnouncementForm((current) => ({ ...current,title:event.target.value }))} />
          <textarea className="form-control" required maxLength={10000} rows={5}
            aria-label="Announcement message" placeholder="Message (plain text; up to 10,000 characters)"
            value={announcementForm.message} onChange={(event) => setAnnouncementForm((current) => ({ ...current,message:event.target.value }))} />
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10 }}>
            <label style={{ display:'grid',gap:5,fontSize:13 }}>Audience
              <select className="form-control" value={announcementForm.audienceRole}
                onChange={(event) => setAnnouncementForm((current) => ({ ...current,audienceRole:event.target.value }))}>
                <option value="all">All active users</option>
                {ANNOUNCEMENT_ROLES.map((role) => <option key={role} value={role}>{role.replace('_',' ')}</option>)}
              </select>
            </label>
            <label style={{ display:'grid',gap:5,fontSize:13 }}>Optional expiry
              <input className="form-control" type="datetime-local" value={announcementForm.expiresAt}
                onChange={(event) => setAnnouncementForm((current) => ({ ...current,expiresAt:event.target.value }))} />
            </label>
          </div>
          <label style={{ display:'flex',alignItems:'center',gap:8,fontSize:13 }}>
            <input type="checkbox" checked={announcementForm.sendEmail}
              onChange={(event) => setAnnouncementForm((current) => ({ ...current,sendEmail:event.target.checked }))} />
            Also send by email (subject to email settings)
          </label>
          <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
            {editingAnnouncement && <button className="btn btn-ghost" type="button" onClick={() => { setEditingAnnouncement('');setAnnouncementForm(initialForm()) }}>Cancel edit</button>}
            <button className="btn btn-primary" type="submit" disabled={savingAnnouncement || !announcementForm.title.trim() || !announcementForm.message.trim()}>
              {savingAnnouncement ? 'Saving…' : editingAnnouncement ? 'Update announcement' : 'Publish announcement'}
            </button>
          </div>
        </form>
        <h3 style={{ fontSize:15,marginBottom:10 }}>Past announcements</h3>
        {!announcements.length ? <p style={{ color:'#64748b',fontSize:13 }}>No announcements yet.</p> : (
          <div style={{ display:'grid',gap:10 }}>
            {announcements.map((item) => (
              <article key={item.id} style={{ border:'1px solid #e2e8f0',borderRadius:8,padding:12 }}>
                <div style={{ display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap' }}>
                  <div><strong>{item.title}</strong><p style={{ whiteSpace:'pre-wrap',fontSize:13,color:'#475569',marginTop:4 }}>{item.message}</p>
                    <small style={{ color:'#64748b' }}>By {item.createdBy || 'Unknown'} · {new Date(item.createdAt).toLocaleString()} · Audience: {item.audience} · {item.acknowledgedCount} of {item.audienceCount} seen{item.expiresAt ? ` · Expires ${new Date(item.expiresAt).toLocaleString()}` : ''}</small>
                  </div>
                  <div style={{ display:'flex',gap:6,alignItems:'flex-start' }}>
                    <button className="btn btn-ghost" onClick={() => editAnnouncement(item)}>Edit</button>
                    <button className="btn btn-ghost" onClick={() => deleteAnnouncement(item)}>Delete</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
