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
import { mdiCalendarClock } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

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

interface SlotOption {
  startsAtMs: number
  endsAtMs: number
}

/**
 * Booking widget (AGL-160): service picker → open-slot picker → contact
 * form, driven by the tenant /api/bookings endpoints (server-validated,
 * double-booking safe). Inert placeholder in the besigner/preview (no
 * SiteContext host id) so editing never creates bookings.
 */
const Booking = forwardRef<HTMLDivElement, BookingProps>((props, ref) => {
  const { heading, successMessage, ...rest } = props
  const { hostId } = Aglyn.useSite()

  const [services, setServices] = useState<ServiceOption[] | null>(null)
  const [serviceId, setServiceId] = useState('')
  const [slots, setSlots] = useState<SlotOption[] | null>(null)
  const [slotMs, setSlotMs] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
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
        if (active) setServices(payload?.services ?? [])
      })
      .catch(() => {
        if (active) setServices([])
      })
    return () => {
      active = false
    }
  }, [hostId])

  useEffect(() => {
    if (!hostId || !serviceId) return setSlots(null)
    let active = true
    setSlots(null)
    setSlotMs(null)
    void fetch(
      `/api/bookings/slots?hostId=${encodeURIComponent(hostId)}` +
        `&serviceId=${encodeURIComponent(serviceId)}`,
    )
      .then((response) => response.json())
      .then((payload) => {
        if (active) setSlots(payload?.slots ?? [])
      })
      .catch(() => {
        if (active) setSlots([])
      })
    return () => {
      active = false
    }
  }, [hostId, serviceId])

  // Slots grouped by local day for a compact two-step pick.
  const slotsByDay = useMemo(() => {
    const groups: Record<string, SlotOption[]> = {}
    for (const slot of slots ?? []) {
      const day = new Date(slot.startsAtMs).toLocaleDateString()
      ;(groups[day] ??= []).push(slot)
    }
    return groups
  }, [slots])
  const [day, setDay] = useState('')
  useEffect(() => {
    setDay('')
  }, [serviceId])

  const handleBook = useCallback(async () => {
    if (!hostId || !serviceId || !slotMs || status === 'booking') return
    setStatus('booking')
    setErrorMessage(null)
    try {
      const response = await fetch('/api/bookings/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          serviceId,
          startsAtMs: slotMs,
          name,
          email,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setErrorMessage(payload?.error ?? 'Booking failed — try again')
        setStatus('error')
        return
      }
      if (Array.isArray(payload?.alerts)) setAlerts(payload.alerts)
      setStatus('booked')
    } catch {
      setErrorMessage('Booking failed — try again')
      setStatus('error')
    }
  }, [hostId, serviceId, slotMs, name, email, status])

  if (!hostId) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={{
          p: 3,
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 1,
          color: 'text.secondary',
          fontSize: 13,
          fontFamily: 'system-ui, sans-serif',
        }}
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
        slots === null ? (
          <CircularProgress size={24} />
        ) : slots.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No open times in the next 60 days.'}
          </Typography>
        ) : (
          <>
            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: 'wrap', rowGap: 1 }}
            >
              {Object.keys(slotsByDay)
                .slice(0, 14)
                .map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    color={day === value ? 'primary' : 'default'}
                    variant={day === value ? 'filled' : 'outlined'}
                    onClick={() => {
                      setDay(value)
                      setSlotMs(null)
                    }}
                  />
                ))}
            </Stack>
            {day ? (
              <Stack
                direction="row"
                spacing={1}
                sx={{ flexWrap: 'wrap', rowGap: 1 }}
              >
                {(slotsByDay[day] ?? []).slice(0, 24).map((slot) => (
                  <Chip
                    key={slot.startsAtMs}
                    label={new Date(slot.startsAtMs).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    color={slotMs === slot.startsAtMs ? 'primary' : 'default'}
                    variant={
                      slotMs === slot.startsAtMs ? 'filled' : 'outlined'
                    }
                    onClick={() => setSlotMs(slot.startsAtMs)}
                  />
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
