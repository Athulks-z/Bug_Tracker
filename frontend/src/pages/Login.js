import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [form, setForm] = useState({ email:'', password:'' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login(form.email, form.password);
      navigate('/');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:'100vh', background:'#0f1724', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ width:'100%', maxWidth:400 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ width:48, height:48, background:'#e24b4a', borderRadius:12, display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom:12 }}>
            <i className="ti ti-bug" style={{ fontSize:24, color:'#fff' }} />
          </div>
          <h1 style={{ color:'#fff', fontSize:24, fontWeight:600 }}>BugTracker</h1>
          <p style={{ color:'rgba(255,255,255,0.4)', marginTop:4, fontSize:14 }}>Sign in to your workspace</p>
        </div>
        <form onSubmit={submit} style={{ background:'#161f30', borderRadius:12, padding:28, border:'1px solid rgba(255,255,255,0.08)' }}>
          {error && <div style={{ background:'rgba(226,75,74,0.15)', border:'1px solid rgba(226,75,74,0.3)', color:'#f87171', padding:'10px 14px', borderRadius:8, marginBottom:16, fontSize:13 }}>{error}</div>}
          <div style={{ marginBottom:16 }}>
            <label style={{ display:'block', color:'rgba(255,255,255,0.6)', fontSize:12, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>Email</label>
            <input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required
              style={{ width:'100%', padding:'10px 12px', background:'#0f1724', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'#fff', fontSize:14, outline:'none' }}
              placeholder="you@example.com" />
          </div>
          <div style={{ marginBottom:24 }}>
            <label style={{ display:'block', color:'rgba(255,255,255,0.6)', fontSize:12, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>Password</label>
            <input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required
              style={{ width:'100%', padding:'10px 12px', background:'#0f1724', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'#fff', fontSize:14, outline:'none' }}
              placeholder="••••••••" />
          </div>
          <button type="submit" disabled={loading}
            style={{ width:'100%', padding:'11px', background:'#378add', border:'none', borderRadius:8, color:'#fff', fontSize:14, fontWeight:500, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p style={{ textAlign:'center', marginTop:16, color:'rgba(255,255,255,0.4)', fontSize:13 }}>
          Don't have an account? <Link to="/register" style={{ color:'#378add' }}>Register</Link>
        </p>
      </div>
    </div>
  );
}
