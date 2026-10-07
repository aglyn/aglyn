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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Divider,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  STOREFRONT_PAYMENT_METHODS,
  type StorefrontPaymentMethodId,
  type StorefrontPaymentMethodSettings,
  type StorefrontPaymentMethodSpec,
} from '../../model/commerce-payment-methods'

export interface PaymentMethodsCardProps {
  hostId: string
}

/** One method as the route reports it (`server/payment-methods.ts`). */
export interface PaymentMethodRowView {
  id: StorefrontPaymentMethodId
  on: boolean
  platform: 'on' | 'unavailable' | null
  capability: 'active' | 'pending' | 'inactive' | 'unrequested' | null
}

export interface PaymentMethodDomainView {
  domain: string
  enabled: boolean
  stripeId: string | null
  status: { applePay: string | null; googlePay: string | null }
  lastError: string | null
}

export interface PaymentMethodsView {
  methods: PaymentMethodRowView[]
  domains: PaymentMethodDomainView[]
  accountConnected: boolean
  /** Absent from an older answer: read as allowed, and the route still judges. */
  canEdit?: boolean
  canFinish?: boolean
  warnings: string[]
}

/**
 * What a method's Stripe state means to the merchant, or null for nothing to
 * say. Only an ON method gets a verdict: an off one is the merchant's choice.
 */
export function capabilityVerdict(
  row: PaymentMethodRowView,
  accountConnected: boolean,
): { label: string; color: 'success' | 'warning' | 'default' } | null {
  if (!row.on) return null
  if (!accountConnected) return { label: 'Connect Stripe first', color: 'default' }
  switch (row.capability) {
    case 'active':
      return { label: 'Ready', color: 'success' }
    case 'pending':
      return { label: 'Stripe is reviewing', color: 'warning' }
    case 'inactive':
      return { label: 'Stripe needs more details', color: 'warning' }
    case 'unrequested':
      return { label: 'Save to request', color: 'default' }
    default:
      return null
  }
}

/** The domain chip: what Apple Pay can do on this name right now. */
export function domainVerdict(domain: PaymentMethodDomainView): {
  label: string
  color: 'success' | 'warning' | 'default'
} {
  if (domain.enabled && domain.status.applePay === 'active') {
    return { label: 'Apple Pay ready', color: 'success' }
  }
  if (domain.enabled) return { label: 'Registered', color: 'default' }
  if (domain.lastError) return { label: 'Retrying', color: 'warning' }
  return { label: 'Registers on first checkout', color: 'default' }
}

/**
 * The methods a merchant can see: everything the platform offers, and every
 * method we could not ask Stripe about except crypto, which is shown only once
 * the platform positively offers it (AGL-3629: hidden where unavailable).
 */
export function visibleMethods(
  rows: readonly PaymentMethodRowView[],
): Array<{ row: PaymentMethodRowView; spec: StorefrontPaymentMethodSpec }> {
  return rows
    .map((row) => ({
      row,
      spec: STOREFRONT_PAYMENT_METHODS.find((method) => method.id === row.id),
    }))
    .filter(
      (entry): entry is { row: PaymentMethodRowView; spec: StorefrontPaymentMethodSpec } =>
        Boolean(entry.spec) &&
        entry.row.platform !== 'unavailable' &&
        !(entry.row.platform === null && entry.spec?.kind === 'crypto'),
    )
}

/**
 * Payment methods (AGL-3629): which wallets, buy-now-pay-later and crypto
 * options the storefront offers, what each needs, and whether Stripe is ready
 * for it. Cards are always on and are not listed.
 *
 * Read and saved through `/api/commerce/payment-methods` rather than a
 * Firestore listen, because two of the three facts per row — what the
 * platform offers and the payout account's capability — live at Stripe, and a
 * save is a Stripe request as well as a settings write.
 */
