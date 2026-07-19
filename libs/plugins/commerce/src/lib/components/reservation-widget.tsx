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
import * as CommerceModel from '../model'
import { mdiCalendarCheckOutline } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'reservation-widget'

export interface ReservationWidgetProps {
  /** Resource id from the console Resources card. */
  resourceId?: string
  reserveLabel?: string
}

interface Availability {
  resource: CommerceModel.HostResource
  unavailable: Array<{ fromDayMs: number; toDayMs: number }>
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * Reservation widget (AGL-310): date-range picker with a live quote
 * (nights × seasonal rates + deposit due today) and a reserve flow that
 * charges the deposit through the merchant's account. The server
 * re-quotes and re-checks availability — the widget is display-only.
 */
const ReservationWidget = forwardRef<HTMLDivElement, ReservationWidgetProps>(
  (props, ref) => {
    const { resourceId, reserveLabel, ...rest } = props
    const { hostId } = Aglyn.useSite()
    const [availability, setAvailability] = useState<Availability | null>(null)
    const [checkIn, setCheckIn] = useState('')
    const [checkOut, setCheckOut] = useState('')
    const [guestName, setGuestName] = useState('')
    const [guestEmail, setGuestEmail] = useState('')
    const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle')
    const [message, setMessage] = useState('')

    useEffect(() => {
      if (!hostId || !resourceId) return
      let active = true
      void fetch(
        `/api/commerce/reservation-availability?hostId=${encodeURIComponent(hostId)}` +
          `&resourceId=${encodeURIComponent(resourceId)}`,
      )
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (active && payload) setAvailability(payload)
        })
        .catch(() => undefined)
      return () => {
        active = false
      }
    }, [hostId, resourceId])

    const checkInDayMs = checkIn ? Date.parse(`${checkIn}T00:00:00Z`) : 0
    const checkOutDayMs = checkOut ? Date.parse(`${checkOut}T00:00:00Z`) : 0

    const quote = useMemo(() => {
      if (!availability || !checkInDayMs || !checkOutDayMs) return null
      return CommerceModel.computeReservationQuote(
        availability.resource,
        checkInDayMs,
        checkOutDayMs,
      )
    }, [availability, checkInDayMs, checkOutDayMs])

    const conflict = useMemo(() => {
      if (!availability || !checkInDayMs || !checkOutDayMs) return false
      return !CommerceModel.isRangeAvailable(
        availability.resource,
        availability.unavailable.map((range) => ({
          checkInDayMs: range.fromDayMs,
          checkOutDayMs: range.toDayMs,
          status: 'confirmed' as const,
        })),
        checkInDayMs,
        checkOutDayMs,
      )
    }, [availability, checkInDayMs, checkOutDayMs])

    const handleReserve = async () => {
      if (!hostId || !resourceId || status === 'sending') return
      setStatus('sending')
      setMessage('')
      try {
        const response = await fetch('/api/commerce/reserve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            resourceId,
            checkInDayMs,
            checkOutDayMs,
            guestName,
            guestEmail,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (response.ok && payload?.url) {
          window.location.assign(payload.url)
          return
        }
        setMessage(String(payload?.error ?? ''))
        setStatus('error')
      } catch {
        setStatus('error')
      }
    }

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
          {'Reservation widget — dates, quote, and reserve render here'}
        </Box>
      )
    }
    if (!resourceId) {
      return (
        <Box ref={ref} {...rest} sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {'Set a resource id on this block (console → Resources).'}
          </Typography>
        </Box>
      )
    }

    return (
      <Box
        ref={ref}
        {...rest}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          maxWidth: 420,
          p: 2,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        {availability ? (
          <>
            <Typography variant="h6">{availability.resource.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {`From $${availability.resource.nightlyRateUsd}/night` +
                (availability.resource.minNights
                  ? ` · ${availability.resource.minNights}-night minimum`
                  : '')}
            </Typography>
          </>
        ) : null}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            label="Check-in"
            type="date"
            value={checkIn}
            onChange={(event) => setCheckIn(event.target.value)}
            size="small"
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Check-out"
            type="date"
            value={checkOut}
            onChange={(event) => setCheckOut(event.target.value)}
            size="small"
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
        {conflict ? (
          <Alert severity="warning">{'Those dates are unavailable.'}</Alert>
        ) : quote?.problem ? (
          <Alert severity="info">{quote.problem}</Alert>
        ) : quote ? (
          <>
            <Divider />
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="body2">
                {`${quote.nights} night${quote.nights === 1 ? '' : 's'}`}
              </Typography>
              <Typography variant="body2">
                {usd(quote.subtotalCents)}
              </Typography>
            </Box>
            {quote.depositCents < quote.totalCents ? (
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {'Due today (deposit)'}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {usd(quote.depositCents)}
                </Typography>
              </Box>
            ) : null}
          </>
        ) : null}
        <TextField
          label="Your name"
          value={guestName}
          onChange={(event) => setGuestName(event.target.value)}
          size="small"
        />
        <TextField
          label="Email"
          type="email"
          value={guestEmail}
          onChange={(event) => setGuestEmail(event.target.value)}
          size="small"
        />
        {status === 'error' ? (
          <Alert severity="error">
            {message || 'Reservation is unavailable right now.'}
          </Alert>
        ) : null}
        <Button
          variant="contained"
          color="primary"
          disabled={
            status === 'sending' ||
            conflict ||
            !quote ||
            Boolean(quote.problem) ||
            !guestEmail.trim()
          }
          onClick={handleReserve}
        >
          {status === 'sending'
            ? 'Redirecting…'
            : reserveLabel || 'Reserve now'}
        </Button>
      </Box>
    )
  },
)
ReservationWidget.displayName = 'AglynReservationWidget'

export const schema: Aglyn.ComponentSchema<ReservationWidgetProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Reservation widget',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiCalendarCheckOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'resourceId',
      label: 'Resource id',
      description: 'From the Resources card on the Products page.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'reserveLabel',
      label: 'Button label',
      description: 'Defaults to "Reserve now".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Reservation widget',
    pluginId: BUNDLE_ID,
    description: 'Date-range stay booking with live quote + deposit',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiCalendarCheckOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default ReservationWidget
