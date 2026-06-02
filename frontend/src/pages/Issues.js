import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const STATUS_OPTS = ['Open','To do','In progress','Reopen','Closed'];
const SEV_OPTS = ['Showstopper','Major','Medium','Low','None'];
const STATUS_COLORS = { Open:'#378add', Reopen:'#e24b4a', 'In progress':'#ef9f27', 'To do':'#1d9e75', Closed:'#64748b' };
const SEV_COLORS = { Showstopper:'#e24b4a', Major:'#ef9f27', Medium:'#378add', Low:'#94a3b8', None:'#cbd5e1' };
const AVATAR_COLORS = ['#e24b4a','#378add','#1d9e75','#ef9f27','#534ab7','#d4537e','#0f6e56','#3b6d11'];

function av(name) {
  if (!name) return '';
  const c = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  const initials = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return { c, initials };
}

function Avatar({ name, size=24 }) {
  const a = av(name);
  if (!a) return null;
  return <div style={{ width:size, height:size, borderRadius:'50%', background:a.c, display:'inline-flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:size*0.38, fontWeight:600, flexShrink:0 }}>{a.initials}</div>;
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:14, padding:28, width:'100%', maxWidth:520, maxHeight:'90vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
          <h2 style={{ fontSize:16, fontWeight:600, color:'#1a202c' }}>{title}</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, color:'#94a3b8' }}><i className="ti ti-x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = { width:'100%', padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, color:'#1a202c', outline:'none', background:'#fff' };

export default function Issues() {
  const { user } = useAuth();
  const [issues, setIssues] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editIssue, setEditIssue] = useState(null);
  const [form, setForm] = useState({ title:'', description:'', project:'', assignee:'', status:'Open', severity:'Medium', dueDate:'' });
  const [filters, setFilters] = useState({ project:'', status:'', severity:'', search:'' });
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (filters.project) q.set('project', filters.project);
    if (filters.status) q.set('status', filters.status);
    if (filters.severity) q.set('severity', filters.severity);
    if (filters.search) q.set('search', filters.search);
    api.get(`/issues?${q}`).then(setIssues).finally(()=>setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/projects').then(setProjects).catch(()=>{}); api.get('/users').then(setUsers).catch(()=>{}); }, []);

  const openNew = () => {
    setEditIssue(null);
    setForm({ title:'', description:'', project: projects[0]?._id||'', assignee:'', status:'Open', severity:'Medium', dueDate:'' });
    setError(''); setShowModal(true);
  };

  const openEdit = (issue) => {
    setEditIssue(issue);
    setForm({
      title: issue.title,
      description: issue.description||'',
      project: issue.project?._id||issue.project||'',
      assignee: issue.assignee?._id||issue.assignee||'',
      status: issue.status,
      severity: issue.severity,
      dueDate: issue.dueDate ? issue.dueDate.slice(0, 10) : ''
    });
    setError(''); setShowModal(true);
  };

  const save = async () => {
    if (!form.title.trim() || !form.project) { setError('Title and project required'); return; }
    setSaving(true); setError('');
    try {
      if (editIssue) {
        const updated = await api.put(`/issues/${editIssue._id}`, form);
        setIssues(iss => iss.map(i => i._id===updated._id ? updated : i));
      } else {
        const created = await api.post('/issues', form);
        setIssues(iss => [created, ...iss]);
      }
      setShowModal(false);
    } catch(err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const downloadCsv = async () => {
    setDownloading(true);
    try {
      const params = {};
      if (filters.project) params.project = filters.project;
      if (filters.status) params.status = filters.status;
      if (filters.severity) params.severity = filters.severity;
      const blob = await api.download('/issues/export', params);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'issues.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('CSV downloaded');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this issue?')) return;
    await api.delete(`/issues/${id}`);
    setIssues(iss => iss.filter(i => i._id !== id));
  };

  const statusCounts = {};
  issues.forEach(i => { statusCounts[i.status] = (statusCounts[i.status]||0)+1; });

  return (
    <div style={{ padding:28, minHeight:'100%' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#1a202c' }}>Issues</h1>
          <p style={{ color:'#64748b', fontSize:13, marginTop:2 }}>{issues.length} total issues</p>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={downloadCsv} disabled={downloading} style={{ background:'#fff', color:'#111827', border:'1px solid #e2e8f0', borderRadius:8, padding:'9px 18px', fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
            <i className="ti ti-download" />{downloading ? 'Exporting…' : 'Download CSV'}
          </button>
          <button onClick={openNew} style={{ background:'#378add', color:'#fff', border:'none', borderRadius:8, padding:'9px 18px', fontSize:13, fontWeight:500, display:'flex', alignItems:'center', gap:6 }}>
            <i className="ti ti-plus" />Submit Issue
          </button>
        </div>
      </div>

      {/* Status pills */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
        {STATUS_OPTS.map(s => (
          <button key={s} onClick={()=>setFilters(f=>({...f,status:f.status===s?'':s}))}
            style={{ padding:'5px 14px', borderRadius:20, border:`1px solid ${STATUS_COLORS[s]}`, background: filters.status===s ? STATUS_COLORS[s] : `${STATUS_COLORS[s]}18`, color: filters.status===s ? '#fff' : STATUS_COLORS[s], fontSize:12, fontWeight:500, cursor:'pointer' }}>
            {s} {statusCounts[s] ? `(${statusCounts[s]})` : ''}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, padding:'6px 12px', flex:1, minWidth:200 }}>
          <i className="ti ti-search" style={{ color:'#94a3b8', fontSize:15 }} />
          <input value={filters.search} onChange={e=>setFilters(f=>({...f,search:e.target.value}))} placeholder="Search issues…" style={{ border:'none', outline:'none', fontSize:13, color:'#1a202c', width:'100%' }} />
        </div>
        <select value={filters.project} onChange={e=>setFilters(f=>({...f,project:e.target.value}))} style={{ ...inputStyle, width:'auto', padding:'6px 12px' }}>
          <option value="">All projects</option>
          {projects.map(p=><option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
        <select value={filters.severity} onChange={e=>setFilters(f=>({...f,severity:e.target.value}))} style={{ ...inputStyle, width:'auto', padding:'6px 12px' }}>
          <option value="">All severities</option>
          {SEV_OPTS.map(s=><option key={s}>{s}</option>)}
        </select>
        {(filters.status||filters.severity||filters.search||filters.project) && (
          <button onClick={()=>setFilters({project:'',status:'',severity:'',search:''})} style={{ padding:'6px 14px', border:'1px solid #e2e8f0', borderRadius:8, background:'none', fontSize:12, color:'#64748b' }}>Clear</button>
        )}
      </div>

      {/* Table */}
      <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:40, textAlign:'center', color:'#94a3b8' }}>Loading issues...</div>
        ) : issues.length === 0 ? (
          <div style={{ padding:48, textAlign:'center' }}>
            <i className="ti ti-bug-off" style={{ fontSize:40, color:'#e2e8f0', display:'block', marginBottom:12 }} />
            <p style={{ color:'#94a3b8', fontSize:14 }}>No issues found</p>
            <button onClick={openNew} style={{ marginTop:12, background:'#378add', color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', fontSize:13 }}>Submit first issue</button>
          </div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['Issue','Reporter','Created','Status','Assignee','Severity','Due'].map(h=>(
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', color:'#64748b', fontSize:11, fontWeight:600, borderBottom:'1px solid #e2e8f0', whiteSpace:'nowrap', textTransform:'uppercase', letterSpacing:'0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {issues.map(issue => (
                <tr key={issue._id} style={{ borderBottom:'1px solid #f1f5f9', transition:'background 0.1s' }}
                  onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
                  onMouseLeave={e=>e.currentTarget.style.background=''}>
                  <td style={{ padding:'12px 14px', maxWidth:260 }}>
                    <div style={{ fontWeight:500, color:'#1a202c', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{issue.title}</div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{issue.project?.name}</div>
                  </td>
                  <td style={{ padding:'12px 14px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <Avatar name={issue.reporter?.name} />
                      <span style={{ color:'#475569', fontSize:12 }}>{issue.reporter?.name}</span>
                    </div>
                  </td>
                  <td style={{ padding:'12px 14px', color:'#64748b', fontSize:12, whiteSpace:'nowrap' }}>
                    {new Date(issue.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding:'12px 14px' }}>
                    <span style={{ background:`${STATUS_COLORS[issue.status]||'#ccc'}18`, color:STATUS_COLORS[issue.status]||'#ccc', padding:'4px 12px', borderRadius:12, fontSize:12, fontWeight:500 }}>{issue.status}</span>
                  </td>
                  <td style={{ padding:'12px 14px' }}>
                    {issue.assignee ? (
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <Avatar name={issue.assignee?.name} />
                        <span style={{ color:'#475569', fontSize:12 }}>{issue.assignee?.name}</span>
                      </div>
                    ) : <span style={{ color:'#cbd5e1', fontSize:12 }}>Unassigned</span>}
                  </td>
                  <td style={{ padding:'12px 14px' }}>
                    <span style={{ color:SEV_COLORS[issue.severity]||'#999', fontSize:12, fontWeight:600 }}>{issue.severity}</span>
                  </td>
                  <td style={{ padding:'12px 14px', color:'#64748b', fontSize:12 }}>{issue.dueDate ? new Date(issue.dueDate).toLocaleDateString() : '—'}</td>
                  <td style={{ padding:'12px 14px' }}>
                    <div style={{ display:'flex', gap:4 }}>
                      <button onClick={()=>openEdit(issue)} style={{ background:'none', border:'1px solid #e2e8f0', borderRadius:6, padding:'4px 8px', color:'#64748b', fontSize:13 }} title="Edit"><i className="ti ti-edit" /></button>
                      {(user?.role==='admin' || issue.reporter?._id===user?._id) && (
                        <button onClick={()=>remove(issue._id)} style={{ background:'none', border:'1px solid #fecaca', borderRadius:6, padding:'4px 8px', color:'#ef4444', fontSize:13 }} title="Delete"><i className="ti ti-trash" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <Modal title={editIssue ? 'Edit Issue' : 'Submit New Issue'} onClose={()=>setShowModal(false)}>
          {error && <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'#dc2626', padding:'10px 14px', borderRadius:8, marginBottom:14, fontSize:13 }}>{error}</div>}
          <Field label="Title *"><input style={inputStyle} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Issue title" /></Field>
          <Field label="Description"><textarea style={{...inputStyle, height:80, resize:'vertical'}} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Describe the issue…" /></Field>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <Field label="Project *">
              <select style={inputStyle} value={form.project} onChange={e=>setForm({...form,project:e.target.value})}>
                <option value="">Select project</option>
                {projects.map(p=><option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Assignee">
              <select style={inputStyle} value={form.assignee} onChange={e=>setForm({...form,assignee:e.target.value})}>
                <option value="">Unassigned</option>
                {users.map(u=><option key={u._id} value={u._id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select style={inputStyle} value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>
                {STATUS_OPTS.map(s=><option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Severity">
              <select style={inputStyle} value={form.severity} onChange={e=>setForm({...form,severity:e.target.value})}>
                {SEV_OPTS.map(s=><option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Due Date">
              <input type="date" style={inputStyle} value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})} />
            </Field>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
            <button onClick={()=>setShowModal(false)} style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'none', fontSize:13, color:'#64748b' }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ padding:'9px 18px', background:'#378add', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:500, opacity:saving?0.7:1 }}>
              {saving ? 'Saving...' : editIssue ? 'Update Issue' : 'Submit Issue'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
