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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, FormControlLabel, Stack, Switch, TextField } from '@mui/material'
import { useEffect, useState, type ReactNode } from 'react'
import { POST_PURCHASE_API_ROUTES } from '../constants/api-routes'
import { POST_PURCHASE_VENDOR_LABELS, type PostPurchaseVendor } from '../constants/bundle-common'
import type { PostPurchaseSettingsView, PostPurchaseSettingsWrite } from '../model/post-purchase-settings'
import { usePostPurchaseAvailability, usePostPurchaseFetch } from './post-purchase-api'

/** What `commerceSettings` hands a widget: the site, and its workspace when known. */
export interface PostPurchaseSettingsWidgetProps {
  hostId: string
  orgId?: string
}

interface SettingsAnswer {
  settings: PostPurchaseSettingsView
  vendors: PostPurchaseVendor[]
}

const SUBHEADERS: Record<PostPurchaseVendor, string> = {
  aftership: 'Follow every parcel you ship through your AfterShip account, and send buyers to your AfterShip tracking page.',
  route: 'Offer Route package protection at checkout. Buyers pay Route’s price, with nothing added.',
  narvar: 'Send each order and its parcels to your Narvar account, and send buyers to your Narvar tracking page.',
}

const HELP: Record<PostPurchaseVendor, string> = {
  aftership:
    'Paste an API key and the webhook secret from your AfterShip account, then add the webhook address below in AfterShip so tracking updates reach your orders.',
  route:
    'Paste the secret token from your Route account. The protection box shows in the cart for orders that ship, at the price Route quotes.',
  narvar:
    'Paste the account id and auth token from your Narvar account, and your retailer name from your Narvar tracking page address.',
}

/**
 * TRACKING AND PROTECTION, on the store's Settings (AGL-3635): one card per
 * service the deployment offers — AfterShip, Route, Narvar — each connected
 * with the merchant's own account. Credentials go in and never come back
 * out; a card shows only whether one is stored. Save and Disconnect sit in
 * each card's header. Draws nothing where the deployment offers none.
 */
export function PostPurchaseSettingsCards(props: PostPurchaseSettingsWidgetProps) {
  const { hostId } = props
  const availability = usePostPurchaseAvailability(hostId)
  const request = usePostPurchaseFetch()
  const [answer, setAnswer] = useState<SettingsAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!availability.available) return
    let live = true
    request<SettingsAnswer>(POST_PURCHASE_API_ROUTES.settings, { query: { hostId } })
      .then((next) => live && setAnswer(next))
      .catch((cause: Error) => live && setError(cause.message))
    return () => {
      live = false
    }
  }, [availability.available, hostId, request])

  if (!availability.available) return null
  if (error) return <Alert severity="error">{error}</Alert>
  if (!answer) return null
  return (
    <Stack spacing={2}>
      {answer.vendors.map((vendor) => (
        <VendorCard key={vendor} vendor={vendor} hostId={hostId} settings={answer.settings} onSaved={setAnswer} />
      ))}
    </Stack>
  )
}

export default PostPurchaseSettingsCards

function VendorCard(props: {
  vendor: PostPurchaseVendor
  hostId: string
  settings: PostPurchaseSettingsView
  onSaved: (answer: SettingsAnswer) => void
}) {
  const { vendor, hostId, settings, onSaved } = props
  const request = usePostPurchaseFetch()
  const { enqueueSnackbar } = useSnackbar()
  const current = settings[vendor]
  const [draft, setDraft] = useState<Omit<PostPurchaseSettingsWrite, 'vendor'>>({})
  const [saving, setSaving] = useState(false)
  const label = POST_PURCHASE_VENDOR_LABELS[vendor]
  const enabled = draft.enabled ?? current.enabled

  const send = async (change: Omit<PostPurchaseSettingsWrite, 'vendor'>, done: string) => {
    setSaving(true)
    try {
      onSaved(await request<SettingsAnswer>(POST_PURCHASE_API_ROUTES.settings, { body: { hostId, change: { vendor, ...change } } }))
      setDraft({})
      enqueueSnackbar(done, { variant: 'success' })
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const field = (key: keyof PostPurchaseSettingsWrite, fieldLabel: string, options: { secret?: boolean; helper?: ReactNode; value?: string } = {}) => (
    <TextField
      label={fieldLabel}
      type={options.secret ? 'password' : 'text'}
      autoComplete="off"
      value={String((draft[key as keyof typeof draft] as string | undefined) ?? options.value ?? '')}
      onChange={(event) => setDraft((prior) => ({ ...prior, [key]: event.target.value }))}
      placeholder={options.secret && current.connected ? 'Stored — paste a new one to replace it' : undefined}
      helperText={options.helper}
      fullWidth
    />
  )

  const webhookAddress =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/api/${POST_PURCHASE_API_ROUTES.webhookAftership}?hostId=${encodeURIComponent(hostId)}`

  return (
    <CardDisplay
      header={label}
      subheader={SUBHEADERS[vendor]}
      help={{ title: label, excerpt: HELP[vendor] }}
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <StatusChip
              label={current.enabled ? 'On' : current.connected ? 'Connected' : 'Not connected'}
              tone={current.enabled ? 'success' : current.connected ? 'info' : 'neutral'}
              data-testid={`post-purchase-${vendor}-status`}
            />
            {current.connected ? (
              <Button color="inherit" disabled={saving} onClick={() => send({ disconnect: true }, `${label} disconnected`)}>
                {'Disconnect'}
              </Button>
            ) : null}
            <Button
              variant="contained"
              disabled={saving || Object.keys(draft).length === 0}
              onClick={() => send(draft, `${label} saved`)}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {vendor === 'aftership' ? (
          <>
            {field('apiKey', 'API key', { secret: true })}
            {field('webhookSecret', 'Webhook secret', { secret: true })}
            {field('trackingPageUrl', 'Tracking page', {
              value: settings.aftership.trackingPageUrl ?? '',
              helper: 'Your AfterShip tracking page, such as https://yourstore.aftership.com. Optional.',
            })}
            <TextField
              label="Webhook address"
              value={webhookAddress}
              helperText="Add this in AfterShip under Notifications → Webhooks."
              slotProps={{ htmlInput: { readOnly: true } }}
              fullWidth
            />
          </>
        ) : null}
        {vendor === 'route' ? (
          <>
            {field('apiKey', 'Secret token', { secret: true })}
            <FormControlLabel
              control={
                <Switch
                  checked={draft.defaultSelected ?? settings.route.defaultSelected}
                  onChange={(event) => setDraft((prior) => ({ ...prior, defaultSelected: event.target.checked }))}
                />
              }
              label="Tick the protection box in the cart by default"
            />
          </>
        ) : null}
        {vendor === 'narvar' ? (
          <>
            {field('accountId', 'Account id', { secret: false })}
            {field('authToken', 'Auth token', { secret: true })}
            {field('retailerMoniker', 'Retailer name', {
              value: settings.narvar.retailerMoniker ?? '',
              helper: 'The word before .narvar.com in your tracking page address.',
            })}
          </>
        ) : null}
        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={(event) => setDraft((prior) => ({ ...prior, enabled: event.target.checked }))}
            />
          }
          label={
            vendor === 'aftership'
              ? 'Follow every parcel through AfterShip'
              : vendor === 'route'
                ? 'Offer package protection at checkout'
                : 'Send orders to Narvar'
          }
        />
      </Stack>
    </CardDisplay>
  )
}
