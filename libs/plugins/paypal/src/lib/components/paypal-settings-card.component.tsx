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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PAYPAL_API_ROUTES } from '../constants'
import { navigateTo } from './navigate'

/**
 * PayPal and Venmo on the store's Settings (AGL-3630), in commerce's
 * `commerceSettings` zone. Draws NOTHING unless the deployment offers
 * PayPal to this workspace — the seller route answers 404 until every
 * `PAYPAL_*` variable is set — so an unconfigured deployment shows no
 * trace of it. Only the workspace owner connects or disconnects: payments
 * land in their PayPal account, as card payouts land in their Stripe one.
 */

export interface PayPalSettingsCardProps {
  hostId: string
  orgId?: string
}

type SellerStatus = 'not-connected' | 'onboarding' | 'ready' | 'action-needed' | 'disconnected' | 'revoked'

interface SellerAnswer {
  offered?: boolean
  seller: { status: SellerStatus; merchantId: string | null; actions: string[]; livemode: boolean }
  canManage: boolean
}

type Route = (typeof PAYPAL_API_ROUTES)[keyof typeof PAYPAL_API_ROUTES]

function usePayPalFetch() {
  const { data: user } = useUser()
  return useCallback(
    async <T,>(route: Route, orgId: string, body?: unknown): Promise<T> => {
      const response = await authorizedFetch(user, `/api/${route}?orgId=${encodeURIComponent(orgId)}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
      const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
      if (!response.ok) throw Object.assign(new Error(payload?.error ?? 'Something went wrong. Try again.'), { status: response.status })
      return payload
    },
    [user],
  )
}

/** The page the owner came from, less the marker PayPal's return adds. */
function currentPageUrl(): string {
  const url = new URL(window.location.href)
  url.searchParams.delete('paypal')
  return url.toString()
}

export function PayPalSettingsCard({ orgId }: PayPalSettingsCardProps) {
  const request = usePayPalFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [answer, setAnswer] = useState<SellerAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const returned = useRef(false)

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      setAnswer(await request<SellerAnswer>(PAYPAL_API_ROUTES.seller, orgId))
    } catch {
      setAnswer(null)
    }
  }, [orgId, request])

  useEffect(() => {
    void load()
  }, [load])

  // Back from PayPal's onboarding: read the account once, and drop the marker.
  useEffect(() => {
    if (!orgId || returned.current || typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('paypal') !== 'returned') return
    returned.current = true
    window.history.replaceState(null, '', currentPageUrl())
    void request<SellerAnswer>(PAYPAL_API_ROUTES.sellerRefresh, orgId, {})
      .then((next) => setAnswer((previous) => ({ ...previous, ...next })))
      .catch((cause) => setError((cause as Error).message))
  }, [orgId, request])

  if (!orgId || !answer?.offered) return null
  const { seller, canManage } = answer

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      const started = await request<{ actionUrl?: string; ready?: boolean }>(PAYPAL_API_ROUTES.sellerOnboard, orgId, {
        returnUrl: currentPageUrl(),
      })
      if (started.actionUrl) {
        navigateTo(started.actionUrl)
        return
      }
      await load()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const refresh = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await request<SellerAnswer>(PAYPAL_API_ROUTES.sellerRefresh, orgId, {})
      setAnswer((previous) => ({ ...previous, ...next }))
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      const next = await request<SellerAnswer>(PAYPAL_API_ROUTES.sellerDisconnect, orgId, {})
      setAnswer((previous) => ({ ...previous, ...next }))
      setConfirming(false)
      enqueueSnackbar('PayPal disconnected', { variant: 'success' })
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const connected = seller.status === 'ready'
  const started = seller.status === 'onboarding' || seller.status === 'action-needed'
  const action = canManage ? (
    connected ? (
      <Button color="error" onClick={() => setConfirming(true)} disabled={busy}>
        {'Disconnect'}
      </Button>
    ) : (
      <Button variant="contained" onClick={() => void connect()} disabled={busy}>
        {started ? 'Continue in PayPal' : 'Connect PayPal'}
      </Button>
    )
  ) : undefined

  return (
    <CardDisplay
      header="PayPal and Venmo"
      subheader="Let shoppers pay with PayPal, or Venmo in the US, beside cards. Payments go to your own PayPal business account."
      // The store's ways to pay. PayPal has no page of its own until it is
      // offered on the platform; that page's anchor replaces this one then.
      help={pluginDocsHelp('commerce', { anchor: '#payment-methods' })}
      HeaderProps={action ? { action } : undefined}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Chip
            size="small"
            color={connected ? 'success' : started || seller.status === 'revoked' ? 'warning' : 'default'}
            label={
              connected
                ? 'Accepting PayPal'
                : started
                  ? 'Setup not finished'
                  : seller.status === 'revoked'
                    ? 'Permission withdrawn'
                    : 'Not connected'
            }
          />
          {!seller.livemode ? <Chip size="small" color="warning" label="Sandbox" /> : null}
          {seller.merchantId ? (
            <Typography variant="body2" color="text.secondary">
              {`PayPal merchant ID ${seller.merchantId}`}
            </Typography>
          ) : null}
        </Stack>
        {seller.actions.length ? (
          <Alert
            severity="warning"
            action={
              <Button color="inherit" size="small" onClick={() => void refresh()} disabled={busy}>
                {'Check again'}
              </Button>
            }
          >
            <Stack spacing={0.5}>
              {seller.actions.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </Stack>
          </Alert>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {connected
            ? `Shoppers see PayPal and Venmo next to Checkout. PayPal charges you its own processing fee; ${PLATFORM_BRAND_NAME}’s transaction fee applies as it does to card sales, and refunds made here return it in proportion.`
            : canManage
              ? `You sign in to PayPal (or open a business account there) and give ${PLATFORM_BRAND_NAME} permission to take payments and refunds for you. ${PLATFORM_BRAND_NAME} never sees your PayPal password.`
              : 'The workspace owner can connect PayPal.'}
        </Typography>
      </Stack>
      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>{'Disconnect PayPal?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {'Shoppers stop seeing PayPal and Venmo at checkout. Orders already paid keep their payments, and you can still refund them here or in PayPal.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>{'Cancel'}</Button>
          <Button color="error" onClick={() => void disconnect()} disabled={busy}>
            {'Disconnect'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

export default PayPalSettingsCard