export function PaymentMethodsCard(props: PaymentMethodsCardProps) {
  const { hostId } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [view, setView] = useState<PaymentMethodsView | null>(null)
  const [state, setState] = useState<'loading' | 'loaded' | 'error' | 'unconfigured'>(
    'loading',
  )
  const [draft, setDraft] = useState<StorefrontPaymentMethodSettings>({})
  const [saving, setSaving] = useState(false)
  const [nonce, setNonce] = useState(0)
  // The load keys on the uid, not the user object: a refreshed token hands
  // back a new object, and reloading on it would throw away unsaved toggles.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid

  useEffect(() => {
    const user = userRef.current
    if (!uid || !user || !hostId) return
    let cancelled = false
    setState('loading')
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          `/api/commerce/payment-methods?hostId=${encodeURIComponent(hostId)}`,
        )
        if (cancelled) return
        if (response.status === 501) return void setState('unconfigured')
        if (!response.ok) return void setState('error')
        const payload = (await response.json()) as PaymentMethodsView
        if (cancelled) return
        setView(payload)
        setDraft({})
        setState('loaded')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uid, hostId, nonce])

  const dirty = Object.keys(draft).length > 0

  const handleSave = useCallback(async () => {
    if (!dirty) return
    setSaving(true)
    try {
      const response = await authorizedFetch(user, '/api/commerce/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, methods: draft }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Payment methods were not saved', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      setView(payload as PaymentMethodsView)
      setDraft({})
      enqueueSnackbar('Payment methods saved', { variant: 'success', persist: false })
    } catch {
      enqueueSnackbar('Payment methods were not saved', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSaving(false)
    }
  }, [dirty, draft, enqueueSnackbar, hostId, user])

  const handleFinish = useCallback(async () => {
    setSaving(true)
    try {
      const response = await authorizedFetch(user, '/api/commerce/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, action: 'finish' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && typeof payload?.url === 'string') {
        return void window.location.assign(payload.url)
      }
      enqueueSnackbar(payload?.error ?? 'Stripe could not be opened', {
        variant: 'error',
        allowDuplicate: true,
      })
    } catch {
      enqueueSnackbar('Stripe could not be opened', { variant: 'error', allowDuplicate: true })
    } finally {
      setSaving(false)
    }
  }, [enqueueSnackbar, hostId, user])

  const rows = view ? visibleMethods(view.methods) : []
  const canEdit = view?.canEdit !== false
  const canFinish = view?.canFinish !== false

  return (
    <CardDisplay
      header={'Payment methods'}
      help={pluginDocsHelp('commerce', { anchor: '#payment-methods' })}
      HeaderProps={{
        action:
          state === 'loaded' && canEdit ? (
            <Button
              size="small"
              variant="contained"
              disabled={!dirty || saving}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          ) : null,
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5} data-testid="payment-methods-card">
        {state === 'loading' ? (
          <Typography variant="body2" color="text.secondary">
            {'Checking your payment methods…'}
          </Typography>
        ) : null}
        {state === 'unconfigured' ? (
          <Alert severity="info">{'Payments are not configured on this deployment.'}</Alert>
        ) : null}
        {state === 'error' ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => setNonce((n) => n + 1)}>
                {'Retry'}
              </Button>
            }
          >
            {'We couldn’t load your payment methods. Nothing has changed — ' +
              'shoppers still see what they saw before.'}
          </Alert>
        ) : null}
        {state === 'loaded' && view ? (
          <>
            <Typography variant="body2" color="text.secondary">
              {'Cards are always on. Turn off anything you don’t want to offer. ' +
                'Stripe shows each method only on orders and to shoppers it suits, ' +
                'using the limits below.'}
            </Typography>
            {canEdit ? null : (
              <Alert severity="info">
                {'Only a site admin can change which payment methods your store offers.'}
              </Alert>
            )}
            {view.warnings.map((warning) => (
              <Alert key={warning} severity="warning">
                {warning}
              </Alert>
            ))}
            {rows.map(({ row, spec }) => {
              const on = draft[row.id] ?? row.on
              const verdict = capabilityVerdict({ ...row, on }, view.accountConnected)
              return (
                <Stack key={row.id} spacing={0.5} data-testid={`payment-method-${row.id}`}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Switch
                      checked={on}
                      disabled={!canEdit || saving}
                      onChange={(event) => {
                        const next = event.target.checked
                        setDraft((current) => {
                          const copy = { ...current }
                          if (next === row.on) delete copy[row.id]
                          else copy[row.id] = next
                          return copy
                        })
                      }}
                      slotProps={{ input: { 'aria-label': spec.label } }}
                    />
                    <Typography variant="subtitle2" sx={{ flex: 1 }}>
                      {spec.label}
                    </Typography>
                    {spec.capability && verdict ? (
                      <Chip size="small" variant="outlined" label={verdict.label} color={verdict.color} />
                    ) : null}
                    {on && row.capability === 'inactive' && canFinish ? (
                      <Button size="small" disabled={saving} onClick={handleFinish}>
                        {'Finish in Stripe'}
                      </Button>
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {spec.requirements}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {spec.limits}
                  </Typography>
                </Stack>
              )
            })}
            <Divider />
            <Typography variant="subtitle2">{'Wallet domains'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {'Apple Pay shows only on a domain registered with Stripe. Your ' +
                'site’s domains are registered for you when you connect them and ' +
                'on the first in-page checkout.'}
            </Typography>
            {view.domains.map((domain) => {
              const verdict = domainVerdict(domain)
              return (
                <Stack
                  key={domain.domain}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                  data-testid={`payment-domain-${domain.domain}`}
                >
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {domain.domain}
                  </Typography>
                  <Chip size="small" variant="outlined" label={verdict.label} color={verdict.color} />
                </Stack>
              )
            })}
          </>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
PaymentMethodsCard.displayName = 'PaymentMethodsCard'

export default PaymentMethodsCard
