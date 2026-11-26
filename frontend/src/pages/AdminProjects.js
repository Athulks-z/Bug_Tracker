import React, { useCallback, useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import useAutoRefresh from '../hooks/useAutoRefresh';

const inputStyle = { width:'100%', padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, color:'#1a202c', outline:'none' };

export default function AdminProjects() {
  const { user } = useAuth();
  const membershipOnly = user?.role === 'manager';
  const [projects, setProjects] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [form, setForm] = useState({
    name:'',description:'',key:'',owner:'',members:[],stakeholders:[],
    status:'planning',priority:'Medium',milestones:[{ name:'General',dueDate:'',owner:'' }],
    startDate:'',targetEndDate:''
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadProjects = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const result = await api.getWithMeta('/projects', { page, limit:100 });
      const p = result.data;
      setTotal(result.total);
      setProjects(p);
      const lists = membershipOnly
        ? await Promise.all(p.map(project => api.get('/users', { available:true, assignable:true, project:project._id })))
        : [await api.get('/users')];
      setUsers([...new Map(lists.flat().map(member => [member._id, member])).values()]);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, membershipOnly]);

  useEffect(() => { void loadProjects() }, [loadProjects]);
  useAutoRefresh(loadProjects);

  const openNew = () => {
    if (membershipOnly) return;
    setEditProject(null);
    setForm({
      name:'',description:'',key:'',owner:user?._id || '',members:[],stakeholders:[],
      status:'planning',priority:'Medium',milestones:[{ name:'General',dueDate:'',owner:'' }],
      startDate:'',targetEndDate:''
    });
    setError(''); setShowModal(true);
  };

  const openEdit = (p) => {
    setEditProject(p);
    setForm({
      name:p.name,
      description:p.description||'',
      key:p.key,
      owner:p.owner?._id || p.owner || '',
      members:p.members?.map(m=>m._id||m)||[],
      stakeholders:p.stakeholders?.map(user=>user._id)||[],
      status:p.status || 'planning',priority:p.priority || 'Medium',
      milestones:(p.milestones || []).map((milestone) => ({
        id:milestone.id,name:milestone.name,dueDate:milestone.dueDate || '',owner:milestone.owner || ''
      })),
      startDate:p.startDate || '',targetEndDate:p.targetEndDate || ''
    });
    setError(''); setShowModal(true);
  };

  const save = async () => {
    if (!membershipOnly && (!form.name.trim() || !form.key.trim() || !form.owner
      || !form.milestones.length || form.milestones.some((milestone) => !milestone.name.trim())
      || (form.startDate && form.targetEndDate && form.targetEndDate < form.startDate))) {
      setError('Name, key, owner, and milestone names are required'); return;
    }
    setSaving(true); setError('');
    try {
      if (editProject) {
        const updated = await api.put(`/projects/${editProject._id}`, membershipOnly
          ? { members:form.members, stakeholders:form.stakeholders }
          : form);
        setProjects(ps => ps.map(p => p._id===updated._id ? updated : p));
      } else {
        if (membershipOnly) return;
        const created = await api.post('/projects', form);
        setProjects(ps => [created, ...ps]);
        setTotal(count => count + 1);
        setPage(1);
      }
      setShowModal(false);
    } catch(err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this project?')) return;
    try {
      await api.delete(`/projects/${id}`);
      setProjects(ps => ps.filter(p => p._id !== id));
      setTotal(count => Math.max(0, count - 1));
      if (projects.length === 1 && page > 1) setPage(current => current - 1);
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  const toggleMember = (uid) => {
    setForm(f => ({ ...f, members: f.members.includes(uid) ? f.members.filter(m=>m!==uid) : [...f.members, uid] }));
  };

  const toggleStakeholder = (uid) => {
    setForm(f => ({
      ...f,
      stakeholders: f.stakeholders.includes(uid)
        ? f.stakeholders.filter(id=>id!==uid)
        : [...f.stakeholders, uid]
    }));
  };

  const setMilestoneCount = (count) => {
    const length = Math.min(20, Math.max(1, Number(count) || 1));
    setForm((current) => {
      const milestones = current.milestones.slice(0, length);
      while (milestones.length < length) milestones.push({ name:'',dueDate:'',owner:'' });
      return { ...current,milestones };
    });
  };

  const reorderMilestone = (index, direction) => {
    setForm((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.milestones.length) return current;
      const milestones = [...current.milestones];
      [milestones[index],milestones[target]] = [milestones[target],milestones[index]];
      return { ...current,milestones };
    });
  };

  const PROJECT_COLORS = ['#378add','#1d9e75','#ef9f27','#534ab7','#e24b4a','#d4537e'];

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#1a202c' }}>{membershipOnly ? 'Project Members' : 'Projects'}</h1>
          <p style={{ color:'#64748b', fontSize:13, marginTop:2 }}>{total} projects</p>
        </div>
        {!membershipOnly && <button onClick={openNew} style={{ background:'#378add', color:'#fff', border:'none', borderRadius:8, padding:'9px 18px', fontSize:13, fontWeight:500, display:'flex', alignItems:'center', gap:6 }}>
          <i className="ti ti-plus" />New Project
        </button>}
      </div>

      {loading ? (
        <div style={{ padding:40, textAlign:'center', color:'#94a3b8' }}>Loading...</div>
      ) : error && !showModal ? (
        <div role="alert" style={{ background:'#fef2f2',border:'1px solid #fecaca',color:'#dc2626',padding:14,borderRadius:8 }}>{error}</div>
      ) : projects.length === 0 ? (
        <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e2e8f0', padding:48, textAlign:'center' }}>
          <i className="ti ti-folder-off" style={{ fontSize:40, color:'#e2e8f0', display:'block', marginBottom:12 }} />
          <p style={{ color:'#94a3b8', fontSize:14 }}>No projects yet</p>
          {!membershipOnly && <button onClick={openNew} style={{ marginTop:12, background:'#378add', color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', fontSize:13 }}>Create first project</button>}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:16 }}>
          {projects.map((p, i) => {
            const color = PROJECT_COLORS[i % PROJECT_COLORS.length];
            return (
              <div key={p._id} style={{ background:'#fff', borderRadius:12, border:'1px solid #e2e8f0', padding:20, position:'relative' }}>
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:12 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ width:42, height:42, background:`${color}18`, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <span style={{ fontSize:14, fontWeight:700, color }}>{p.key}</span>
                    </div>
                    <div>
                      <div style={{ fontWeight:600, color:'#1a202c', fontSize:14 }}>{p.name}</div>
                      <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>{p.members?.length||0} members</div>
                      <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>{p.stakeholders?.length||0} email stakeholders</div>
                      <div style={{ fontSize:11, color:p.status === 'closed' ? '#9a3412' : '#64748b', marginTop:3 }}>{p.statusLabel || (p.status === 'active' ? 'In Progress' : p.status)}</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:4 }}>
                    {p.status !== 'closed' && <button onClick={()=>openEdit(p)} aria-label="Edit project" style={{ background:'none', border:'1px solid #e2e8f0', borderRadius:6, padding:'5px 8px', fontSize:13, color:'#64748b' }}><i className="ti ti-edit" /></button>}
                    {!membershipOnly && p.status !== 'closed' && <button onClick={()=>remove(p._id)} aria-label="Delete project" style={{ background:'none', border:'1px solid #fecaca', borderRadius:6, padding:'5px 8px', fontSize:13, color:'#ef4444' }}><i className="ti ti-trash" /></button>}
                  </div>
                </div>
                {p.description && <p style={{ fontSize:13, color:'#64748b', marginBottom:12, lineHeight:1.5 }}>{p.description}</p>}
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop:12, borderTop:'1px solid #f1f5f9' }}>
                  <div style={{ display:'flex', alignItems:'center' }}>
                    {p.members?.slice(0,4).map((m,idx)=>{
                      const name = m.name||'?';
                      const c = PROJECT_COLORS[name.charCodeAt(0)%PROJECT_COLORS.length];
                      const init = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
                      return <div key={idx} style={{ width:26, height:26, borderRadius:'50%', background:c, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:10, fontWeight:600, marginLeft:idx?-6:0, border:'2px solid #fff' }}>{init}</div>;
                    })}
                    {(p.members?.length||0) > 4 && <div style={{ width:26, height:26, borderRadius:'50%', background:'#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', color:'#64748b', fontSize:10, marginLeft:-6, border:'2px solid #fff' }}>+{p.members.length-4}</div>}
                  </div>
                  <span style={{ fontSize:11, color:'#94a3b8' }}>By {p.owner?.name}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!loading && total > 100 && <div style={{ display:'flex',justifyContent:'center',alignItems:'center',gap:12,marginTop:20 }}>
        <button className="btn btn-ghost" disabled={page === 1} onClick={() => setPage(current => current - 1)}>Previous</button>
        <span aria-live="polite">Page {page} of {Math.ceil(total / 100)}</span>
        <button className="btn btn-ghost" disabled={page >= Math.ceil(total / 100)} onClick={() => setPage(current => current + 1)}>Next</button>
      </div>}

      {showModal && (
        <div className="modal-backdrop" onClick={(event)=>{ if(event.target===event.currentTarget) setShowModal(false) }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-form-title" style={{ maxWidth:760 }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header" style={{ marginBottom:20 }}>
              <h2 id="project-form-title" style={{ fontSize:16, fontWeight:600 }}>{membershipOnly ? 'Manage Project Members' : editProject ? 'Edit Project' : 'New Project'}</h2>
              <button onClick={()=>setShowModal(false)} style={{ background:'none', border:'none', fontSize:20, color:'#94a3b8' }}><i className="ti ti-x" /></button>
            </div>
            <div className="modal-body">
            {error && <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'#dc2626', padding:'10px 14px', borderRadius:8, marginBottom:14, fontSize:13 }}>{error}</div>}
            {!membershipOnly && <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Project Name *</label>
              <input style={inputStyle} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. Donnelly Apartments" />
            </div>}
            {!membershipOnly && <div className="modal-form-grid" style={{ marginBottom:14 }}>
              <label style={{ fontSize:12,color:'#475569' }}>Project Status *
                <select style={{ ...inputStyle,display:'block',marginTop:5 }} required value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current,status:event.target.value }))}>
                  <option value="planning">Planning</option><option value="active">In Progress</option>
                  <option value="on_hold">On Hold</option><option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label style={{ fontSize:12,color:'#475569' }}>Project Priority *
                <select style={{ ...inputStyle,display:'block',marginTop:5 }} required value={form.priority}
                  onChange={(event) => setForm((current) => ({ ...current,priority:event.target.value }))}>
                  {['High','Medium','Low'].map((priority) => <option key={priority}>{priority}</option>)}
                </select>
              </label>
            </div>}
            {!membershipOnly && <div style={{ marginBottom:14 }}>
              <label style={{ display:'block',fontSize:12,color:'#475569',marginBottom:5 }}>Project Owner *</label>
              <select style={inputStyle} required value={form.owner}
                onChange={(event) => setForm((current) => ({ ...current,owner:event.target.value }))}>
                <option value="">Select owner</option>{users.map((person) => <option key={person._id} value={person._id}>{person.name}</option>)}
              </select>
            </div>}
            {!membershipOnly && <div className="modal-form-grid" style={{ marginBottom:14 }}>
              <label style={{ fontSize:12,color:'#475569' }}>Start date
                <input style={{ ...inputStyle,display:'block',marginTop:5 }} type="date" value={form.startDate}
                  onChange={(event) => setForm((current) => ({ ...current,startDate:event.target.value }))} />
              </label>
              <label style={{ fontSize:12,color:'#475569' }}>Target end date
                <input style={{ ...inputStyle,display:'block',marginTop:5 }} type="date" value={form.targetEndDate}
                  onChange={(event) => setForm((current) => ({ ...current,targetEndDate:event.target.value }))} />
              </label>
            </div>}
            {!membershipOnly && <div style={{ marginBottom:14 }}>
              <label style={{ display:'block',fontSize:12,color:'#475569',marginBottom:5 }}>Number of milestones *</label>
              <input style={inputStyle} type="number" min="1" max="20" required value={form.milestones.length}
                onChange={(event) => setMilestoneCount(event.target.value)} />
              <div style={{ display:'grid',gap:8,marginTop:8 }}>
                {form.milestones.map((milestone,index) => (
                  <div key={milestone.id || index} className="modal-milestone-row">
                    <input style={inputStyle} required maxLength={100} aria-label={`Milestone ${index+1} name`}
                      placeholder={`Milestone ${index+1} name`} value={milestone.name}
                      onChange={(event) => setForm((current) => ({
                        ...current,milestones:current.milestones.map((item,itemIndex) => itemIndex === index
                          ? { ...item,name:event.target.value } : item)
                      }))} />
                    <input style={inputStyle} type="date" aria-label={`Milestone ${index+1} due date`}
                      value={milestone.dueDate || ''}
                      onChange={(event) => setForm((current) => ({
                        ...current,milestones:current.milestones.map((item,itemIndex) => itemIndex === index
                          ? { ...item,dueDate:event.target.value } : item)
                      }))} />
                    <div style={{ display:'flex',gap:4 }}>
                      <button type="button" className="btn-icon" aria-label="Move milestone up" disabled={index===0}
                        onClick={() => reorderMilestone(index,-1)}><i className="ti ti-arrow-up" /></button>
                      <button type="button" className="btn-icon" aria-label="Move milestone down" disabled={index===form.milestones.length-1}
                        onClick={() => reorderMilestone(index,1)}><i className="ti ti-arrow-down" /></button>
                    </div>
                    <select style={inputStyle} aria-label={`Milestone ${index+1} owner`}
                      value={milestone.owner || ''} onChange={(event) => setForm((current) => ({
                        ...current,milestones:current.milestones.map((item,itemIndex) => itemIndex === index
                          ? { ...item,owner:event.target.value } : item)
                      }))}>
                      <option value="">No milestone owner</option>
                      {users.map((person) => <option key={person._id} value={person._id}>{person.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>}
            {!membershipOnly && <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Key * (short code)</label>
              <input style={inputStyle} value={form.key} onChange={e=>setForm({...form,key:e.target.value.toUpperCase().slice(0,8)})} placeholder="e.g. PR-139" maxLength={8} />
            </div>}
            {!membershipOnly && <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Description</label>
              <textarea style={{...inputStyle, height:70, resize:'vertical'}} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Project description…" />
            </div>}
            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Team Members</label>
              <div style={{ border:'1px solid #e2e8f0', borderRadius:8, padding:10, maxHeight:160, overflow:'auto' }}>
                {users.map(u => (
                  <label key={u._id} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 4px', cursor:'pointer' }}>
                    <input type="checkbox" checked={form.members.includes(u._id)} onChange={()=>toggleMember(u._id)} style={{ accentColor:'#378add' }} />
                    <span style={{ fontSize:13, color:'#334155' }}>{u.name}</span>
                    <span style={{ fontSize:11, color:'#94a3b8', marginLeft:'auto' }}>{u.role}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>Assignment Email CC</label>
              <p style={{ fontSize:11, color:'#94a3b8', margin:'0 0 8px' }}>Selected project stakeholders and the configured email sender are copied when a task or issue is assigned.</p>
              <div style={{ border:'1px solid #e2e8f0', borderRadius:8, padding:10, maxHeight:160, overflow:'auto' }}>
                {users.map(u => (
                  <label key={u._id} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 4px', cursor:'pointer' }}>
                    <input type="checkbox" checked={form.stakeholders.includes(u._id)} onChange={()=>toggleStakeholder(u._id)} style={{ accentColor:'#378add' }} />
                    <span style={{ fontSize:13, color:'#334155' }}>{u.name}</span>
                    <span style={{ fontSize:11, color:'#94a3b8', marginLeft:'auto' }}>{u.email || u.role}</span>
                  </label>
                ))}
              </div>
            </div>
            </div>
            <div className="modal-footer" style={{ justifyContent:'flex-end', gap:10, marginTop:20 }}>
              <button onClick={()=>setShowModal(false)} style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'none', fontSize:13, color:'#64748b' }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding:'9px 18px', background:'#378add', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:500, opacity:saving?0.7:1 }}>
                {saving ? 'Saving...' : editProject ? 'Update' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
