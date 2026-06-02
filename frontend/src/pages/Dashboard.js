import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const COLORS = { Open:'#378add', Reopen:'#e24b4a', 'In progress':'#ef9f27', 'To do':'#1d9e75', Closed:'#64748b' };
const SEV_COLORS = { Showstopper:'#e24b4a', Major:'#ef9f27', Medium:'#378add', Low:'#94a3b8', None:'#e2e8f0' };

function StatCard({ label, value, icon, color }) {
  return (
    <div style={{ background:'#fff', borderRadius:12, padding:'20px', border:'1px solid #e2e8f0', display:'flex', alignItems:'center', gap:16 }}>
      <div style={{ width:44, height:44, background:`${color}18`, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <i className={`ti ${icon}`} style={{ fontSize:20, color }} />
      </div>
      <div>
        <div style={{ fontSize:24, fontWeight:700, color:'#1a202c' }}>{value}</div>
        <div style={{ fontSize:13, color:'#64748b', marginTop:1 }}>{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [issues, setIssues] = useState([]);
  const [projects, setProjects] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/issues').then(setIssues).catch(()=>{});
    api.get('/projects').then(setProjects).catch(()=>{});
  }, []);

  const byStatus = {};
  const bySev = {};
  issues.forEach(i => {
    byStatus[i.status] = (byStatus[i.status]||0)+1;
    bySev[i.severity] = (bySev[i.severity]||0)+1;
  });

  const myIssues = issues.filter(i => i.assignee?._id === user?._id || i.assignee === user?._id);

  return (
    <div style={{ padding:28 }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:700, color:'#1a202c' }}>Dashboard</h1>
        <p style={{ color:'#64748b', fontSize:14, marginTop:2 }}>Welcome back, {user?.name}</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:16, marginBottom:28 }}>
        <StatCard label="Total Issues" value={issues.length} icon="ti-bug" color="#378add" />
        <StatCard label="Open" value={byStatus['Open']||0} icon="ti-circle-dot" color="#378add" />
        <StatCard label="In Progress" value={byStatus['In progress']||0} icon="ti-loader" color="#ef9f27" />
        <StatCard label="Closed" value={byStatus['Closed']||0} icon="ti-circle-check" color="#1d9e75" />
        <StatCard label="Projects" value={projects.length} icon="ti-folder" color="#534ab7" />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:28 }}>
        {/* Status breakdown */}
        <div style={{ background:'#fff', borderRadius:12, padding:20, border:'1px solid #e2e8f0' }}>
          <h3 style={{ fontSize:14, fontWeight:600, color:'#1a202c', marginBottom:16 }}>Issues by Status</h3>
          {Object.entries(byStatus).map(([status, count]) => (
            <div key={status} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
              <div style={{ width:10, height:10, borderRadius:'50%', background:COLORS[status]||'#ccc', flexShrink:0 }} />
              <span style={{ flex:1, fontSize:13, color:'#334155' }}>{status}</span>
              <div style={{ background:`${COLORS[status]||'#ccc'}18`, borderRadius:20, padding:'2px 10px', fontSize:12, fontWeight:600, color:COLORS[status]||'#ccc' }}>{count}</div>
              <div style={{ width:80, background:'#f1f5f9', borderRadius:4, height:6, overflow:'hidden' }}>
                <div style={{ width:`${Math.round(count/issues.length*100)}%`, height:'100%', background:COLORS[status]||'#ccc', borderRadius:4 }} />
              </div>
            </div>
          ))}
        </div>

        {/* Severity breakdown */}
        <div style={{ background:'#fff', borderRadius:12, padding:20, border:'1px solid #e2e8f0' }}>
          <h3 style={{ fontSize:14, fontWeight:600, color:'#1a202c', marginBottom:16 }}>Issues by Severity</h3>
          {Object.entries(bySev).map(([sev, count]) => (
            <div key={sev} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
              <div style={{ width:10, height:10, borderRadius:2, background:SEV_COLORS[sev]||'#ccc', flexShrink:0 }} />
              <span style={{ flex:1, fontSize:13, color:'#334155' }}>{sev}</span>
              <div style={{ background:`${SEV_COLORS[sev]||'#ccc'}18`, borderRadius:20, padding:'2px 10px', fontSize:12, fontWeight:600, color:SEV_COLORS[sev]||'#999' }}>{count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Assigned to me */}
      <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <h3 style={{ fontSize:14, fontWeight:600, color:'#1a202c' }}>Assigned to Me ({myIssues.length})</h3>
          <button onClick={()=>navigate('/issues')} style={{ background:'none', border:'1px solid #e2e8f0', padding:'5px 12px', borderRadius:6, fontSize:12, color:'#64748b' }}>View All</button>
        </div>
        {myIssues.length === 0 ? (
          <div style={{ padding:'32px', textAlign:'center', color:'#94a3b8', fontSize:13 }}>No issues assigned to you</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['Issue','Project','Status','Severity'].map(h=>(
                  <th key={h} style={{ padding:'10px 16px', textAlign:'left', color:'#64748b', fontSize:12, fontWeight:500, borderBottom:'1px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {myIssues.slice(0,8).map(i => (
                <tr key={i._id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                  <td style={{ padding:'10px 16px', color:'#1a202c' }}>{i.title}</td>
                  <td style={{ padding:'10px 16px', color:'#64748b' }}>{i.project?.name}</td>
                  <td style={{ padding:'10px 16px' }}><span style={{ background:`${COLORS[i.status]||'#ccc'}18`, color:COLORS[i.status]||'#ccc', padding:'3px 10px', borderRadius:12, fontSize:12 }}>{i.status}</span></td>
                  <td style={{ padding:'10px 16px', color:SEV_COLORS[i.severity]||'#999', fontWeight:500, fontSize:12 }}>{i.severity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
