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

import { checkQuota, pluginDocsHelp } from '@aglyn/aglyn'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { type ConsolePluginPageProps } from '@aglyn/aglyn'
import { type HostBookingService, isBookingReminderDue } from '../model'
// The CRM's route builder and hub hook by their leaf paths, not the plugin
// barrel: the barrel is the CRM's site entry point, and a console page
// named there would ship to every published page.
import { useCrmHubPathFromRoute } from '@aglyn/plugins-crm/hooks/use-crm-hub-path'
import { crmRoutes } from '@aglyn/plugins-crm/model/crm-routes'
import { AppLink, CardDisplay, HelpTip, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
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
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

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
  // The id token the refund route authenticates with (AGL-2315).
  const { data: user } = useUser()
  /*
   * Where a booker's CONTACT is (AGL-2622). A booking updated a person in
   * the CRM by the address it carried, and the row links there by that
   * address — the Contacts list holds the id nothing here does and opens
   * the record on one match. `null` until the route params settle, so no
   * row renders a link to nowhere.
   */
  const crmHubPath = useCrmHubPathFromRoute()

  const {
    data: serviceDocs,
    status: servicesStatus,
    /**
     * The rows this editor is seeded from are unconfirmed by the server
     * (AGL-1358). Editing copies a whole stored service into `draft` and
     * writes all of it back, so `merge: true` protects nothing. `windows` is
     * the weekly availability map, rebuilt in full on every save: a cached
     * seed re-opens slots that were closed and closes ones customers can
     * already book, and `priceUsd` goes back to whatever that snapshot
     * charged.
     */
    fromCache: servicesFromCache,
  } = useFirestoreCollection<any>(
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

  /**
   * The 24-hour reminder queue (AGL-2431).
   *
   * Reminders are sent by the `booking-reminders` beat, not by anything on
   * this page, and until that beat existed they were never sent at all — the
   * feature had a designed email template, white-label branding and an
   * `x-cron-secret` door, and no scheduler pointed at it. So the merchant had
   * no way to tell working from broken, and still would not if this card
   * merely asserted that reminders happen.
   *
   * READ-ONLY, and deliberately no "send now" button: the beat runs hourly
   * and stamps `reminderSentAt`, so a manual sender would race it for a
   * reminder nobody can un-send. Same call AGL-2227 made for the recovery
   * queue.
   *
   * `isBookingReminderDue` is the sender's own predicate, against one instant
   * shared by both counts, so this is the queue the next pass will drain
   * rather than an approximation of it.
   */
  const reminderNowMs = Date.now()
  const reminderQueue = (bookingDocs ?? []).filter((booking: any) =>
    isBookingReminderDue(booking, reminderNowMs),
  ).length
  const remindersSent = (bookingDocs ?? []).filter(
    (booking: any) => booking.reminderSentAt,
  ).length

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
        /**
         * Edit stays client-direct (no quota consumed) — and is refused when
         * its seed was never confirmed by the server (AGL-1358). `fields` is
         * every editable key of the stored service, `windows` included, so
         * `merge: true` has nothing left to protect.
         *
         * The guard WRAPS the write. An early return is a shape you can keep
         * while losing the protection; here the write is only reachable
         * through the verdict.
         */
        const verdict = await writeGuardedBySeed(
          {
            subject: 'service',
            unreadable: servicesStatus === 'error',
            fromCache: servicesFromCache,
          },
          async () => {
            await setDoc(
              doc(firestore, 'hosts', hostId, 'services', draft.id),
              { ...fields, updatedAt: Timestamp.now() },
              { merge: true },
            )
          },
        )
        // Before `setDraft(null)`, so a refusal keeps the dialog open with
        // every window that was typed. A save that silently does nothing
        // sends the user back to retype a form that will be refused again
        // just as quietly.
        if (!verdict.ok) {
          return void enqueueSnackbar(verdict.message, {
            variant: 'warning',
            persist: false,
          })
        }
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
  }, [
    draft,
    firestore,
    hostId,
    createHostResource,
    enqueueSnackbar,
    servicesStatus,
    servicesFromCache,
  ])

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

  /**
   * Cancelling a PAID booking refunds the guest (AGL-2315).
   *
   * This used to be one `updateDoc` writing `status: 'canceled'`, for a paid
   * booking exactly as for a free one. The slot reopened, the appointment was
   * gone, and the guest had paid for it — the money moved nowhere and nothing
   * in the console said so. That was survivable only while the charge settled
   * in Aglyn's own balance and could be given back by hand; a paid booking is
   * a destination charge now, so the funds are at the MERCHANT and there is no
   * later opportunity to notice.
   *
   * So a paid booking cancels through the refund route, which reverses the
   * merchant's share and Aglyn's fee, and which sets `canceled` itself once
   * the money is actually back. A FAILED refund deliberately leaves the
   * booking standing: a cancelled-and-unrefunded appointment is the worst of
   * the three outcomes, and an admin who sees the row still there knows the
   * cancel did not happen.
   */
  const handleCancelBooking = useCallback(
    (booking: any) => async () => {
      const paidCents = Math.max(0, Number(booking.paidAmountCents ?? 0))
      const refundedCents = Math.max(0, Number(booking.refundedCents ?? 0))
      const outstandingCents = Math.max(0, paidCents - refundedCents)
      const refundable = outstandingCents > 0
      const confirmed = await confirm({
        title: 'Cancel this booking?',
        description:
          `${booking.name} (${booking.email}) — the slot reopens.` +
          (refundable
            ? ` $${(outstandingCents / 100).toFixed(2)} is refunded to them` +
              ' through Stripe.'
            : ''),
        confirmationText: refundable ? 'Cancel and refund' : 'Cancel booking',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return

      if (refundable) {
        // `randomUUID` needs a secure context, which the console always is,
        // but fall back rather than throw on a refund.
        const attemptKey =
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`
        try {
          const response = await authorizedFetch(user, '/api/bookings/refund', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': attemptKey,
            },
            body: JSON.stringify({ hostId, bookingId: booking.$id }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok) {
            // A 409 is a guard REFUSING with a body that says what to do
            // instead — a booking paid before the PaymentIntent was recorded
            // names the Stripe dashboard — not the refund machinery failing.
            // It surfaces verbatim, the AGL-1818 rule.
            enqueueSnackbar(payload?.error ?? 'Refund failed', {
              variant: response.status === 409 ? 'warning' : 'error',
              allowDuplicate: true,
            })
            // The booking stays. See the note above: cancelled-and-unrefunded
            // is worse than not cancelled.
            return
          }
          // The route wrote `canceled` itself once the money was back.
          enqueueSnackbar('Booking canceled and refunded', {
            variant: 'success',
            persist: false,
          })
          return
        } catch {
          enqueueSnackbar('Refund failed — the booking was not canceled', {
            variant: 'error',
            allowDuplicate: true,
          })
          return
        }
      }

      await updateDoc(
        doc(firestore, 'hosts', hostId, 'bookings', booking.$id),
        { status: 'canceled' },
      )
      enqueueSnackbar('Booking canceled', {
        variant: 'success',
        persist: false,
      })
    },
    [confirm, firestore, hostId, enqueueSnackbar, user],
  )

  return (
    <Stack spacing={3}>
      <CardDisplay
        header={'Services'}
        help={pluginDocsHelp('bookings', {
        anchor: '#set-up-bookings',
        excerpt:
          'The bookable services this site offers — how long each takes, ' +
          'what it costs, and the hours it can be booked in.',
      })}
        contentGutterX
        contentGutterY
      >
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
            color="primary"
            sx={{ alignSelf: 'flex-start' }}
            onClick={handleAdd}
          >
            {'Add service'}
          </Button>
          {/* The cap, standing rather than only on refusal (AGL-2113).
              `services.length` is the same count `handleAdd` hands to
              `checkQuota`, so the readout and the gate cannot disagree. */}
          <QuotaReadoutComponent
            ready={org != null}
            used={services.length}
            limit={checkQuota(org, 'servicesPerHost', services.length).limit}
            noun="service"
          />
        </Stack>
      </CardDisplay>

      <CardDisplay
        header={'Upcoming bookings'}
        help={pluginDocsHelp('bookings', {
        anchor: '#manage',
        excerpt:
          'Bookings taken on this site, with the customer and the slot each ' +
          'one holds.',
      })}
        contentGutterX
        contentGutterY
      >
        {/* What the reminder beat will do next, and what it has done. Named
            "24-hour reminders" rather than "emails" because that is the only
            mail this queue governs — confirmations go out on booking. */}
        <Typography
          variant="caption"
          color="text.secondary"
          component="div"
          sx={{ mb: 1 }}
        >
          {`24-hour reminders · ${reminderQueue} due in the next pass · ` +
            `${remindersSent} already sent`}
          {/* Its OWN heading, not the card's `#manage`: a merchant reading
              this line wants the timing and the once-only rule, and landing
              them on "manage your bookings" is the presence-not-correctness
              failure a help-coverage check cannot see. */}
          <HelpTip
            {...pluginDocsHelp('bookings', { anchor: '#reminders' })}
            sx={{ ml: 0.5, fontSize: '0.9em' }}
          />
        </Typography>
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
                {crmHubPath && booking.email ? (
                  <Button
                    component={AppLink as any}
                    {...({ componentVariant: 'naked', nativeButton: false } as any)}
                    href={crmRoutes(crmHubPath).contactByEmail(String(booking.email))}
                    size="small"
                  >
                    {'View in CRM'}
                  </Button>
                ) : null}
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
              // WHAT THIS PRICE DOES NOT INCLUDE (AGL-2028).
              //
              // A paid booking is charged exactly this figure: the handler
              // sends no tax parameter at all, by a stated decision (AGL-2000)
              // — whether a service is taxable is jurisdiction-specific and
              // frequently the opposite answer from goods, so applying the
              // commerce plugin's GOODS sales rate would be confidently wrong
              // rather than merely absent.
              //
              // That decision was recorded in the source and in the
              // `storefrontTaxCollected` ledger, and in neither place can the
              // merchant see it. A service business is one of the three named
              // ICPs, and one who configured a rate in Commerce → Settings →
              // Taxes has every reason to assume it covers the appointments
              // they sell on the same site. Saying so here is the half of
              // AGL-2028 that holds however the rate question is answered.
              //
              // States the MECHANISM and makes no remittance determination —
              // the same line `describeOrderTaxMode` holds. Who owes which
              // authority what attaches by operation of law and is counsel's
              // call (AGL-1904/AGL-1956).
              helperText={`${PLATFORM_BRAND_NAME} charges this price as typed — no tax is added. Your Commerce tax settings are a goods sales rate and do not apply to bookings.`}
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
            color="primary"
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
