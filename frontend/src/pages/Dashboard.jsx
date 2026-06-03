import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { statusBadgeClass, severityBadgeClass, fmtDate, avatarColor, initials } from '../utils'

const STATUS_COLORS = { Open:'#378add', Reopen:'#e24b4a', 'In progress':'#ef9f27', 'To do':'#1d9e75', Closed:'#9ca3af' }

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState([])
  const [recent, setRecent] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/issues/stats/overview'),
      api.get('/issues?limit=8'),
      api.get('/projects'),
    ]).then(([ov, i, p]) => {
      // map overview into small stats shape for compatibility
      const s = []
      s.push({ _id: 'Open', count: ov.open })
      s.push({ _id: 'In progress', count: ov['In Progress'] || ov.inProgress || ov.open })
      s.push({ _id: 'Closed', count: ov.closed })
      setStats(s)
      setRecent(i.slice ? i.slice(0, 8) : (i.data || []).slice(0,8))
      setProjects(p.slice ? p.slice(0,4) : (p.data || []).slice(0,4))
    }).finally(() => setLoading(false))
  }, [])

  const statMap = {}
  stats.forEach(s => { statMap[s._id] = s.count })
  const totalOpen = (statMap['Open']||0) + (statMap['Reopen']||0) + (statMap['In progress']||0)

  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#9ca3af' }}><i className="ti ti-loader-2" style={{ fontSize:24, animation:'spin 1s linear infinite' }} /><style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style></div>

  return (
    <div style={{ padding:28, maxWidth:1200 }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:20, fontWeight:600 }}>Good {greeting()}, {user?.name?.split(' ')[0]} 👋</h1>
        <p style={{ color:'#6b7280', fontSize:13, marginTop:4 }}>Here's what's happening across your projects.</p>
      </div>

      {/* Stat cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px,1fr))', gap:14, marginBottom:28 }}>
        {[
          { label:'Open Issues', value: totalOpen, color:'#e24b4a', icon:'ti-bug' },
          { label:'In Progress', value: statMap['In progress']||0, color:'#ef9f27', icon:'ti-player-play' },
          { label:'Closed', value: statMap['Closed']||0, color:'#1d9e75', icon:'ti-check' },
          { label:'Projects', value: projects.length, color:'#534ab7', icon:'ti-folder' },
        ].map(s => (
          <div key={s.label} className="card" style={{ display:'flex', alignItems:'center', gap:14 }}>
            <div style={{ width:44, height:44, borderRadius:10, background:s.color+'18', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, color:s.color }}>
              <i className={`ti ${s.icon}`} />
            </div>
            <div>
              <div style={{ fontSize:24, fontWeight:700, lineHeight:1 }}>{s.value}</div>
              <div style={{ fontSize:12, color:'#6b7280', marginTop:3 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:20 }}>
        {/* Recent issues */}
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid #f1f5f9' }}>
            <h2 style={{ fontSize:14, fontWeight:600 }}>Recent Issues</h2>
            <Link to="/issues" style={{ fontSize:12, color:'#378add' }}>View all →</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Issue</th><th>Status</th><th>Severity</th><th>Assignee</th><th>Date</th>
              </tr></thead>
              <tbody>
                {recent.map(i => (
                  <tr key={i._id}>
                    <td>
                      <div style={{ fontWeight:500, color:'#111827', maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{i.title}</div>
                      <div style={{ fontSize:11, color:'#9ca3af' }}>{i.project?.prefix}-{i.issueNumber}</div>
                    </td>
                    <td><span className={statusBadgeClass(i.status)}>{i.status}</span></td>
                    <td><span className={severityBadgeClass(i.severity)}>{i.severity}</span></td>
                    <td>
                      {i.assignee ? (
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <div className="avatar" style={{ background:avatarColor(i.assignee.name) }}>{initials(i.assignee.name)}</div>
                          <span style={{ fontSize:12 }}>{i.assignee.name}</span>
                        </div>
                      ) : <span style={{ color:'#9ca3af', fontSize:12 }}>—</span>}
                    </td>
                    <td style={{ color:'#9ca3af', fontSize:12 }}>{fmtDate(i.createdAt)}</td>
                  </tr>
                ))}
                {recent.length === 0 && <tr><td colSpan={5}><div className="empty-state"><i className="ti ti-inbox" /><p>No issues yet</p></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Projects */}
        <div>
          <div className="card" style={{ padding:0, overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid #f1f5f9' }}>
              <h2 style={{ fontSize:14, fontWeight:600 }}>Projects</h2>
              <Link to="/projects" style={{ fontSize:12, color:'#378add' }}>View all →</Link>
            </div>
            {projects.length === 0 && <div className="empty-state"><i className="ti ti-folder" /><p>No projects yet</p></div>}
            {projects.map(p => (
              <Link key={p._id} to={`/projects/${p._id}`} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 20px', borderBottom:'1px solid #f1f5f9', color:'inherit', textDecoration:'none' }}>
                <div style={{ width:10, height:10, borderRadius:3, background:p.color||'#378add', flexShrink:0 }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:500, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize:11, color:'#9ca3af' }}>{p.prefix}</div>
                </div>
                <i className="ti ti-chevron-right" style={{ color:'#d1d5db', fontSize:14 }} />
              </Link>
            ))}
          </div>

          {/* Status breakdown */}
          {stats.length > 0 && (
            <div className="card" style={{ marginTop:16 }}>
              <h3 style={{ fontSize:13, fontWeight:600, marginBottom:14 }}>Issue Breakdown</h3>
              {Object.entries(STATUS_COLORS).map(([s, c]) => {
                const count = statMap[s]||0
                const total = stats.reduce((a,x)=>a+x.count,0)||1
                return (
                  <div key={s} style={{ marginBottom:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                      <span style={{ color:'#4b5563' }}>{s}</span>
                      <span style={{ fontWeight:500 }}>{count}</span>
                    </div>
                    <div style={{ height:5, background:'#f1f5f9', borderRadius:99 }}>
                      <div style={{ height:'100%', width:`${(count/total)*100}%`, background:c, borderRadius:99, transition:'width 0.5s' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
