import React, { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

export default function Profile() {
  const { user } = useAuth()
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
    setSaving(true)
    try {
      const payload = {
        name: profile.name,
        email: profile.email,
        jobTitle: profile.jobTitle,
        domain: profile.domain,
        phone: profile.phone,
        skills: profile.skills,
        reportingManager: profile.reportingManager?._id || profile.reportingManager || '',
        assignedProjects: (profile.assignedProjects || []).map(p => p._id || p)
      }
      await api.put(`/users/${profile._id}`, payload)
      toast.success('Profile updated; reloading to refresh session')
      window.location.reload()
    } catch (err) {
      toast.error(err.message || 'Failed to update')
    } finally { setSaving(false) }
  }

  if (!profile) return <div style={{ padding:28 }}>Loading profile…</div>

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700 }}>My Profile</h1>
          <p style={{ color:'#64748b', marginTop:4 }}>Manage your contact and job information</p>
        </div>
      </div>

      <div style={{ maxWidth:860, background:'#fff', padding:20, borderRadius:12, border:'1px solid #e2e8f0' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div style={{ gridColumn:'1/-1' }}>
            <label style={{ display:'block', fontSize:11, color:'#64748b', marginBottom:6 }}>Full name</label>
            <input value={profile.name||''} onChange={e=>onChange({ name: e.target.value })} style={{ width:'100%', padding:9, border:'1px solid #e2e8f0', borderRadius:8 }} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:11, color:'#64748b', marginBottom:6 }}>Email</label>
            <input value={profile.email||''} onChange={e=>onChange({ email: e.target.value })} style={{ width:'100%', padding:9, border:'1px solid #e2e8f0', borderRadius:8 }} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:11, color:'#64748b', marginBottom:6 }}>Phone</label>
            <input value={profile.phone||''} onChange={e=>onChange({ phone: e.target.value })} style={{ width:'100%', padding:9, border:'1px solid #e2e8f0', borderRadius:8 }} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:11, color:'#64748b', marginBottom:6 }}>Job title</label>
            <input value={profile.jobTitle||''} onChange={e=>onChange({ jobTitle: e.target.value })} style={{ width:'100%', padding:9, border:'1px solid #e2e8f0', borderRadius:8 }} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:11, color:'#64748b', marginBottom:6 }}>Domain</label>
            <select value={profile.domain||'Other'} onChange={e=>onChange({ domain: e.target.value })} style={{ width:'100%', padding:9, border:'1px solid #e2e8f0', borderRadius:8 }}>
              <option>Firmware</option>
              <option>Hardware</option>
              <option>Project Manager</option>
              <option>Tester</option>
              <option>Other</option>
            </select>
          </div>

          <div style={{ gridColumn:'1/-1' }}>
            <label style={{ display:'block', fontSize:11, color:'#64748b', marginBottom:6 }}>Skills</label>
            <textarea value={profile.skills||''} onChange={e=>onChange({ skills: e.target.value })} style={{ width:'100%', minHeight:80, padding:9, border:'1px solid #e2e8f0', borderRadius:8 }} />
          </div>

          <div style={{ gridColumn:'1/-1' }}>
            <label style={{ display:'block', fontSize:11, color:'#64748b', marginBottom:6 }}>Reporting manager</label>
            <select value={profile.reportingManager?._id || profile.reportingManager || ''} onChange={e=>onChange({ reportingManager: e.target.value })} style={{ width:'100%', padding:9, border:'1px solid #e2e8f0', borderRadius:8 }}>
              <option value="">None</option>
              {users.filter(u => u._id !== profile._id).map(u => (
                <option key={u._id} value={u._id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div style={{ gridColumn:'1/-1' }}>
            <label style={{ display:'block', fontSize:11, color:'#64748b', marginBottom:6 }}>Assigned projects</label>
            <div style={{ border:'1px solid #e2e8f0', borderRadius:8, padding:10, maxHeight:160, overflowY:'auto' }}>
              {projects.map(p => (
                <label key={p._id} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <input type="checkbox" checked={(profile.assignedProjects||[]).some(ap => (ap._id||ap) === p._id)} onChange={() => {
                    const has = (profile.assignedProjects||[]).some(ap => (ap._id||ap) === p._id)
                    onChange({ assignedProjects: has ? (profile.assignedProjects||[]).filter(ap => (ap._id||ap) !== p._id) : [ ...(profile.assignedProjects||[]), p._id ] })
                  }} />
                  <span style={{ fontSize:13 }}>{p.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ gridColumn:'1/-1', display:'flex', justifyContent:'flex-end', gap:8, marginTop:8 }}>
            <button onClick={() => window.location.reload()} className="btn">Cancel</button>
            <button onClick={save} className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
