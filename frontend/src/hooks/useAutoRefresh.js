import { useEffect, useRef } from 'react'

export default function useAutoRefresh(refresh, intervalMs = 10000, enabled = true) {
  const refreshRef = useRef(refresh)
  const runningRef = useRef(false)

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    if (!enabled) return undefined

    let active = true
    const run = async () => {
      if (!active || document.visibilityState !== 'visible' || runningRef.current) return
      runningRef.current = true
      try {
        await refreshRef.current({ silent: true })
      } finally {
        runningRef.current = false
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void run()
    }

    const timer = window.setInterval(run, intervalMs)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', run)

    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', run)
    }
  }, [enabled, intervalMs])
}
