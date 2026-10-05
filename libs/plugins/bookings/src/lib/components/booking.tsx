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

import * as Aglyn from '@aglyn/aglyn'
import {
  buildBeginCheckoutParams,
  trackEvent,
  trackEventBeforeNavigation,
} from '@aglyn/aglyn/app-utils/analytics-events'
import { utmTouchField } from '@aglyn/aglyn/app-utils/utm-touch'
import { mdiCalendarClock } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  BOOKING_RECORD_PARAM,
  BOOKING_SERVICE_PARAM,
  formatBookingRecordRef,
  parseBookingRecordRef,
} from '../model/booking-record'
import { BOOKING_MAX_DAYS_AHEAD, BOOKING_SLOT_PAGE_DAYS } from '../model/bookings'
import { generatePresetId } from '../utils/generate-preset-id'
import { useBookingPurchaseEvent } from '../utils/use-booking-purchase-event'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'booking'

export interface BookingProps {
  /** Heading above the widget; empty hides it. */
  heading?: string
  successMessage?: string
}

interface ServiceOption {
  $id: string
  name: string
  durationMinutes: number
  priceUsd: number
  description?: string
}

/**
 * One query value off the page the widget is on, or `null` — on the server
 * and in the besigner there is no page to read.
 *
 * A booking link built from a CRM record carries two (AGL-2660): the
 * service it is about, and the record it was dropped from. Read at the
 * moment each is needed rather than held in state, so a widget mounted
 * before the URL settles still sees the values.
 */
function readLinkParam(key: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(key)
}

interface SlotOption {
  startsAtMs: number
  endsAtMs: number
}

/** One day of the strip: the visitor's local calendar day and its times. */
export interface BookingSlotDay {
  /** Local midnight that starts the day, in epoch ms — key and sort order. */
  startMs: number
  slots: SlotOption[]
}

/**
 * Slots grouped by the VISITOR's local day, in order (AGL-3492).
 *
 * A page of the listing is whole days in the SERVICE's zone, so for a
 * visitor in another zone the last day of a page can be one the page ended
 * part way through. `nextFromMs` is where the page stopped — every open time
 * before it is loaded — so a day that runs past it is held back until the
 * next page completes it, rather than shown with its later times missing.
 */
export function groupSlotsByLocalDay(
  slots: SlotOption[],
  nextFromMs: number | null,
): BookingSlotDay[] {
  const byDay = new Map<number, SlotOption[]>()
  for (const slot of slots) {
    const at = new Date(slot.startsAtMs)
    const startMs = new Date(
      at.getFullYear(),
      at.getMonth(),
      at.getDate(),
    ).getTime()
    const day = byDay.get(startMs)
    if (day) day.push(slot)
    else byDay.set(startMs, [slot])
  }
  return [...byDay.entries()]
    .map(([startMs, daySlots]) => ({
      startMs,
      slots: daySlots.sort((a, b) => a.startsAtMs - b.startsAtMs),
    }))
    .filter((day) => {
      if (nextFromMs === null) return true
      const start = new Date(day.startMs)
      const nextDayMs = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + 1,
      ).getTime()
      return nextDayMs <= nextFromMs
    })
    .sort((a, b) => a.startMs - b.startMs)
}

