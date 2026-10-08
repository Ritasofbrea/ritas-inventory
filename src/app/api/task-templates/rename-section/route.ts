import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { renameChecklistSection } from '@/lib/task-server'

// Renames a section label across every template (and open, not-yet-done
// instance) that has it. See renameChecklistSection for merge behavior.
export async function PATCH(request: NextRequest) {
  const { checklist_name, old_section, new_section } = await request.json()
  if (typeof checklist_name !== 'string' || !checklist_name) {
    return NextResponse.json({ error: 'Missing checklist_name' }, { status: 400 })
  }
  if (typeof old_section !== 'string' || !old_section) {
    return NextResponse.json({ error: 'Missing old_section' }, { status: 400 })
  }
  if (typeof new_section !== 'string') {
    return NextResponse.json({ error: 'Missing new_section' }, { status: 400 })
  }
  const result = await renameChecklistSection(getServerSupabase(), checklist_name, old_section, new_section)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
