'use client'

import { useEffect, useState } from 'react'
import StaffName from '@/components/StaffName'
import PhotoLightbox from './PhotoLightbox'
import { staffColorFor, pastelTint, computeAckDenominator } from '@/lib/staffColor'
import { getKnownPrivateNoteAuthors } from '@/lib/auth'
import { Staff, formatDateShort, formatDateTime } from '@/lib/tasks'
import { Note, groupArchivedNotesByDay, notesVisibilityParams } from '@/lib/notes'

// Read-only record of every archived note (manual Delete, or auto-archived
// the moment an ack-required note's acknowledgment count hit its required
// total — see notes-server.ts) — grouped by the day it was archived, newest
// first. No restore/un-archive, no hard-delete, nothing to interact with
// here (patch 17); just the full picture of what was said, who replied, and
// — for ack-required notes — who acknowledged, when, and whether this one
// archived manually or automatically via full acknowledgment.
export default function NotesHistoryModal({
  staff,
  shiftLeads,
  isOwner,
  onClose,
}: {
  staff: Staff[]
  shiftLeads: { name: string }[]
  isOwner: boolean
  onClose: () => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  useEffect(() => {
    const qs = notesVisibilityParams(isOwner, getKnownPrivateNoteAuthors())
    fetch(`/api/notes/history${qs ? `?${qs}` : ''}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(setNotes)
      .catch(() => setError('Could not load Notes History. Try again.'))
      .finally(() => setLoading(false))
  }, [isOwner])

  const dayGroups = groupArchivedNotesByDay(notes)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-3 flex items-center justify-between flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-900">Notes History</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl leading-none px-2" aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 flex flex-col gap-5">
          {loading && <p className="text-gray-400 text-sm text-center py-6">Loading…</p>}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {!loading && !error && notes.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-6">No archived notes yet.</p>
          )}

          {dayGroups.map((group) => (
            <section key={group.date}>
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">{formatDateShort(group.date)}</h3>
              <div className="flex flex-col gap-2">
                {group.notes.map((n) => {
                  const authorColor = staffColorFor(n.created_by, staff)
                  const ackedNames = n.acknowledgments.map((a) => a.staff_name)
                  const ackDenominator = n.requires_ack
                    ? computeAckDenominator(staff.map((s) => s.name), shiftLeads.map((sl) => sl.name), n.created_by)
                    : 0
                  const autoArchived = n.requires_ack && ackDenominator > 0 && ackedNames.length >= ackDenominator
                  return (
                    <div
                      key={n.id}
                      className={`rounded-2xl border px-4 py-3 ${authorColor ? '' : 'bg-gray-50 border-gray-200'}`}
                      style={authorColor ? { backgroundColor: pastelTint(authorColor, 0.92), borderColor: pastelTint(authorColor, 0.75) } : undefined}
                    >
                      {(n.requires_ack || n.owner_only) && (
                        <div className="mb-2 flex items-center gap-1.5 flex-wrap">
                          {n.requires_ack && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-white bg-fuchsia-600 px-2 py-0.5 rounded-full">
                              ⚠ Action Needed
                            </span>
                          )}
                          {n.owner_only && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-white bg-gray-700 px-2 py-0.5 rounded-full">
                              🔒 Private to Ownership
                            </span>
                          )}
                        </div>
                      )}
                      <p className="text-gray-900 whitespace-pre-wrap">{n.content}</p>
                      {n.photos.length > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          {n.photos.map((p) => (
                            <button key={p.id ?? p.photo_url} type="button" onClick={() => setLightboxUrl(p.photo_url)} className="block">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.photo_url} alt="Note photo" className="w-20 h-20 rounded-lg object-cover border border-gray-200" />
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        <StaffName name={n.created_by} staff={staff} /> · created {formatDateTime(n.created_at)}
                        {n.archived_at && <> · archived {formatDateTime(n.archived_at)}</>}
                      </p>

                      {n.replies.length > 0 && (
                        <div className="mt-2 pl-3 border-l-2 border-gray-200 flex flex-col gap-1.5">
                          {n.replies.map((r) => (
                            <div key={r.id}>
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.content}</p>
                              <p className="text-xs text-gray-400">
                                <StaffName name={r.created_by} staff={staff} /> · {formatDateTime(r.created_at)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {n.requires_ack && (
                        <div className="mt-2 text-xs text-gray-500">
                          <p>{autoArchived ? 'Archived automatically — fully acknowledged' : 'Archived manually'}</p>
                          {ackedNames.length === 0 ? (
                            <p>No acknowledgments recorded.</p>
                          ) : (
                            <ul className="mt-1 flex flex-col gap-0.5">
                              {n.acknowledgments.map((a) => (
                                <li key={a.staff_name}>
                                  <StaffName name={a.staff_name} staff={staff} /> · {formatDateTime(a.acknowledged_at)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {lightboxUrl && (
        <div onClick={(e) => e.stopPropagation()}>
          <PhotoLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
        </div>
      )}
    </div>
  )
}
