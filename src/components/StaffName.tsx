import { Staff } from '@/lib/tasks'
import { staffColorFor } from '@/lib/staffColor'

// Renders a staff name in that person's assigned color, wherever a name
// shows up as plain text (completed_by, "Added by", assigned_to, notes
// authorship, …) — one shared place so coloring a 4th person later doesn't
// mean touching every call site. No color assigned (or name not found,
// e.g. "Everyone") just renders as plain inherited text, unchanged.
export default function StaffName({ name, staff }: { name: string; staff: Staff[] }) {
  const color = staffColorFor(name, staff)
  return <span style={color ? { color } : undefined}>{name}</span>
}
