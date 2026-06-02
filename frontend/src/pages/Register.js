import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const [form, setForm] = useState({ name:'', email:'', password:'' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await register(form.name, form.email, form.password);
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
          <h1 style={{ color:'#fff', fontSize:24, fontWeight:600 }}>Create Account</h1>
          <p style={{ color:'rgba(255,255,255,0.4)', marginTop:4, fontSize:14 }}>First user becomes admin</p>
        </div>
        <form onSubmit={submit} style={{ background:'#161f30', borderRadius:12, padding:28, border:'1px solid rgba(255,255,255,0.08)' }}>
          {error && <div style={{ background:'rgba(226,75,74,0.15)', border:'1px solid rgba(226,75,74,0.3)', color:'#f87171', padding:'10px 14px', borderRadius:8, marginBottom:16, fontSize:13 }}>{error}</div>}
          {[['name','Name','Your full name','text'],['email','Email','you@example.com','email'],['password','Password','••••••••','password']].map(([k,l,ph,t])=>(
            <div key={k} style={{ marginBottom:16 }}>
              <label style={{ display:'block', color:'rgba(255,255,255,0.6)', fontSize:12, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>{l}</label>
              <input type={t} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} required
                style={{ width:'100%', padding:'10px 12px', background:'#0f1724', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'#fff', fontSize:14, outline:'none' }}
                placeholder={ph} />
            </div>
          ))}
          <button type="submit" disabled={loading} style={{ width:'100%', padding:'11px', background:'#378add', border:'none', borderRadius:8, color:'#fff', fontSize:14, fontWeight:500, marginTop:8, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Creating...' : 'Create Account'}
          </button>
        </form>
        <p style={{ textAlign:'center', marginTop:16, color:'rgba(255,255,255,0.4)', fontSize:13 }}>
          Already have an account? <Link to="/login" style={{ color:'#378add' }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
