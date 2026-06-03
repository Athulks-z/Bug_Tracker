import React, { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

function Avatar({ url, name }) {
  if (url) {
    return <img src={url} alt={name} style={{ width:120, height:120, borderRadius:'50%', objectFit:'cover', border:'3px solid #fff', boxShadow:'0 20px 40px rgba(15,23,42,.12)' }} />
  }
  const initials = name?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
  return <div style={{ width:120, height:120, borderRadius:'50%', background:'#378add', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:36, fontWeight:700, boxShadow:'0 20px 40px rgba(15,23,42,.12)' }}>{initials}</div>
}

export default function Profile() {
  const { user, updateProfile } = useAuth()
  const [profile, setProfile] = useState(null)
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    api.get('/auth/me').then(setProfile).catch(() => setProfile(user))
    api.get('/projects').then(setProjects).catch(() => {})
    api.get('/users').then(setUsers).catch(() => {})
  }, [user])

  const onChange = (patch) => setProfile(p => ({ ...p, ...patch }))

  const save = async () => {
    if (!profile) return
    if (!profile.name?.trim() || !profile.email?.trim()) {
      toast.error('Name and email are required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        jobTitle: profile.jobTitle,
        domain: profile.domain,
        skills: profile.skills,
        avatar: profile.avatar,
        reportingManager: profile.reportingManager?._id || profile.reportingManager || '',
        assignedProjects: (profile.assignedProjects || []).map(p => p._id || p)
      }
      await updateProfile(payload)
      toast.success('Profile updated')
    } catch (err) {
      toast.error(err.message || 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  if (!profile) return <div style={{ padding:28 }}>Loading profile…</div>

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:24 }}>
        <h1 style={{ fontSize:26, fontWeight:700, color:'#111827' }}>My profile</h1>
        <p style={{ fontSize:14, color:'#64748b', maxWidth:720 }}>Manage your personal resume details, team assignments, and project access from one modern profile dashboard.</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'320px 1fr', gap:24, alignItems:'start' }}>
        <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:18, padding:24, boxShadow:'0 18px 40px rgba(15,23,42,.08)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:18, marginBottom:22 }}>
            <Avatar url={profile.avatar} name={profile.name} />
            <div>
              <div style={{ fontSize:20, fontWeight:700, color:'#111827' }}>{profile.name}</div>
              <div style={{ color:'#475569', marginTop:4 }}>{profile.jobTitle || 'Team member'}</div>
              <div style={{ marginTop:6, fontSize:12, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em' }}>{profile.domain || 'Other'}</div>
            </div>
          </div>

          <div style={{ display:'grid', gap:14 }}>
            <div>
              <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Contact</div>
              <div style={{ color:'#111827', lineHeight:1.8 }}>{profile.email}</div>
              <div style={{ color:'#111827', lineHeight:1.8 }}>{profile.phone || 'No phone added'}</div>
            </div>
            <div>
              <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Reporting manager</div>
              <div style={{ color:'#111827' }}>{profile.reportingManager?.name || 'Unassigned'}</div>
            </div>
            <div>
              <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Assigned projects</div>
              <div style={{ display:'grid', gap:10 }}>
                {(profile.assignedProjects || []).length === 0 && <div style={{ color:'#94a3b8' }}>No projects assigned</div>}
                {(profile.assignedProjects || []).map((project, index) => (
                  <div key={`${project?._id||project}-${index}`} style={{ background:'#eef2ff', color:'#3730a3', borderRadius:999, padding:'8px 12px', fontSize:12, display:'inline-flex' }}>{project?.name || project}</div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Skills</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {(profile.skills || 'No skills added').split(',').map((skill, index) => skill.trim() ? (
                  <div key={index} style={{ background:'#f8fafc', padding:'8px 12px', borderRadius:999, fontSize:12, color:'#475569' }}>{skill.trim()}</div>
                ) : null)}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display:'grid', gap:24 }}>
          <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:18, padding:24, boxShadow:'0 18px 40px rgba(15,23,42,.08)' }}>
            <div style={{ fontSize:12, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:16 }}>Edit profile</div>
            <div style={{ display:'grid', gap:16 }}>
              <div className="form-group">
                <label className="form-label">Avatar URL</label>
                <input className="form-control" value={profile.avatar || ''} onChange={e => onChange({ avatar: e.target.value })} placeholder="Paste image URL" />
              </div>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-control" value={profile.name || ''} onChange={e => onChange({ name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Job title</label>
                <input className="form-control" value={profile.jobTitle || ''} onChange={e => onChange({ jobTitle: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Domain</label>
                <select className="form-control" value={profile.domain || 'Other'} onChange={e => onChange({ domain: e.target.value })}>
                  <option>Firmware</option>
                  <option>Hardware</option>
                  <option>Project Manager</option>
                  <option>Tester</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-control" value={profile.email || ''} onChange={e => onChange({ email: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-control" value={profile.phone || ''} onChange={e => onChange({ phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Professional summary / skills</label>
                <textarea className="form-control" rows={5} value={profile.skills || ''} onChange={e => onChange({ skills: e.target.value })} placeholder="React, Embedded systems, QA automation" />
              </div>
              <div className="form-group">
                <label className="form-label">Reporting manager</label>
                <select className="form-control" value={profile.reportingManager?._id || profile.reportingManager || ''} onChange={e => onChange({ reportingManager: e.target.value })}>
                  <option value="">None</option>
                  {users.filter(u => u._id !== profile._id).map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
                </select>
              </div>
              <div style={{ border:'1px solid #e2e8f0', borderRadius:14, padding:16 }}>
                <div style={{ fontSize:12, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Assigned projects</div>
                <div style={{ display:'grid', gap:10, maxHeight:180, overflowY:'auto' }}>
                  {projects.map(project => {
                    const selected = (profile.assignedProjects || []).some(ap => (ap._id || ap) === project._id)
                    return (
                      <label key={project._id} style={{ display:'flex', alignItems:'center', gap:10, color:'#334155' }}>
                        <input type="checkbox" checked={selected} onChange={() => onChange({ assignedProjects: selected ? (profile.assignedProjects || []).filter(ap => (ap._id||ap) !== project._id) : [ ...(profile.assignedProjects || []), project._id ] })} />
                        <span>{project.name}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:12 }}>
                <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
