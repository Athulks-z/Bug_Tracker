import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const COLORS = ['#378add','#1d9e75','#ef9f27','#e24b4a','#534ab7','#0891b2','#64748b'];
const isTeamRole = (role) => ['super_admin','admin','manager'].includes(role);
function StatCard({ label, value, icon, color, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      background:'#fff', borderRadius:12, padding:20, border:'1px solid #e2e8f0',
      display:'flex', alignItems:'center', gap:16, textAlign:'left', cursor:'pointer'
    }}>
      <div style={{ width:44,height:44,background:`${color}18`,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
        <i className={`ti ${icon}`} style={{ fontSize:20,color }} />
      </div>
      <div>
        <div style={{ fontSize:24,fontWeight:700,color:'#1a202c' }}>{value ?? 0}</div>
        <div style={{ fontSize:13,color:'#64748b',marginTop:1 }}>{label}</div>
      </div>
    </button>
  );
}

function Panel({ title, children }) {
  return (
    <section style={{ background:'#fff',borderRadius:12,padding:20,border:'1px solid #e2e8f0',minWidth:0 }}>
      <h2 style={{ fontSize:14,fontWeight:600,color:'#1a202c',margin:'0 0 16px' }}>{title}</h2>
      {children}
    </section>
  );
}

function Breakdown({ entries, getHref, emptyText }) {
  const maximum = Math.max(1, ...entries.map((entry) => Number(entry.count) || 0));
  if (!entries.length) return <p style={{ color:'#94a3b8',fontSize:13 }}>{emptyText}</p>;
  return entries.map((entry, index) => (
    <button key={`${entry.key || entry.type || entry.id || entry.label}-${index}`}
      type="button" onClick={() => getHref && getHref(entry)}
      style={{ display:'flex',alignItems:'center',gap:10,width:'100%',padding:'7px 0',border:0,background:'transparent',textAlign:'left',cursor:getHref ? 'pointer' : 'default' }}>
      <span style={{ width:9,height:9,borderRadius:8,background:COLORS[index % COLORS.length],flexShrink:0 }} />
      <span style={{ flex:1,fontSize:13,color:'#334155',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{entry.label || entry.key}</span>
      <span style={{ width:44,textAlign:'right',fontSize:12,fontWeight:600,color:'#475569' }}>{entry.count}</span>
      <span style={{ width:70,height:6,background:'#f1f5f9',borderRadius:4,overflow:'hidden' }}>
        <span style={{ display:'block',width:`${Math.round((Number(entry.count) || 0) / maximum * 100)}%`,height:'100%',background:COLORS[index % COLORS.length] }} />
      </span>
    </button>
  ));
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const teamView = isTeamRole(user?.role);
  const [data, setData] = useState(null);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [types, setTypes] = useState([]);
  const [filters, setFilters] = useState({ project:'', assignee:'', type:'' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (teamView && filters.project) params.project = filters.project;
      if (teamView && filters.assignee) params.assignee = filters.assignee;
      if (filters.type) params.type = filters.type;
      setData(await api.get('/tasks/dashboard', params));
    } catch (requestError) {
      setError(requestError.message || 'Unable to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [filters, teamView]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => {
    if (!teamView) return;
    Promise.all([
      api.get('/projects'),
      api.get('/users'),
      api.get('/tasks/types')
    ]).then(([projectItems, userItems, typeItems]) => {
      setProjects(projectItems);
      setUsers(userItems);
      setTypes(typeItems);
    }).catch((requestError) => setError(requestError.message || 'Unable to load dashboard filters'));
  }, [teamView]);

  const summary = data?.summary || {};
  const taskHref = (params = {}) => {
    const query = new URLSearchParams(params);
    const queryString = query.toString();
    return `/tasks${queryString ? `?${queryString}` : ''}`;
  };
  const filteredTaskHref = (params = {}) => {
    const merged = {};
    if (teamView && filters.project) merged.project = filters.project;
    if (teamView && filters.assignee) merged.assignee = filters.assignee;
    if (filters.type) merged.type = filters.type;
    Object.assign(merged, params);
    return taskHref(merged);
  };
  const statusEntries = useMemo(() => (data?.byStatus || []).map((item) => ({
    ...item, label:item.key
  })), [data]);

  return (
    <main style={{ padding:28 }}>
      <header style={{ marginBottom:22 }}>
        <h1 style={{ fontSize:22,fontWeight:700,color:'#1a202c',margin:0 }}>Dashboard</h1>
        <p style={{ color:'#64748b',fontSize:14,marginTop:4 }}>Welcome back, {user?.name}</p>
      </header>

      {teamView && (
        <div style={{ display:'flex',gap:12,flexWrap:'wrap',marginBottom:18 }}>
          <label style={{ minWidth:180 }}>
            <span className="sr-only">Filter dashboard by project</span>
            <select className="form-control" value={filters.project} onChange={(event) => setFilters((current) => ({ ...current,project:event.target.value }))}>
              <option value="">All projects</option>
              {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
            </select>
          </label>
          <label style={{ minWidth:180 }}>
            <span className="sr-only">Filter dashboard by employee</span>
            <select className="form-control" value={filters.assignee} onChange={(event) => setFilters((current) => ({ ...current,assignee:event.target.value }))}>
              <option value="">All assignees</option>
              <option value="me">My tasks</option>
              {users.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
            </select>
          </label>
          <label style={{ minWidth:180 }}>
            <span className="sr-only">Filter dashboard by task type</span>
            <select className="form-control" value={filters.type} onChange={(event) => setFilters((current) => ({ ...current,type:event.target.value }))}>
              <option value="">All types</option>
              {types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
        </div>
      )}

      {error && <div role="alert" style={{ background:'#fef2f2',color:'#b91c1c',padding:12,borderRadius:8,marginBottom:16 }}>{error}</div>}
      {loading && !data ? <p role="status">Loading dashboard…</p> : data && (
        <>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:14,marginBottom:20 }}>
            <StatCard label={teamView ? 'Total tasks' : 'My tasks'} value={summary.total} icon="ti-list-check" color="#378add" onClick={() => navigate(filteredTaskHref())} />
            <StatCard label={teamView ? 'Open tasks' : 'My open tasks'} value={summary.open} icon="ti-circle-dot" color="#378add" onClick={() => navigate(filteredTaskHref({ statusGroup:'Open' }))} />
            <StatCard label={teamView ? 'In progress' : 'My in-progress tasks'} value={summary.in_progress} icon="ti-loader" color="#ef9f27" onClick={() => navigate(filteredTaskHref({ statusGroup:'In Progress' }))} />
            <StatCard label={teamView ? 'Completed / closed' : 'My completed tasks'} value={summary.completed} icon="ti-circle-check" color="#1d9e75" onClick={() => navigate(filteredTaskHref({ statusGroup:'Completed/Closed' }))} />
            <StatCard label={teamView ? 'Rejected' : 'My rejected tasks'} value={summary.rejected} icon="ti-circle-x" color="#e24b4a" onClick={() => navigate(filteredTaskHref({ statusGroup:'Rejected' }))} />
            <StatCard label={teamView ? 'Overdue' : 'My overdue tasks'} value={summary.overdue} icon="ti-calendar-exclamation" color="#e24b4a" onClick={() => navigate(filteredTaskHref({ overdue:'true' }))} />
            <StatCard label={teamView ? 'Due today' : 'My tasks due today'} value={summary.due_today} icon="ti-calendar" color="#534ab7" onClick={() => navigate(filteredTaskHref({ dueToday:'true' }))} />
          </div>

          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:16,marginBottom:16 }}>
            <Panel title={teamView ? 'Tasks by status' : 'My tasks by status'}>
              <Breakdown entries={statusEntries}
                getHref={(item) => navigate(filteredTaskHref({ statusGroup:item.key }))}
                emptyText="No task status data." />
            </Panel>
            <Panel title={teamView ? 'Tasks by type' : 'My tasks by type'}>
              <Breakdown entries={data.byType || []}
                getHref={(item) => navigate(filteredTaskHref({
                  type:item.type,
                  ...(item.customTypeName ? { customTypeName:item.customTypeName } : {})
                }))}
                emptyText="No task type data." />
            </Panel>
            <Panel title={teamView ? 'Tasks by project' : 'My tasks by project'}>
              <Breakdown entries={data.byProject || []}
                getHref={(item) => navigate(filteredTaskHref({ project:item.id }))}
                emptyText="No project data." />
            </Panel>
            {teamView && data.teamWidgets && (
              <Panel title="Workload by assignee">
                <Breakdown entries={data.teamWidgets.workloadByAssignee || []}
                  getHref={(item) => navigate(filteredTaskHref({ assignee:item.id || '' }))}
                  emptyText="No assignee data." />
              </Panel>
            )}
          </div>

          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:16,marginBottom:16 }}>
            <Panel title={teamView ? 'Recent tasks' : 'My recent tasks'}>
              {(data.recentTasks || []).length === 0 ? <p style={{ color:'#94a3b8',fontSize:13 }}>No recent tasks.</p> :
                data.recentTasks.map((task) => (
                  <button key={task._id} type="button" onClick={() => navigate(`/tasks/${task._id}`)}
                    style={{ display:'flex',justifyContent:'space-between',gap:10,width:'100%',padding:'9px 0',border:0,borderBottom:'1px solid #f1f5f9',background:'transparent',textAlign:'left',cursor:'pointer' }}>
                    <span><strong style={{ display:'block',fontSize:13,color:'#334155' }}>{task.title}</strong><small style={{ display:'block',color:'#64748b' }}>{task.taskKey && `${task.taskKey} · `}{task.typeLabel} · {task.project?.name || 'Project'}</small></span>
                    <span style={{ fontSize:12,color:'#64748b' }}>{task.status}</span>
                  </button>
                ))}
            </Panel>
            <Panel title={teamView ? 'Upcoming deadlines' : 'My upcoming deadlines'}>
              {(data.upcomingDeadlines || []).length === 0 ? <p style={{ color:'#94a3b8',fontSize:13 }}>No upcoming deadlines.</p> :
                data.upcomingDeadlines.map((task) => (
                  <button key={task._id} type="button" onClick={() => navigate(`/tasks/${task._id}`)}
                    style={{ display:'flex',justifyContent:'space-between',gap:10,width:'100%',padding:'9px 0',border:0,borderBottom:'1px solid #f1f5f9',background:'transparent',textAlign:'left',cursor:'pointer' }}>
                    <span style={{ fontSize:13,color:'#334155' }}>{task.title}<small style={{ display:'block',color:'#64748b' }}>{task.taskKey && `${task.taskKey} · `}{task.typeLabel}</small></span>
                    <time style={{ fontSize:12,color:'#64748b' }}>{task.endDate || '—'}</time>
                  </button>
                ))}
            </Panel>
            <Panel title={teamView ? 'Tasks created by month' : 'My tasks created by month'}>
              <Breakdown entries={(data.byMonth || []).map((item) => ({ ...item,label:item.month }))}
                emptyText="No monthly trend data." />
            </Panel>
            <Panel title={teamView ? 'Recent activity' : 'My recent activity'}>
              {(data.recentActivity || []).length === 0 ? <p style={{ color:'#94a3b8',fontSize:13 }}>No recent activity.</p> :
                data.recentActivity.map((item) => (
                  <button key={item.id} type="button" onClick={() => navigate(`/tasks/${item.work_item_id}`)}
                    style={{ display:'block',width:'100%',padding:'8px 0',border:0,borderBottom:'1px solid #f1f5f9',background:'transparent',textAlign:'left',cursor:'pointer' }}>
                    <span style={{ display:'block',fontSize:13,color:'#334155' }}>{item.actor_name || 'A user'} {item.action} {item.task_key ? `${item.task_key} · ` : ''}{item.task_title}</span>
                    <time style={{ fontSize:11,color:'#94a3b8' }}>{new Date(item.created_at).toLocaleString()}</time>
                  </button>
                ))}
            </Panel>
            <Panel title={teamView ? 'Task notifications' : 'My task notifications'}>
              {(data.notifications || []).length === 0 ? <p style={{ color:'#94a3b8',fontSize:13 }}>No task notifications.</p> :
                data.notifications.map((item) => (
                  <button key={item.id} type="button" onClick={() => navigate(`/tasks/${item.task_id}`)}
                    style={{ display:'block',width:'100%',padding:'8px 0',border:0,borderBottom:'1px solid #f1f5f9',background:'transparent',textAlign:'left',cursor:'pointer' }}>
                    <span style={{ display:'block',fontSize:13,color:'#334155' }}>{item.task_key && `${item.task_key} · `}{item.task_title}</span>
                    <span style={{ display:'block',fontSize:12,color:'#64748b' }}>{item.details || item.type}</span>
                    <time style={{ fontSize:11,color:'#94a3b8' }}>{new Date(item.created_at).toLocaleString()}</time>
                  </button>
                ))}
            </Panel>
          </div>
        </>
      )}
    </main>
  );
}