/** A day chip's label: `Mon, Oct 5` in the visitor's locale. */
export function bookingDayLabel(startMs: number): string {
  return new Date(startMs).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** A time chip's label: `2:30 PM` in the visitor's locale. */
export function bookingTimeLabel(startsAtMs: number): string {
  return new Date(startsAtMs).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * A day's times in the parts of the day a visitor scans for (AGL-3492): a
 * day open 8 to 5 at 15-minute steps holds 33 starts, and one unbroken run
 * of chips that long reads as noise. Empty parts are left out.
 */
export function partsOfDay(
  slots: SlotOption[],
): Array<{ label: string; slots: SlotOption[] }> {
  const parts = [
    { label: 'Morning', slots: [] as SlotOption[] },
    { label: 'Afternoon', slots: [] as SlotOption[] },
    { label: 'Evening', slots: [] as SlotOption[] },
  ]
  for (const slot of slots) {
    const hour = new Date(slot.startsAtMs).getHours()
    parts[hour < 12 ? 0 : hour < 17 ? 1 : 2].slots.push(slot)
  }
  return parts.filter((part) => part.slots.length > 0)
}

/**
 * Booking widget (AGL-160): service picker → open-slot picker → contact
 * form, driven by the tenant /api/bookings endpoints (server-validated,
 * double-booking safe). Inert placeholder in the besigner/preview (no
 * SiteContext host id) so editing never creates bookings.
 */
const Booking = forwardRef<HTMLDivElement, BookingProps>((props, ref) => {
  const { heading, successMessage, ...rest } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { hostId } = Aglyn.useSite()
  const siteFetch = Aglyn.useSiteFetch()

  // The merchant's own `purchase` for a paid booking (AGL-2481). This widget
  // is where Stripe returns the guest, because a tenant site has no booking
  // confirmation route. No-ops on every ordinary render: the hook returns
  // immediately unless the URL carries `?booking=paid&session_id=…`.
  useBookingPurchaseEvent(hostId, siteFetch)

  const [services, setServices] = useState<ServiceOption[] | null>(null)
  const [serviceId, setServiceId] = useState('')
  // Every page of the listing loaded so far, in order (AGL-3492).
  const [slots, setSlots] = useState<SlotOption[] | null>(null)
  // Where the next page starts; `null` once the horizon is loaded.
  const [nextFromMs, setNextFromMs] = useState<number | null>(null)
  const [horizonDays, setHorizonDays] = useState(BOOKING_MAX_DAYS_AHEAD)
  const [loadingMore, setLoadingMore] = useState(false)
  // The first day of the strip on screen, as an index into the loaded days.
  const [stripStart, setStripStart] = useState(0)
  // The service the loaded pages belong to, so a page that lands after the
  // visitor switched service is dropped rather than mixed into the new one.
  const slotsServiceRef = useRef('')
  const [slotMs, setSlotMs] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'booking' | 'booked' | 'error'
  >('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<
    Array<{ message: string; severity?: string }>
  >([])

  useEffect(() => {
    if (!hostId) return
    let active = true
    void fetch(`/api/bookings/slots?hostId=${encodeURIComponent(hostId)}`)
      .then((response) => response.json())
      .then((payload) => {
        if (!active) return
        const loaded: ServiceOption[] = payload?.services ?? []
        setServices(loaded)
        // A booking link opens the widget on its service (AGL-2660). Only
        // a service the site still offers: a link to one since deleted
        // leaves the picker for the visitor rather than failing on it.
        const wanted = readLinkParam(BOOKING_SERVICE_PARAM)
        if (wanted && loaded.some((one) => one.$id === wanted)) {
          setServiceId(wanted)
        }
      })
      .catch(() => {
        if (active) setServices([])
      })
    return () => {
      active = false
    }
  }, [hostId])

  /**
   * One page of the listing (AGL-3492): the next strip's worth of days from
   * `fromMs`, or from now. Appended, never replacing, so a day split across
   * two pages for a visitor in another zone is whole once both are in.
   */
  const fetchSlotPage = useCallback(
    async (forService: string, fromMs: number | null) => {
      const response = await fetch(
        `/api/bookings/slots?hostId=${encodeURIComponent(hostId ?? '')}` +
          `&serviceId=${encodeURIComponent(forService)}` +
          (fromMs !== null ? `&from=${encodeURIComponent(String(fromMs))}` : ''),
      )
      const payload = await response.json()
      if (slotsServiceRef.current !== forService) return
      const page: SlotOption[] = Array.isArray(payload?.slots)
        ? payload.slots
        : []
      setSlots((loaded) => {
        const seen = new Set((loaded ?? []).map((slot) => slot.startsAtMs))
        return [
          ...(loaded ?? []),
          ...page.filter((slot) => !seen.has(slot.startsAtMs)),
        ]
      })
      setNextFromMs(
        typeof payload?.nextFromMs === 'number' ? payload.nextFromMs : null,
      )
      if (Number(payload?.horizonDays) > 0) {
        setHorizonDays(Number(payload.horizonDays))
      }
    },
    [hostId],
  )

  useEffect(() => {
    slotsServiceRef.current = serviceId
    setSlots(null)
    setNextFromMs(null)
    setStripStart(0)
    setSlotMs(null)
    if (!hostId || !serviceId) return
    fetchSlotPage(serviceId, null).catch(() => {
      if (slotsServiceRef.current === serviceId) setSlots([])
    })
  }, [hostId, serviceId, fetchSlotPage])

  const days = useMemo(
    () => groupSlotsByLocalDay(slots ?? [], nextFromMs),
    [slots, nextFromMs],
  )
  const visibleDays = days.slice(stripStart, stripStart + BOOKING_SLOT_PAGE_DAYS)

  // The strip asks for the next page itself when the days it is showing run
  // out before the horizon does — after "Later dates", or when a page held
  // no open day this visitor can see whole.
  useEffect(() => {
    if (slots === null || nextFromMs === null || loadingMore) return
    if (days.length >= stripStart + BOOKING_SLOT_PAGE_DAYS) return
    if (stripStart === 0 && days.length > 0) return
    const forService = serviceId
    setLoadingMore(true)
    fetchSlotPage(forService, nextFromMs)
      .catch(() => {
        // Stop asking: a page that failed would otherwise be asked for
        // again on every render.
        if (slotsServiceRef.current === forService) setNextFromMs(null)
      })
      .finally(() => setLoadingMore(false))
  }, [
    slots,
    nextFromMs,
    loadingMore,
    days.length,
    stripStart,
    serviceId,
    fetchSlotPage,
  ])

  const [day, setDay] = useState<number | null>(null)
  useEffect(() => {
    setDay(null)
  }, [serviceId])
  const dayTimes = useMemo(
    () => partsOfDay(days.find((one) => one.startMs === day)?.slots ?? []),
    [days, day],
  )
  const hasEarlierDates = stripStart > 0
  const hasLaterDates =
    days.length > stripStart + BOOKING_SLOT_PAGE_DAYS || nextFromMs !== null
  const moveStrip = (toStart: number) => {
    setStripStart(Math.max(0, toStart))
    setDay(null)
    setSlotMs(null)
  }

  const handleBook = useCallback(async () => {
    if (!hostId || !serviceId || !slotMs || status === 'booking') return
    setStatus('booking')
    setErrorMessage(null)
    // The record a booking link was dropped from (AGL-2660), carried onto
    // the request so the booking lands on that record even when the visitor
    // books with a different address. Parsed here so a value that is not a
    // reference is never sent.
    const recordRef = parseBookingRecordRef(readLinkParam(BOOKING_RECORD_PARAM))
    try {
      const response = await siteFetch('/api/bookings/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          serviceId,
          startsAtMs: slotMs,
          name,
          email,
          ...(recordRef ? { crmRef: formatBookingRecordRef(recordRef) } : {}),
          ...(marketingConsent ? { marketingConsent: true } : {}),
          // The campaign this visitor came from, when they came from one.
          // A booking is an identify moment like a form submission: the
          // visitor was anonymous until this request named them.
          ...utmTouchField(),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setErrorMessage(payload?.error ?? 'Booking failed — try again')
        setStatus('error')
        return
      }
      if (payload?.checkoutUrl) {
        // Paid service (AGL-170): finish payment on Stripe; the webhook
        // confirms the held slot.
        //
        // The `begin_checkout` that `purchase` has never had a counterpart to
        // (AGL-2481 wired the completion and left the intent). Without it a
        // merchant selling appointments sees a purchase with no checkout step
        // in front of it, so GA4's shopping funnel reports every paid booking
        // as an abandoned one — the same shape the bookings plugin was
        // reporting before it sent anything at all.
        //
        // After the server accepted the hold, so a double-booked slot or a
        // closed calendar — both of which answer !ok above — never counts.
        //
        // `item_id` is the SERVICE id, matching the id
        // `buildBookingPurchaseParams` puts on the completed hit, so the two
        // steps join into one per-service funnel instead of naming the same
        // service twice.
        const service = (services ?? []).find((one) => one.$id === serviceId)
        await trackEventBeforeNavigation(
          'begin_checkout',
          buildBeginCheckoutParams({
            items: [
              {
                item_id: serviceId,
                item_name: service?.name ?? 'Service',
                price: service?.priceUsd,
                quantity: 1,
              },
            ],
          }),
        )
        window.location.assign(payload.checkoutUrl)
        return
      }
      if (Array.isArray(payload?.alerts)) setAlerts(payload.alerts)
      // A FREE booking is confirmed right here — there is no Stripe leg, so
      // nothing downstream will ever report it, and a merchant whose services
      // are free saw an appointment book with no event of any kind.
      //
      // `generate_lead` rather than a zero-value `purchase`: GA4 has no
      // recommended booking event, `purchase` with `value: 0` would put a
      // free appointment into the merchant's revenue reports as a sale worth
      // nothing, and a confirmed request for someone's time IS the lead this
      // event names. The form's own generic submissions report the same event
      // from `form.tsx`, so the merchant reads one conversion count.
      //
      // `form_name` is the block, not the service and never the guest: the
      // name and email typed above are the reason this is the only param
      // shape that may leave here.
      trackEvent('generate_lead', {
        form_name: 'Booking',
        form_location: window.location.pathname,
      })
      setStatus('booked')
    } catch {
      setErrorMessage('Booking failed — try again')
      setStatus('error')
    }
  }, [
    hostId,
    serviceId,
    slotMs,
    name,
    email,
    marketingConsent,
    status,
    siteFetch,
    // Read for the checkout event's item name and price. Without it the
    // handler closes over the services list as it was when the handler was
    // created, which on the first render is `null` — and every paid booking
    // would report an unnamed, unpriced service.
    services,
  ])

  if (!hostId) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[
          {
            p: 3,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 1,
            color: 'text.secondary',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
          },
          ...nodeSx,
        ]}
      >
        {'Booking widget — visitors pick a service and time here'}
      </Box>
    )
  }

  if (status === 'booked') {
    return (
      <Stack ref={ref} spacing={1.5} {...rest}>
        <Alert severity="success">
          {successMessage ||
            'Booking confirmed — check your email for the details.'}
        </Alert>
        {alerts.map((alert, index) => (
          <Alert key={index} severity={(alert.severity as any) || 'info'}>
            {alert.message}
          </Alert>
        ))}
      </Stack>
    )
  }

  const selected = (services ?? []).find(
    (service) => service.$id === serviceId,
  )

  return (
    <Stack ref={ref} spacing={2} {...rest}>
      {heading ? <Typography variant="h5">{heading}</Typography> : null}
      {services === null ? (
        <CircularProgress size={24} />
      ) : services.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No bookable services yet.'}
        </Typography>
      ) : (
        <TextField
          select
          label="Service"
          value={serviceId}
          onChange={(event) => setServiceId(event.target.value)}
          size="small"
          fullWidth
        >
          {services.map((service) => (
            <MenuItem key={service.$id} value={service.$id}>
              {`${service.name} · ${service.durationMinutes} min` +
                (service.priceUsd > 0 ? ` · $${service.priceUsd}` : '')}
            </MenuItem>
          ))}
        </TextField>
      )}
      {selected?.description ? (
        <Typography variant="body2" color="text.secondary">
          {selected.description}
        </Typography>
      ) : null}
      {serviceId ? (
        slots === null || (days.length === 0 && nextFromMs !== null) ? (
          <CircularProgress size={24} />
        ) : days.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {`No open times in the next ${horizonDays} days.`}
          </Typography>
        ) : (
          <>
            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: 'wrap', rowGap: 1 }}
            >
              {visibleDays.map((one) => (
                <Chip
                  key={one.startMs}
                  label={bookingDayLabel(one.startMs)}
                  color={day === one.startMs ? 'primary' : 'default'}
                  variant={day === one.startMs ? 'filled' : 'outlined'}
                  onClick={() => {
                    setDay(one.startMs)
                    setSlotMs(null)
                  }}
                />
              ))}
              {loadingMore && visibleDays.length < BOOKING_SLOT_PAGE_DAYS ? (
                <CircularProgress size={20} sx={{ alignSelf: 'center' }} />
              ) : null}
            </Stack>
            {hasEarlierDates || hasLaterDates ? (
              <Stack direction="row" spacing={1}>
                {hasEarlierDates ? (
                  <Button
                    size="small"
                    onClick={() =>
                      moveStrip(stripStart - BOOKING_SLOT_PAGE_DAYS)
                    }
                  >
                    {'Earlier dates'}
                  </Button>
                ) : null}
                {hasLaterDates ? (
                  <Button
                    size="small"
                    disabled={
                      loadingMore && visibleDays.length < BOOKING_SLOT_PAGE_DAYS
                    }
                    // Never past the last day loaded: a strip that was short
                    // moves on from where it ended, so no day is stepped over
                    // while the next page loads.
                    onClick={() =>
                      moveStrip(
                        Math.min(
                          stripStart + BOOKING_SLOT_PAGE_DAYS,
                          days.length,
                        ),
                      )
                    }
                  >
                    {'Later dates'}
                  </Button>
                ) : null}
              </Stack>
            ) : null}
            {day !== null ? (
              <Stack spacing={1.5}>
                {dayTimes.map((part) => (
                  <Stack key={part.label} spacing={0.75}>
                    <Typography variant="caption" color="text.secondary">
                      {part.label}
                    </Typography>
                    <Box
                      role="group"
                      aria-label={`${part.label} times`}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fill, minmax(5.5rem, 1fr))',
                        gap: 1,
                      }}
                    >
                      {part.slots.map((slot) => (
                        <Chip
                          key={slot.startsAtMs}
                          label={bookingTimeLabel(slot.startsAtMs)}
                          color={
                            slotMs === slot.startsAtMs ? 'primary' : 'default'
                          }
                          variant={
                            slotMs === slot.startsAtMs ? 'filled' : 'outlined'
                          }
                          onClick={() => setSlotMs(slot.startsAtMs)}
                        />
                      ))}
                    </Box>
                  </Stack>
                ))}
              </Stack>
            ) : null}
          </>
        )
      ) : null}
      {slotMs ? (
        <Stack spacing={1.5}>
          <TextField
            label="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            size="small"
            fullWidth
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={marketingConsent}
                onChange={(event) =>
                  setMarketingConsent(event.target.checked)
                }
              />
            }
            label="Email me about offers and updates"
          />
          {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
          <Button
            variant="contained"
            disabled={
              !name.trim() || !email.trim() || status === 'booking'
            }
            onClick={handleBook}
            sx={{ alignSelf: 'flex-start' }}
          >
            {status === 'booking' ? 'Booking…' : 'Confirm booking'}
          </Button>
        </Stack>
      ) : null}
    </Stack>
  )
})
Booking.displayName = 'Booking'

export const schema: Aglyn.ComponentSchema<BookingProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Booking',
  description:
    'Service and time picker that books appointments. It is double-booking safe.',
  category: Aglyn.ComponentCategory.INPUT,
  icon: {
    path: mdiCalendarClock.path,
    sx: { color: '#0288d1' },
  },
  flags: {
    selfClosing: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    {
      name: 'heading',
      description: 'Heading above the widget; empty hides it.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Heading',
    },
    {
      name: 'successMessage',
      description: 'Shown after a confirmed booking.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Success message',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Booking',
    pluginId: BUNDLE_ID,
    description: 'Service + time picker that books appointments',
    category: Aglyn.ComponentCategory.INPUT,
    icon: {
      path: mdiCalendarClock.path,
      sx: { color: '#0288d1' },
    },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default Booking
