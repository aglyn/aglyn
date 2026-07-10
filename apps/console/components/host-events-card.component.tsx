/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use client'

import { createResourceUid } from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'
import useFirestoreCollection from '../hooks/use-firestore-collection'

interface EventDraft {
  id: string | null
  title: string
  startsAt: string
  endsAt: string
  location: string
  organizer: string
  description: string
  coverImage: string
  status: 'draft' | 'published'
}

/** datetime-local ↔ epoch-ms without timezone surprises. */
function toLocalInput(ms: number | null | undefined): string {
  if (!ms) return ''
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/**
 * Events manager (AGL-145): the Event Calendar add-on's console surface —
 * events with schedule/location/organizer/cover, draft/published status.
 * Gated by the paid `eventCalendar` entitlement ($9/mo add-on); visitors
 * see published events through the Event List canvas element.
 */
export function HostEventsCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()
  const entitled = hasEntitlement('event-calendar', tenant)

  const { data: eventDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'events'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const events = [...(eventDocs ?? [])]
    .filter((event: any) => !event.deletedAt)
    .sort((a: any, b: any) => (b.startsAtMs ?? 0) - (a.startsAtMs ?? 0))

  const [draft, setDraft] = useState<EventDraft | null>(null)

  const handleSave = useCallback(async () => {
    if (!draft || !draft.title.trim()) return
    const startsAtMs = draft.startsAt ? new Date(draft.startsAt).getTime() : 0
    const endsAtMs = draft.endsAt ? new Date(draft.endsAt).getTime() : 0
    if (!startsAtMs) {
      return void enqueueSnackbar('Set a start time', {
        variant: 'warning',
        persist: false,
      })
    }
    try {
      const id = draft.id ?? createResourceUid()
      await setDoc(
        doc(firestore, 'hosts', hostId, 'events', id),
        {
          title: draft.title.trim().slice(0, 150),
          startsAtMs,
          ...(endsAtMs > startsAtMs
            ? { endsAtMs }
            : { endsAtMs: startsAtMs + 60 * 60 * 1000 }),
          ...(draft.location.trim() && {
            location: draft.location.trim().slice(0, 200),
          }),
          ...(draft.organizer.trim() && {
            organizer: draft.organizer.trim().slice(0, 100),
          }),
          ...(draft.description.trim() && {
            description: draft.description.trim().slice(0, 2000),
          }),
          ...(draft.coverImage.trim() && {
            coverImage: draft.coverImage.trim(),
          }),
          status: draft.status,
          updatedAt: Timestamp.now(),
          ...(draft.id ? {} : { createdAt: Timestamp.now() }),
        },
        { merge: true },
      )
      setDraft(null)
      enqueueSnackbar('Event saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [draft, firestore, hostId, enqueueSnackbar])

  const handleDelete = useCallback(
    (event: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this event?',
        description: `"${event.title}" disappears from your site.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(doc(firestore, 'hosts', hostId, 'events', event.$id), {
        deletedAt: Timestamp.now(),
      })
    },
    [confirm, firestore, hostId],
  )

  return (
    <CardDisplay header={'Events'} contentGutterX contentGutterY>
      {!entitled ? (
        <Alert severity="info">
          {'The Event Calendar is a paid add-on ($9/mo per site, supported ' +
            'directly by Aglyn). Ask support to enable it — self-serve ' +
            'checkout is coming.'}
        </Alert>
      ) : (
        <Stack spacing={1}>
          {events.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'Create events here, then drop an Event List element on any ' +
                'screen — published events render with SEO Event markup.'}
            </Typography>
          ) : (
            events.map((event: any) => (
              <Stack
                key={event.$id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                <Chip
                  size="small"
                  label={event.status ?? 'draft'}
                  color={event.status === 'published' ? 'success' : 'default'}
                />
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {event.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {new Date(event.startsAtMs).toLocaleString()}
                    {event.location ? ` · ${event.location}` : ''}
                  </Typography>
                </Stack>
                <Button
                  size="small"
                  onClick={() =>
                    setDraft({
                      id: event.$id,
                      title: event.title ?? '',
                      startsAt: toLocalInput(event.startsAtMs),
                      endsAt: toLocalInput(event.endsAtMs),
                      location: event.location ?? '',
                      organizer: event.organizer ?? '',
                      description: event.description ?? '',
                      coverImage: event.coverImage ?? '',
                      status: event.status ?? 'draft',
                    })
                  }
                >
                  {'Edit'}
                </Button>
                <Button size="small" color="error" onClick={handleDelete(event)}>
                  {'Delete'}
                </Button>
              </Stack>
            ))
          )}
          <Button
            size="small"
            color="secondary"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() =>
              setDraft({
                id: null,
                title: '',
                startsAt: '',
                endsAt: '',
                location: '',
                organizer: '',
                description: '',
                coverImage: '',
                status: 'draft',
              })
            }
          >
            {'Add event'}
          </Button>
        </Stack>
      )}

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{draft?.id ? 'Edit event' : 'Add event'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Title"
            value={draft?.title ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, title: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <Stack direction="row" spacing={1}>
            <TextField
              label="Starts"
              type="datetime-local"
              value={draft?.startsAt ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, startsAt: event.target.value } : prev,
                )
              }
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Ends"
              type="datetime-local"
              value={draft?.endsAt ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, endsAt: event.target.value } : prev,
                )
              }
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ flex: 1 }}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Location"
              value={draft?.location ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, location: event.target.value } : prev,
                )
              }
              size="small"
              sx={{ flex: 1 }}
            />
            <TextField
              label="Organizer"
              value={draft?.organizer ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, organizer: event.target.value } : prev,
                )
              }
              size="small"
              sx={{ flex: 1 }}
            />
          </Stack>
          <TextField
            label="Cover image URL"
            value={draft?.coverImage ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, coverImage: event.target.value } : prev,
              )
            }
            size="small"
          />
          <TextField
            label="Description"
            value={draft?.description ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={3}
          />
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          <Button
            onClick={() =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      status:
                        prev.status === 'published' ? 'draft' : 'published',
                    }
                  : prev,
              )
            }
          >
            {draft?.status === 'published' ? 'Set to draft' : 'Set published'}
          </Button>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
            <Button
              variant="contained"
              color="secondary"
              disabled={!draft?.title.trim()}
              onClick={handleSave}
            >
              {'Save event'}
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostEventsCard.displayName = 'HostEventsCard'

export default HostEventsCard
