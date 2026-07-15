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

import { checkQuota } from '@aglyn/aglyn'
import { type ConsolePluginPageProps } from '@aglyn/aglyn'
import { type HostBookingService } from '../model'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
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
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useHostResourceApi,
} from '@aglyn/tenant-feature-instance'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "09:00-12:00, 13:00-17:00" → open intervals in minutes. */
function parseWindows(input: string): Array<{ start: number; end: number }> {
  const windows: Array<{ start: number; end: number }> = []
  for (const chunk of input.split(',')) {
    const match = chunk.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
    if (!match) continue
    const start = Number(match[1]) * 60 + Number(match[2])
    const end = Number(match[3]) * 60 + Number(match[4])
    if (end > start && end <= 24 * 60) windows.push({ start, end })
  }
  return windows
}

function formatWindows(
  windows: Array<{ start: number; end: number }> | undefined,
): string {
  const pad = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
      minutes % 60,
    ).padStart(2, '0')}`
  return (windows ?? [])
    .map((window) => `${pad(window.start)}-${pad(window.end)}`)
    .join(', ')
}

interface ServiceDraft {
  id: string | null
  name: string
  durationMinutes: string
  priceUsd: string
  timezone: string
  description: string
  /** Per-weekday window text, e.g. "09:00-17:00". */
  windowText: string[]
}

/**
 * Bookings manager (AGL-159): bookable services with weekly availability
 * windows, and the upcoming-bookings list with cancel. Visitors book via
 * the org /api/bookings endpoints; confirmations email through the
 * env-gated Resend path. Plan-gated (`bookings` flag + `servicesPerHost`).
 */
export function BookingsConsolePage(props: ConsolePluginPageProps) {
  const { hostId, entitled, org } = props
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  const { data: serviceDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'services'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: bookingDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'bookings'),
        orderBy('startsAtMs', 'desc'),
        limit(100),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const services = [...(serviceDocs ?? [])]
    .filter((service: any) => !service.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
  const upcoming = [...(bookingDocs ?? [])]
    .filter((booking: any) => booking.endsAtMs >= Date.now())
    .sort((a: any, b: any) => a.startsAtMs - b.startsAtMs)

  const [draft, setDraft] = useState<ServiceDraft | null>(null)

  const handleAdd = useCallback(() => {
    if (!entitled) {
      return void enqueueSnackbar(
        'Bookings require a Starter plan — see Billing to upgrade',
        { variant: 'warning', persist: false },
      )
    }
    const quota = checkQuota(org, 'servicesPerHost', services.length)
    if (!quota.allowed) {
      return void enqueueSnackbar(
        `Service limit reached (${quota.limit}) — upgrade in Billing`,
        { variant: 'warning', persist: false },
      )
    }
    setDraft({
      id: null,
      name: '',
      durationMinutes: '30',
      priceUsd: '0',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      description: '',
      windowText: WEEKDAYS.map((_, index) =>
        index >= 1 && index <= 5 ? '09:00-17:00' : '',
      ),
    })
  }, [entitled, org, services.length, enqueueSnackbar])

  const handleSave = useCallback(async () => {
    if (!draft || !draft.name.trim()) return
    const windows: HostBookingService['windows'] = {}
    draft.windowText.forEach((text, weekday) => {
      const parsed = parseWindows(text)
      if (parsed.length) windows[weekday] = parsed
    })
    const fields = {
      name: draft.name.trim().slice(0, 80),
      durationMinutes: Math.max(
        5,
        Math.min(480, Math.round(Number(draft.durationMinutes) || 30)),
      ),
      priceUsd: Math.max(0, Math.round(Number(draft.priceUsd) || 0)),
      timezone: draft.timezone.trim() || 'UTC',
      ...(draft.description.trim() && {
        description: draft.description.trim().slice(0, 500),
      }),
      windows,
    }
    try {
      if (draft.id) {
        // Edit stays client-direct (no quota consumed).
        await setDoc(
          doc(firestore, 'hosts', hostId, 'services', draft.id),
          { ...fields, updatedAt: Timestamp.now() },
          { merge: true },
        )
      } else {
        // New service rides the quota-enforcing resources API (AGL-473) —
        // it also re-checks the `bookings` entitlement server-side.
        await createHostResource({ hostId, resource: 'service', data: fields })
      }
      setDraft(null)
      enqueueSnackbar('Service saved', { variant: 'success', persist: false })
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [draft, firestore, hostId, createHostResource, enqueueSnackbar])

  const handleDeleteService = useCallback(
    (service: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this service?',
        description: `"${service.name}" stops accepting bookings.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(doc(firestore, 'hosts', hostId, 'services', service.$id), {
        deletedAt: Timestamp.now(),
      })
    },
    [confirm, firestore, hostId],
  )

  const handleCancelBooking = useCallback(
    (booking: any) => async () => {
      const confirmed = await confirm({
        title: 'Cancel this booking?',
        description: `${booking.name} (${booking.email}) — the slot reopens.`,
        confirmationText: 'Cancel booking',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'bookings', booking.$id),
        { status: 'canceled' },
      )
      enqueueSnackbar('Booking canceled', {
        variant: 'success',
        persist: false,
      })
    },
    [confirm, firestore, hostId, enqueueSnackbar],
  )

  return (
    <Stack spacing={3}>
      <CardDisplay header={'Services'} contentGutterX contentGutterY>
        <Stack spacing={1}>
          {services.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'Define a bookable service — duration, price, and weekly ' +
                'availability — then visitors can book from your site.'}
            </Typography>
          ) : (
            services.map((service: any) => (
              <Stack
                key={service.$id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {service.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {`${service.durationMinutes} min` +
                      (Number(service.priceUsd) > 0
                        ? ` · $${service.priceUsd}`
                        : ' · free') +
                      ` · ${service.timezone ?? 'UTC'}`}
                  </Typography>
                </Stack>
                <Button
                  size="small"
                  onClick={() =>
                    setDraft({
                      id: service.$id,
                      name: service.name ?? '',
                      durationMinutes: String(service.durationMinutes ?? 30),
                      priceUsd: String(service.priceUsd ?? 0),
                      timezone: service.timezone ?? 'UTC',
                      description: service.description ?? '',
                      windowText: WEEKDAYS.map((_, index) =>
                        formatWindows(service.windows?.[index]),
                      ),
                    })
                  }
                >
                  {'Edit'}
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={handleDeleteService(service)}
                >
                  {'Delete'}
                </Button>
              </Stack>
            ))
          )}
          <Button
            size="small"
            color="secondary"
            sx={{ alignSelf: 'flex-start' }}
            onClick={handleAdd}
          >
            {'Add service'}
          </Button>
        </Stack>
      </CardDisplay>

      <CardDisplay header={'Upcoming bookings'} contentGutterX contentGutterY>
        {upcoming.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No upcoming bookings.'}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {upcoming.map((booking: any) => (
              <Stack
                key={booking.$id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {`${booking.serviceName} — ${booking.name}`}
                    {booking.status === 'canceled' ? ' (canceled)' : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {`${new Date(booking.startsAtMs).toLocaleString()} · ${
                      booking.email
                    }`}
                  </Typography>
                </Stack>
                {booking.status !== 'canceled' ? (
                  <Button
                    size="small"
                    color="error"
                    onClick={handleCancelBooking(booking)}
                  >
                    {'Cancel'}
                  </Button>
                ) : null}
              </Stack>
            ))}
          </Stack>
        )}
      </CardDisplay>

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{draft?.id ? 'Edit service' : 'Add service'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Name"
            value={draft?.name ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <Stack direction="row" spacing={1}>
            <TextField
              label="Duration (minutes)"
              value={draft?.durationMinutes ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        durationMinutes: event.target.value.replace(
                          /[^0-9]/g,
                          '',
                        ),
                      }
                    : prev,
                )
              }
              size="small"
            />
            <TextField
              label="Price (USD, 0 = free)"
              value={draft?.priceUsd ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        priceUsd: event.target.value.replace(/[^0-9]/g, ''),
                      }
                    : prev,
                )
              }
              size="small"
            />
            <TextField
              label="Timezone"
              value={draft?.timezone ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, timezone: event.target.value } : prev,
                )
              }
              size="small"
              sx={{ minWidth: 180 }}
            />
          </Stack>
          <TextField
            label="Description (optional)"
            value={draft?.description ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
          <Typography variant="overline" color="text.secondary">
            {'Weekly availability'}
          </Typography>
          {WEEKDAYS.map((day, index) => (
            <TextField
              key={day}
              label={day}
              placeholder="09:00-12:00, 13:00-17:00 (empty = closed)"
              value={draft?.windowText[index] ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        windowText: prev.windowText.map((text, i) =>
                          i === index ? event.target.value : text,
                        ),
                      }
                    : prev,
                )
              }
              size="small"
            />
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!draft?.name.trim()}
            onClick={handleSave}
          >
            {'Save service'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
BookingsConsolePage.displayName = 'BookingsConsolePage'

export default BookingsConsolePage
