import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

export default function Login() {
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const user = await login(form.email, form.password)
      toast.success(`Welcome back, ${user.name}!`)
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'linear-gradient(135deg, #0f1724 0%, #1d2a40 100%)', padding:20
    }}>
      <div style={{ width:'100%', maxWidth:400 }}>
        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginBottom:36 }}>
          <div style={{ width:44, height:44, background:'#e24b4a', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:24 }}>
            <i className="ti ti-bug" />
          </div>
          <span style={{ color:'#fff', fontWeight:700, fontSize:22, letterSpacing:'-0.02em' }}>BugTracker</span>
        </div>

        <div style={{ background:'#fff', borderRadius:16, padding:32, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
          <h1 style={{ fontSize:20, fontWeight:600, marginBottom:6 }}>Sign in</h1>
          <p style={{ color:'#6b7280', fontSize:13, marginBottom:24 }}>Enter your credentials to continue</p>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Email address</label>
              <input
                className="form-control"
                type="email" required autoFocus
                placeholder="you@company.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-control"
                type="password" required
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width:'100%', justifyContent:'center', marginTop:8 }} disabled={loading}>
              {loading ? <><i className="ti ti-loader-2" style={{ animation:'spin 1s linear infinite' }} /> Signing in...</> : 'Sign in'}
            </button>
          </form>

          <div style={{ marginTop:20, padding:'14px', background:'#f0fdf4', borderRadius:8, fontSize:12, color:'#166534', border:'1px solid #bbf7d0' }}>
            <strong>First time?</strong> Call <code style={{ fontFamily:'monospace' }}>POST /api/auth/seed-admin</code> with your email & password to create the first admin account.
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
