import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { addTemplateStep, deleteTemplateStep, moveTemplateStep, updateTemplateStepContent } from '@/lib/task-server'

// Add a step to a template's checklist (task_template_steps). Steps only
// exist on already-created templates — see TaskFormModal, which hides the
// steps editor until the template itself has been saved.
export async function POST(request: NextRequest) {
  const { template_id, content } = await request.json()
  if (typeof template_id !== 'string' || !template_id) {
    return NextResponse.json({ error: 'Missing template_id' }, { status: 400 })
  }
  if (typeof content !== 'string') return NextResponse.json({ error: 'Missing content' }, { status: 400 })
  const result = await addTemplateStep(getServerSupabase(), template_id, content)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ steps: result.steps })
}

// { id, content }: edit a step's text. { id, direction }: move it up/down
// within its template (same mechanics as task-templates/checklist-item).
export async function PATCH(request: NextRequest) {
  const body = await request.json()
  const { id } = body
  if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const db = getServerSupabase()
  if (body.direction !== undefined) {
    if (body.direction !== 'up' && body.direction !== 'down') {
      return NextResponse.json({ error: 'direction must be "up" or "down"' }, { status: 400 })
    }
    const result = await moveTemplateStep(db, id, body.direction)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ steps: result.steps })
  }
  if (typeof body.content === 'string') {
    const result = await updateTemplateStepContent(db, id, body.content)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ steps: result.steps })
  }
  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
}

// Permanently deletes a step; its checks on any instance cascade with it.
export async function DELETE(request: NextRequest) {
  const { id } = await request.json()
  if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const result = await deleteTemplateStep(getServerSupabase(), id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ steps: result.steps })
}
