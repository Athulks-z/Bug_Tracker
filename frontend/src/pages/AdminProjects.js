import React, { useState, useEffect } from 'react';
import { api } from '../api';

const inputStyle = { width:'100%', padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, color:'#1a202c', outline:'none' };

export default function AdminProjects() {
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [form, setForm] = useState({ name:'', description:'', key:'', members:[] });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    Promise.all([api.get('/projects'), api.get('/users')]).then(([p,u]) => { setProjects(p); setUsers(u); }).finally(()=>setLoading(false));
  };
  useEffect(load, []);

  const openNew = () => {
    setEditProject(null);
    setForm({ name:'', description:'', key:'', members:[] });
    setError(''); setShowModal(true);
  };

  const openEdit = (p) => {
    setEditProject(p);
    setForm({ name:p.name, description:p.description||'', key:p.key, members:p.members?.map(m=>m._id||m)||[] });
    setError(''); setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.key.trim()) { setError('Name and key required'); return; }
    setSaving(true); setError('');
    try {
      if (editProject) {
        const updated = await api.put(`/projects/${editProject._id}`, form);
        setProjects(ps => ps.map(p => p._id===updated._id ? updated : p));
      } else {
        const created = await api.post('/projects', form);
        setProjects(ps => [created, ...ps]);
      }
      setShowModal(false);
    } catch(err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this project?')) return;
    await api.delete(`/projects/${id}`);
    setProjects(ps => ps.filter(p => p._id !== id));
  };

  const toggleMember = (uid) => {
    setForm(f => ({ ...f, members: f.members.includes(uid) ? f.members.filter(m=>m!==uid) : [...f.members, uid] }));
  };

  const PROJECT_COLORS = ['#378add','#1d9e75','#ef9f27','#534ab7','#e24b4a','#d4537e'];

  return (
    <div style={{ padding:28 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#1a202c' }}>Projects</h1>
          <p style={{ color:'#64748b', fontSize:13, marginTop:2 }}>{projects.length} projects</p>
        </div>
        <button onClick={openNew} style={{ background:'#378add', color:'#fff', border:'none', borderRadius:8, padding:'9px 18px', fontSize:13, fontWeight:500, display:'flex', alignItems:'center', gap:6 }}>
          <i className="ti ti-plus" />New Project
        </button>
      </div>

      {loading ? (
        <div style={{ padding:40, textAlign:'center', color:'#94a3b8' }}>Loading...</div>
      ) : projects.length === 0 ? (
        <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e2e8f0', padding:48, textAlign:'center' }}>
          <i className="ti ti-folder-off" style={{ fontSize:40, color:'#e2e8f0', display:'block', marginBottom:12 }} />
          <p style={{ color:'#94a3b8', fontSize:14 }}>No projects yet</p>
          <button onClick={openNew} style={{ marginTop:12, background:'#378add', color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', fontSize:13 }}>Create first project</button>
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
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:4 }}>
                    <button onClick={()=>openEdit(p)} style={{ background:'none', border:'1px solid #e2e8f0', borderRadius:6, padding:'5px 8px', fontSize:13, color:'#64748b' }}><i className="ti ti-edit" /></button>
                    <button onClick={()=>remove(p._id)} style={{ background:'none', border:'1px solid #fecaca', borderRadius:6, padding:'5px 8px', fontSize:13, color:'#ef4444' }}><i className="ti ti-trash" /></button>
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

      {showModal && (
        <div onClick={()=>setShowModal(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:14, padding:28, width:'100%', maxWidth:500, maxHeight:'90vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
              <h2 style={{ fontSize:16, fontWeight:600 }}>{editProject ? 'Edit Project' : 'New Project'}</h2>
              <button onClick={()=>setShowModal(false)} style={{ background:'none', border:'none', fontSize:20, color:'#94a3b8' }}><i className="ti ti-x" /></button>
            </div>
            {error && <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'#dc2626', padding:'10px 14px', borderRadius:8, marginBottom:14, fontSize:13 }}>{error}</div>}
            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Project Name *</label>
              <input style={inputStyle} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. Donnelly Apartments" />
            </div>
            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Key * (short code)</label>
              <input style={inputStyle} value={form.key} onChange={e=>setForm({...form,key:e.target.value.toUpperCase().slice(0,8)})} placeholder="e.g. PR-139" maxLength={8} />
            </div>
            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Description</label>
              <textarea style={{...inputStyle, height:70, resize:'vertical'}} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Project description…" />
            </div>
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
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
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
