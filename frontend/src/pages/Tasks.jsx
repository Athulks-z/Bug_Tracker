import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { fmtDate } from '../utils';

const STATUSES = ['To do', 'In progress', 'Blocked', 'Completed'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [filters, setFilters] = useState({ project:'', status:'', assignee:'', search:'' });
  const [form, setForm] = useState({
    title:'',
    description:'',
    project:'',
    assignee:'',
    status:'To do',
    priority:'Medium',
    startDate:'',
    endDate:''
  });
  const [saving, setSaving] = useState(false);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const params = { ...filters, limit: 50 };
      if (user?.role !== 'admin') params.assignee = 'me';
      const r = await api.get('/tasks', params);
      setTasks(r);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableUsers = async () => {
    try {
      const available = await api.get('/users', { available: true });
      setAvailableUsers(available);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadTasks();
    api.get('/projects').then(setProjects).catch(() => {});
    api.get('/users').then(setUsers).catch(() => {});
    loadAvailableUsers();
  }, [user]);

  useEffect(() => {
    loadTasks();
  }, [filters]);

  const openNew = () => {
    setEditTask(null);
    setForm({ title:'', description:'', project:'', assignee:'', status:'To do', priority:'Medium', startDate:'', endDate:'' });
    setShowModal(true);
  };

  const openEdit = (task) => {
    setEditTask(task);
    setForm({
      title: task.title || '',
      description: task.description || '',
      project: task.project?._id || task.project || '',
      assignee: task.assignee?._id || task.assignee || '',
      status: task.status || 'To do',
      priority: task.priority || 'Medium',
      startDate: task.startDate ? task.startDate.slice(0, 10) : '',
      endDate: task.endDate ? task.endDate.slice(0, 10) : ''
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.title.trim() || !form.project) {
      toast.error('Title and project are required');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.assignee) delete payload.assignee;
      if (!payload.startDate) delete payload.startDate;
      if (!payload.endDate) delete payload.endDate;

      const result = editTask
        ? await api.put(`/tasks/${editTask._id}`, payload)
        : await api.post('/tasks', payload);

      toast.success(editTask ? 'Task updated' : 'Task created');
      setShowModal(false);
      setEditTask(null);
      await loadTasks();
      await loadAvailableUsers();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this task?')) return;
    await api.delete(`/tasks/${id}`);
    toast.success('Task deleted');
    await loadTasks();
    await loadAvailableUsers();
  };

  const isOverdue = (task) => {
    return task.endDate && new Date(task.endDate) < new Date() && task.status !== 'Completed';
  };

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:22 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#1a202c' }}>Tasks</h1>
          <p style={{ color:'#64748b', fontSize:13, marginTop:4 }}>{tasks.length} task{tasks.length!==1?'s':''} loaded</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={async () => {
            setLoading(true);
            try {
              const params = { ...filters };
              const blob = await api.download('/tasks/export', params);
              const url = window.URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.setAttribute('download', 'tasks.csv');
              document.body.appendChild(link);
              link.click();
              link.remove();
              window.URL.revokeObjectURL(url);
              toast.success('Tasks CSV downloaded');
            } catch (err) {
              toast.error(err.message || 'Export failed');
            } finally {
              setLoading(false);
            }
          }} className="btn" style={{ background:'#fff', border:'1px solid #e2e8f0', padding:'8px 12px' }}><i className="ti ti-download" /> Export</button>
          <button onClick={openNew} className="btn btn-primary"><i className="ti ti-plus" /> New Task</button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:14, marginBottom:18 }}>
        <input className="form-control" style={{ minWidth:180 }} placeholder="Search tasks…" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
        <select className="form-control" value={filters.project} onChange={e => setFilters(f => ({ ...f, project: e.target.value }))}>
          <option value="">All projects</option>
          {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
        <select className="form-control" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="form-control" value={filters.assignee} onChange={e => setFilters(f => ({ ...f, assignee: e.target.value }))}>
          <option value="">All assignees</option>
          {users.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
        </select>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <label style={{ display:'inline-flex', alignItems:'center', gap:6, color:'#475569', fontSize:13 }}>
          <input type="checkbox" checked={availableOnly} onChange={e => setAvailableOnly(e.target.checked)} />
          Show only available engineers
        </label>
      </div>

      <div className="card" style={{ overflow:'hidden' }}>
        <div className="table-wrap">
          <table>
            <thead><tr>
              {['Task','Project','Assignee','Status','Priority','Start','End',''].map(h => <th key={h}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8}><div className="empty-state"><i className="ti ti-loader-2" style={{ animation:'spin 1s linear infinite' }} /><p>Loading…</p><style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style></div></td></tr>
              ) : tasks.length === 0 ? (
                <tr><td colSpan={8}><div className="empty-state"><i className="ti ti-list-check" /><p>No tasks found</p></div></td></tr>
              ) : tasks.map(task => (
                <tr key={task._id} style={isOverdue(task) ? { background:'#fef2f2' } : {}}>
                  <td>
                    <div style={{ fontWeight:500, color:'#111827' }}>{task.title}</div>
                    {task.description && <div style={{ color:'#6b7280', fontSize:12, marginTop:4, maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{task.description}</div>}
                  </td>
                  <td style={{ color:'#475569' }}>{task.project?.name || '—'}</td>
                  <td style={{ color:'#475569' }}>{task.assignee?.name || 'Unassigned'}</td>
                  <td><span className={`badge badge-${task.status.replace(/\s+/g,'').toLowerCase()}`} style={{ minWidth:70 }}>{task.status}</span></td>
                  <td><span className={`badge badge-${task.priority.toLowerCase()}`} style={{ minWidth:70 }}>{task.priority}</span></td>
                  <td>{task.startDate ? fmtDate(task.startDate) : '—'}</td>
                  <td>{task.endDate ? fmtDate(task.endDate) : '—'}</td>
                  <td>
                    <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                      <button className="btn-icon" onClick={() => openEdit(task)} title="Edit"><i className="ti ti-edit" /></button>
                      <button className="btn-icon" style={{ color:'#ef4444' }} onClick={() => remove(task._id)} title="Delete"><i className="ti ti-trash" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="modal">
            <div className="modal-header">
              <h3>{editTask ? 'Edit Task' : 'New Task'}</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}><i className="ti ti-x" /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Title *</label>
                <input className="form-control" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Task title" />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-control" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Task details" />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div className="form-group">
                  <label className="form-label">Project *</label>
                  <select className="form-control" value={form.project} onChange={e => setForm(f => ({ ...f, project: e.target.value }))}>
                    <option value="">Select project</option>
                    {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Assignee</label>
                  <select className="form-control" value={form.assignee} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {(availableOnly ? availableUsers : users).map(u => (
                      <option key={u._id} value={u._id}>{u.name}</option>
                    ))}
                  </select>
                  <div style={{ marginTop:8, fontSize:12, color:'#64748b' }}>
                    {availableOnly ? 'Showing engineers without active task assignments.' : 'Showing all engineers.'}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-control" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select className="form-control" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input className="form-control" type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">End Date</label>
                  <input className="form-control" type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : (editTask ? 'Update Task' : 'Create Task')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
