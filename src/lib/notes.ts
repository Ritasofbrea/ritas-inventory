// Shared sticky-notes types + display helpers for the To-Do screen's Notes board.

export interface Note {
  id: string
  content: string
  created_by: string
  created_at: string
  handled: boolean
}

// "just now" / "5 min ago" / "3 hr ago" / "2 days ago" / "3 weeks ago" / "4 months ago" —
// the full timestamp (formatDateTime from lib/tasks) is shown on hover/tap instead.
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}
