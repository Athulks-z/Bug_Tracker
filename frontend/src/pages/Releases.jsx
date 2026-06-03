import { useState, useEffect } from 'react'
import api from '../api'

export default function Releases() {
  const [releases, setReleases] = useState([])
  const [form, setForm] = useState({ name:'', version:'', releaseDate:'', description:'' })

  useEffect(() => { api.get('/releases').then(setReleases).catch(()=>{}) }, [])

  const save = async () => {
    await api.post('/releases', form)
    setForm({ name:'', version:'', releaseDate:'', description:'' })
    api.get('/releases').then(setReleases).catch(()=>{})
  }

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
        <h1 style={{ fontSize:20, fontWeight:600 }}>Releases</h1>
      </div>
      <div style={{ display:'grid', gap:12 }}>
        {releases.map(r => (
          <div key={r._id} className="card">
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontWeight:600 }}>{r.version || r.name}</div>
                <div style={{ fontSize:12, color:'#64748b' }}>{r.description}</div>
              </div>
              <div style={{ fontSize:12, color:'#94a3b8' }}>{r.status}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop:20 }} className="card">
        <h3 style={{ marginBottom:12 }}>Create Release</h3>
        <div style={{ display:'grid', gap:8 }}>
          <input className="form-control" placeholder="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
          <input className="form-control" placeholder="Version" value={form.version} onChange={e=>setForm(f=>({...f,version:e.target.value}))} />
          <input className="form-control" type="date" value={form.releaseDate} onChange={e=>setForm(f=>({...f,releaseDate:e.target.value}))} />
          <input className="form-control" placeholder="Description" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} />
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <button className="btn btn-primary" onClick={save}>Create</button>
          </div>
        </div>
      </div>
    </div>
  )
}
