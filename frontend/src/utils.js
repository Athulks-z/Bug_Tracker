export const AVATAR_COLORS = [
  '#378add','#e24b4a','#1d9e75','#ef9f27','#534ab7',
  '#d4537e','#0f6e56','#3b6d11','#5f5e5a','#854f0b'
]

export function avatarColor(name = '') {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export function statusBadgeClass(status) {
  const map = { Open:'open', Reopen:'reopen', 'In progress':'inprogress', 'To do':'todo', Closed:'closed' }
  return `badge badge-${map[status] || 'open'}`
}

export function severityBadgeClass(sev) {
  return `badge badge-${(sev||'none').toLowerCase()}`
}

export function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
}
