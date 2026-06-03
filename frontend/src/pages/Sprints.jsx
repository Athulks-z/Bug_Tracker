import { useState, useEffect } from 'react'
import api from '../api'

export default function Sprints() {
  const [sprints, setSprints] = useState([])
  const [form, setForm] = useState({ name:'', project:'', startDate:'', endDate:'', goal:'' })

  useEffect(() => { api.get('/sprints').then(setSprints).catch(()=>{}) }, [])

  const save = async () => {
    await api.post('/sprints', form)
    setForm({ name:'', project:'', startDate:'', endDate:'', goal:'' })
    api.get('/sprints').then(setSprints).catch(()=>{})
  }

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
        <h1 style={{ fontSize:20, fontWeight:600 }}>Sprints</h1>
      </div>
      <div style={{ display:'grid', gap:12 }}>
        {sprints.map(s => (
          <div key={s._id} className="card">
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontWeight:600 }}>{s.name}</div>
                <div style={{ fontSize:12, color:'#64748b' }}>{s.goal}</div>
              </div>
              <div style={{ fontSize:12, color:'#94a3b8' }}>{s.status}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop:20 }} className="card">
        <h3 style={{ marginBottom:12 }}>Create Sprint</h3>
        <div style={{ display:'grid', gap:8 }}>
          <input className="form-control" placeholder="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
          <input className="form-control" type="date" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))} />
          <input className="form-control" type="date" value={form.endDate} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))} />
          <input className="form-control" placeholder="Goal" value={form.goal} onChange={e=>setForm(f=>({...f,goal:e.target.value}))} />
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <button className="btn btn-primary" onClick={save}>Create</button>
          </div>
        </div>
      </div>
    </div>
  )
}
