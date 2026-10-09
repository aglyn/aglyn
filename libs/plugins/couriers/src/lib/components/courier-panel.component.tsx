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

import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { StatusChip, type StatusTone } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Link, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import {
  courierStateIsFinal,
  formatCourierFee,
  type CourierConnectionView,
  type CourierOrderView,
  type CourierState,
} from '../model/couriers'
import { newAttemptKey, type CouriersApi } from './couriers-api'

/**
 * One order's courier (AGL-3695): get a quote, send the courier, follow it,
 * call it off. Shared by the order dialog's section and the Pickup & delivery
 * queue's "Send a courier" dialog, so both say the same thing.
 */
export interface CourierPanelProps {
  orderId: string
  api: CouriersApi
  connection: CourierConnectionView
  /** Whether the order was paid in test mode: the courier's sandbox, and nobody comes. */
  testMode: boolean
  /** Called with each answer, so a host can refresh what it shows. */
  onChange?: (view: CourierOrderView) => void
  /** Test seam: the clock. */
  now?: () => number
}

const TONE: Readonly<Record<CourierState, StatusTone>> = {
  requested: 'info',
  assigned: 'info',
  at_pickup: 'info',
  picked_up: 'info',
  at_dropoff: 'info',
  delivered: 'success',
  cancelled: 'neutral',
  returning: 'warning',
  returned: 'warning',
}

/** A run unread this long is asked about when the panel opens. */
const STALE_MS = 2 * 60 * 1000

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function CourierPanel(props: CourierPanelProps) {
  const { orderId, api, connection, testMode, onChange } = props
  const now = props.now ?? Date.now
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [view, setView] = useState<CourierOrderView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One booking attempt's key, kept until it lands: a retry after a lost
  // answer finds the courier the first try booked instead of booking twice.
  const [attemptKey, setAttemptKey] = useState(newAttemptKey)

  const accept = useCallback(
    (next: CourierOrderView) => {
      setView(next)
      onChange?.(next)
    },
    [onChange],
  )

  const run = useCallback(
    async (work: () => Promise<CourierOrderView>, done?: string): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        accept(await work())
        if (done) enqueueSnackbar(done, { variant: 'success', persist: false })
        return true
      } catch (cause) {
        setError((cause as Error).message)
        return false
      } finally {
        setBusy(false)
      }
    },
    [accept, enqueueSnackbar],
  )

  useEffect(() => {
    let live = true
    api
      .order(orderId)
      .then(async (answer) => {
        if (!live) return
        accept(answer)
        const open = answer.run && !courierStateIsFinal(answer.run.state)
        if (open && now() - (answer.run?.updatedAtMs ?? 0) > STALE_MS) {
          const fresh = await api.refresh(orderId).catch(() => null)
          if (live && fresh) accept(fresh)
        }
      })
      .catch((cause: Error) => {
        if (live) setError(cause.message)
      })
    return () => {
      live = false
    }
    // `now` is a test seam; the panel reads once per order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, orderId, accept])

  const provider = connection.provider
  const keysReady = testMode ? connection.test.configured : connection.live.configured
  const current = view?.run && !courierStateIsFinal(view.run.state) ? view.run : null
  const last = view?.run && courierStateIsFinal(view.run.state) ? view.run : null
  const quote = view?.quote && view.quote.expiresAtMs > now() ? view.quote : null

  const handleQuote = () => run(() => api.quote(orderId, provider))
  const handleSend = async () => {
    const sent = await run(() => api.dispatch(orderId, attemptKey), `${connection.providerLabel} courier requested`)
    if (sent) setAttemptKey(newAttemptKey())
  }
  const handleCancel = async () => {
    const confirmed = await confirm({
      title: 'Cancel the courier?',
      description: `${connection.providerLabel} is asked to call the courier off. The delivery goes back to your own queue; ${connection.providerLabel} may still charge your account if the courier was already on the way.`,
      confirmationText: 'Cancel courier',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (confirmed) await run(() => api.cancel(orderId), 'Courier canceled')
  }

  if (!view && !error) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'Loading…'}
      </Typography>
    )
  }

  return (
    <Stack spacing={1}>
      {testMode ? (
        <Alert severity="info">
          {`This order was paid in test mode, so it uses your ${connection.providerLabel} test keys: nobody is sent.`}
        </Alert>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      {current ? (
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusChip label={current.stateLabel} tone={TONE[current.state]} />
            {current.etaMs ? (
              <Typography variant="body2">{`Arriving about ${clock(current.etaMs)}`}</Typography>
            ) : null}
          </Stack>
          {current.pending ? (
            <Typography variant="body2" color="text.secondary">
              {`Waiting for ${current.providerLabel} to confirm the booking. Don’t book again.`}
            </Typography>
          ) : null}
          {current.cancelRequested ? (
            <Typography variant="body2" color="text.secondary">
              {'The order was canceled or refunded, so the courier is being called off.'}
            </Typography>
          ) : null}
          {current.feeCents !== null ? (
            <Typography variant="body2" color="text.secondary">
              {`${current.providerLabel} charges ${formatCourierFee(current.feeCents, current.currency)} to your ${current.providerLabel} account.`}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {current.trackingUrl ? (
              <Link href={current.trackingUrl} target="_blank" rel="noopener noreferrer" variant="body2">
                {'Track the courier'}
              </Link>
            ) : null}
            <Button size="small" disabled={busy} onClick={() => void run(() => api.refresh(orderId))}>
              {'Refresh'}
            </Button>
            <Button size="small" color="error" disabled={busy} onClick={() => void handleCancel()}>
              {'Cancel courier'}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Stack spacing={0.5}>
          {last ? (
            <Typography variant="body2" color="text.secondary">
              {`Last courier: ${last.stateLabel}${last.reason ? ` — ${last.reason}` : ''}`}
            </Typography>
          ) : null}
          {!keysReady ? (
            <Typography variant="body2" color="text.secondary">
              {testMode
                ? `Add your ${connection.providerLabel} test keys in the Couriers card to send a test courier.`
                : `Add your ${connection.providerLabel} live keys in the Couriers card to send a courier.`}
            </Typography>
          ) : quote ? (
            <>
              <Typography variant="body2">
                {[
                  `${quote.providerLabel}: ${formatCourierFee(quote.feeCents, quote.currency)}, charged to your ${quote.providerLabel} account`,
                  quote.dropoffEtaMs ? `arriving about ${clock(quote.dropoffEtaMs)}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {`Price good until ${clock(quote.expiresAtMs)}. The courier is sent now.`}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="contained" disabled={busy} onClick={() => void handleSend()}>
                  {'Send courier'}
                </Button>
                <Button size="small" disabled={busy} onClick={() => void handleQuote()}>
                  {'New quote'}
                </Button>
              </Stack>
            </>
          ) : (
            <Stack direction="row">
              <Button size="small" variant="outlined" disabled={busy} onClick={() => void handleQuote()}>
                {`Get a ${connection.providerLabel} quote`}
              </Button>
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  )
}

export default CourierPanel
