import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bt_user')) } catch { return null }
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('bt_token')
    if (!token) { setLoading(false); return }
    api.get('/auth/me')
      .then(r => { setUser(r.data.user); localStorage.setItem('bt_user', JSON.stringify(r.data.user)) })
      .catch(() => { localStorage.removeItem('bt_token'); localStorage.removeItem('bt_user'); setUser(null) })
      .finally(() => setLoading(false))
  }, [])

  const login = async (email, password) => {
    const r = await api.post('/auth/login', { email, password })
    localStorage.setItem('bt_token', r.data.token)
    localStorage.setItem('bt_user', JSON.stringify(r.data.user))
    setUser(r.data.user)
    return r.data.user
  }

  const logout = () => {
    localStorage.removeItem('bt_token')
    localStorage.removeItem('bt_user')
    setUser(null)
  }

  return <AuthCtx.Provider value={{ user, login, logout, loading }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
