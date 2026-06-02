import { useState, useEffect } from 'react'
import api from '../api'
import { statusBadgeClass, severityBadgeClass, avatarColor, initials } from '../utils'

const SEV_ORDER = ['Showstopper','Major','Medium','Low','None']
const STATUS_COLORS = { Open:'#378add', Reopen:'#e24b4a', 'In progress':'#ef9f27', 'To do':'#1d9e75', Closed:'#9ca3af' }

export default function Reports() {
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/issues').then(r => setIssues(r.data)).finally(()=>setLoading(false))
  }, [])

  const bySev = SEV_ORDER.map(s => ({ label:s, count:issues.filter(i=>i.severity===s).length }))
  const byStatus = Object.keys(STATUS_COLORS).map(s => ({ label:s, count:issues.filter(i=>i.status===s).length }))

  // By assignee
  const assigneeMap = {}
  issues.forEach(i => {
    if (!i.assignee) return
    const key = i.assignee._id
    if (!assigneeMap[key]) assigneeMap[key] = { name:i.assignee.name, total:0, open:0, closed:0 }
    assigneeMap[key].total++
    if (i.status==='Closed') assigneeMap[key].closed++
    else assigneeMap[key].open++
  })
  const byAssignee = Object.values(assigneeMap).sort((a,b)=>b.total-a.total).slice(0,6)

  const max = (arr) => Math.max(...arr.map(x=>x.count), 1)

  if (loading) return <div className="empty-state" style={{ paddingTop:80 }}><i className="ti ti-loader-2" style={{ animation:'spin 1s linear infinite', fontSize:28 }} /><style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style></div>

  return (
    <div style={{ padding:28 }}>
      <h1 style={{ fontSize:20, fontWeight:600, marginBottom:24 }}>Reports</h1>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:20 }}>
        {/* By Status */}
        <div className="card">
          <h3 style={{ fontSize:14, fontWeight:600, marginBottom:18 }}>Issues by Status</h3>
          {byStatus.map(s => (
            <div key={s.label} style={{ marginBottom:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:5 }}>
                <span className={statusBadgeClass(s.label)}>{s.label}</span>
                <span style={{ fontWeight:600 }}>{s.count}</span>
              </div>
              <div style={{ height:8, background:'#f1f5f9', borderRadius:99 }}>
                <div style={{ height:'100%', width:`${(s.count/max(byStatus))*100}%`, background:STATUS_COLORS[s.label], borderRadius:99, transition:'width 0.6s ease' }} />
              </div>
            </div>
          ))}
        </div>

        {/* By Severity */}
        <div className="card">
          <h3 style={{ fontSize:14, fontWeight:600, marginBottom:18 }}>Issues by Severity</h3>
          {bySev.map(s => (
            <div key={s.label} style={{ marginBottom:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:5 }}>
                <span className={severityBadgeClass(s.label)}>{s.label}</span>
                <span style={{ fontWeight:600 }}>{s.count}</span>
              </div>
              <div style={{ height:8, background:'#f1f5f9', borderRadius:99 }}>
                <div style={{ height:'100%', width:`${(s.count/max(bySev))*100}%`, background:'#534ab7', borderRadius:99, transition:'width 0.6s ease' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* By Assignee */}
      {byAssignee.length > 0 && (
        <div className="card" style={{ marginBottom:20 }}>
          <h3 style={{ fontSize:14, fontWeight:600, marginBottom:18 }}>Top Assignees</h3>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px,1fr))', gap:14 }}>
            {byAssignee.map(a => (
              <div key={a.name} style={{ background:'#f7f8fa', borderRadius:10, padding:'14px 16px', display:'flex', alignItems:'center', gap:12 }}>
                <div className="avatar avatar-lg" style={{ background:avatarColor(a.name) }}>{initials(a.name)}</div>
                <div>
                  <div style={{ fontWeight:500, fontSize:13 }}>{a.name}</div>
                  <div style={{ fontSize:12, color:'#6b7280', marginTop:3 }}>
                    <span style={{ color:'#e24b4a', fontWeight:500 }}>{a.open} open</span>
                    {' · '}
                    <span style={{ color:'#1d9e75', fontWeight:500 }}>{a.closed} closed</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary table */}
      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9' }}>
          <h3 style={{ fontSize:14, fontWeight:600 }}>Summary</h3>
        </div>
        <div style={{ padding:20, display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:20, textAlign:'center' }}>
          <div>
            <div style={{ fontSize:36, fontWeight:700, color:'#111827' }}>{issues.length}</div>
            <div style={{ fontSize:13, color:'#6b7280' }}>Total Issues</div>
          </div>
          <div>
            <div style={{ fontSize:36, fontWeight:700, color:'#e24b4a' }}>
              {issues.filter(i=>i.severity==='Showstopper').length}
            </div>
            <div style={{ fontSize:13, color:'#6b7280' }}>Showstoppers</div>
          </div>
          <div>
            <div style={{ fontSize:36, fontWeight:700, color:'#1d9e75' }}>
              {issues.length > 0 ? Math.round((issues.filter(i=>i.status==='Closed').length/issues.length)*100) : 0}%
            </div>
            <div style={{ fontSize:13, color:'#6b7280' }}>Resolution Rate</div>
          </div>
        </div>
      </div>
    </div>
  )
}
