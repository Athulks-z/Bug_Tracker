import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api from '../api'

export default function AnnouncementPopup({ user }) {
  const [pending, setPending] = useState([])
  const [acknowledging, setAcknowledging] = useState(false)
  const current = pending[0]

  const loadPending = useCallback(async () => {
    try {
      const announcements = await api.get('/settings/announcements/pending')
      setPending(announcements)
    } catch (error) {
      toast.error(error.message || 'Unable to load announcements')
    }
  }, [])

  useEffect(() => {
    if (!user) return undefined
    void loadPending()
    const timer = window.setInterval(loadPending,60000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadPending()
    }
    document.addEventListener('visibilitychange',onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange',onVisibilityChange)
    }
  }, [loadPending,user?._id])

  const acknowledge = async () => {
    if (!current || acknowledging) return
    setAcknowledging(true)
    try {
      await api.post(`/settings/announcements/${encodeURIComponent(current.id)}/acknowledge`,{})
      setPending((items) => items.filter((item) => item.id !== current.id))
    } catch (error) {
      toast.error(error.message || 'Unable to acknowledge announcement')
    } finally {
      setAcknowledging(false)
    }
  }

  if (!current) return null
  return (
    <div role="presentation" onClick={(event) => { if (event.target === event.currentTarget) void acknowledge() }}
      style={{ position:'fixed',inset:0,zIndex:1000,background:'rgba(15,23,36,0.55)',display:'grid',placeItems:'center',padding:16 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="announcement-title"
        style={{ width:'min(560px,100%)',background:'#fff',borderRadius:12,padding:24,boxShadow:'0 24px 70px rgba(0,0,0,0.25)' }}>
        <h2 id="announcement-title" style={{ fontSize:20,marginBottom:12 }}>{current.title}</h2>
        <p style={{ whiteSpace:'pre-wrap',lineHeight:1.55,color:'#334155',overflowWrap:'anywhere' }}>{current.message}</p>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:20 }}>
          {pending.length > 1 && <small style={{ color:'#64748b' }}>{pending.length} announcements</small>}
          <button type="button" className="btn btn-primary" disabled={acknowledging} onClick={acknowledge}>
            {acknowledging ? 'Saving…' : 'Got it'}
          </button>
        </div>
      </section>
    </div>
  )
}
