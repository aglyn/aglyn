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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { CopyField } from '@aglyn/shared-ui-jsx/components/copy-field.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { SHIPPING_API_ROUTES } from '../constants/api-routes'
import type { OwnAccountKind, OwnAccountService, OwnAccountView } from '../model/own-accounts'
import { useShippingAvailability, useShippingFetch } from './shipping-api'
import type { ShippingSettingsWidgetProps } from './shipping-settings-card.component'

interface OwnAccountsAnswer {
  services: OwnAccountService[]
  connections: OwnAccountView[]
}

/**
 * YOUR SHIPPING ACCOUNTS (AGL-3632), on the store's Settings: connect the
 * workspace's own Easyship or Sendcloud account to buy labels and get rates
 * there instead of on the platform's accounts, and ShipperHQ to price
 * checkout with the merchant's own rules. Draws nothing unless the
 * deployment offers at least one of them. Workspace-wide, like the carrier
 * accounts: every site of the workspace ships through the same ones.
 *
 * Credentials go in once and never come back: the server checks them with
 * the service, keeps them sealed and answers only the account's name.
 */
export function OwnAccountsCard(props: ShippingSettingsWidgetProps) {
  const { hostId } = props
  const availability = useShippingAvailability(hostId)
  const request = useShippingFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [answer, setAnswer] = useState<OwnAccountsAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<OwnAccountKind | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [disconnecting, setDisconnecting] = useState<OwnAccountView | null>(null)

  const load = useCallback(async () => {
    try {
      setAnswer(await request<OwnAccountsAnswer>(SHIPPING_API_ROUTES.ownAccounts, { query: { hostId } }))
      setError(null)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [hostId, request])

  useEffect(() => {
    if (availability.ownAccounts) void load()
  }, [availability.ownAccounts, load])

  if (!availability.ownAccounts) return null

  const connectedKinds = new Set((answer?.connections ?? []).map((one) => one.kind))
  const labelPlatformConnected = (answer?.connections ?? []).find((one) => one.role === 'labels')
  const connectable = (answer?.services ?? []).filter(
    (service) => !connectedKinds.has(service.kind) && !(service.role === 'labels' && labelPlatformConnected),
  )
  const service = (answer?.services ?? []).find((one) => one.kind === connecting) ?? null

  const openConnect = () => {
    const first = connectable[0]
    if (!first) return
    setConnecting(first.kind)
    setValues(defaultsFor(first))
    setFormError(null)
  }

  const handleConnect = async () => {
    if (!service) return
    setBusy(true)
    setFormError(null)
    try {
      await request(SHIPPING_API_ROUTES.ownAccountsConnect, { body: { hostId, kind: service.kind, values } })
      setConnecting(null)
      setValues({})
      enqueueSnackbar(`${service.label} connected`, { variant: 'success' })
      await load()
    } catch (cause) {
      setFormError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    if (!disconnecting) return
    setBusy(true)
    try {
      await request(SHIPPING_API_ROUTES.ownAccountsDisconnect, { body: { hostId, kind: disconnecting.kind } })
      enqueueSnackbar(`${disconnecting.label} disconnected`, { variant: 'success' })
      setDisconnecting(null)
      await load()
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const missingRequired = Boolean(service?.fields.some((field) => field.required && !values[field.key]?.trim()))

  return (
    <CardDisplay
      header="Your shipping accounts"
      subheader="Ship through an account of your own. Every site in this workspace uses it."
      help={pluginDocsHelp('shipping', {
        anchor: '#carrier-accounts',
        title: 'Your shipping accounts',
        excerpt:
          'Connect your own Easyship or Sendcloud account to buy labels and get rates there, billed to you by that service, or ShipperHQ to price checkout with your own rules.',
      })}
      HeaderProps={
        connectable.length
          ? { action: <Button onClick={openConnect}>{'Connect an account'}</Button> }
          : undefined
      }
      contentGutterX
      contentGutterY
    >
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Stack spacing={2} divider={<Divider flexItem />}>
        {(answer?.connections ?? []).map((connection) => (
          <Stack key={connection.kind} spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
              <Typography variant="subtitle1" sx={{ flex: 1, minWidth: 160 }}>
                {connection.label}
                <Typography component="span" variant="body2" color="text.secondary">
                  {` · ${connection.accountName}`}
                </Typography>
              </Typography>
              <Chip size="small" label={connection.role === 'labels' ? 'Labels and rates' : 'Checkout rates'} />
              {connection.testMode ? <Chip size="small" color="warning" label="Test" /> : null}
              {connection.webhookUrl && !connection.followsParcels ? (
                <Chip size="small" color="warning" label="Tracking not set up" />
              ) : null}
              <Button size="small" color="error" onClick={() => setDisconnecting(connection)}>
                {'Disconnect'}
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {connection.role === 'labels'
                ? `Labels and rates come from your ${connection.label} account, which bills you for each label.`
                : `Checkout shipping is priced by your ${connection.label} rules. Labels are still bought below.`}
            </Typography>
            {connection.webhookUrl ? (
              <CopyField
                label="Webhook address"
                value={connection.webhookUrl}
                helperText={
                  connection.kind === 'sendcloud'
                    ? 'In Sendcloud, open your API integration, turn on webhook feedback and paste this address.'
                    : 'In Easyship, add a webhook for tracking status changes with this address.'
                }
                onCopied={() => enqueueSnackbar('Webhook address copied', { variant: 'success' })}
              />
            ) : null}
          </Stack>
        ))}
        {answer && !answer.connections.length ? (
          <Typography variant="body2" color="text.secondary">
            {availability.platform
              ? 'No accounts connected. Labels and rates use the platform’s carrier accounts.'
              : 'No accounts connected. Connect one to buy labels and get carrier rates.'}
          </Typography>
        ) : null}
      </Stack>

      <Dialog open={Boolean(service)} onClose={() => setConnecting(null)} fullWidth maxWidth="sm">
        <DialogTitle>{'Connect your shipping account'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <TextField
              select
              label="Service"
              value={connecting ?? ''}
              onChange={(event) => {
                const next = connectable.find((one) => one.kind === event.target.value)
                if (!next) return
                setConnecting(next.kind)
                setValues(defaultsFor(next))
                setFormError(null)
              }}
            >
              {connectable.map((one) => (
                <MenuItem key={one.kind} value={one.kind}>
                  {one.label}
                </MenuItem>
              ))}
            </TextField>
            {service ? (
              <Fragment>
                <Typography variant="body2" color="text.secondary">
                  {service.summary}
                </Typography>
                {service.fields.map((field) => (
                  <TextField
                    key={field.key}
                    select={Boolean(field.options)}
                    type={field.secret ? 'password' : 'text'}
                    autoComplete="off"
                    label={field.label}
                    required={field.required}
                    value={values[field.key] ?? ''}
                    onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                    helperText={field.helper}
                  >
                    {(field.options ?? []).map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                ))}
                <Typography variant="caption" color="text.secondary">
                  {'Stored encrypted. Keys are never shown again.'}
                </Typography>
              </Fragment>
            ) : null}
            {formError ? <Alert severity="error">{formError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConnecting(null)}>{'Cancel'}</Button>
          <Button variant="contained" disabled={busy || missingRequired} onClick={handleConnect}>
            {busy ? 'Checking…' : 'Check and connect'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(disconnecting)} onClose={() => setDisconnecting(null)} fullWidth maxWidth="xs">
        <DialogTitle>{disconnecting ? `Disconnect ${disconnecting.label}?` : ''}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {disconnecting?.role === 'labels'
              ? `Labels already bought stay on their orders, but they can only be voided in your account at the service. ${
                  availability.platform
                    ? 'New labels and rates use the platform’s carrier accounts.'
                    : 'No new labels can be bought until another account is connected.'
                }`
              : 'Checkout goes back to the carriers’ own rates.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnecting(null)}>{'Cancel'}</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={handleDisconnect}>
            {'Disconnect'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
OwnAccountsCard.displayName = 'OwnAccountsCard'

/** A form's first values: each pick's first option. */
function defaultsFor(service: OwnAccountService): Record<string, string> {
  return Object.fromEntries(
    service.fields.filter((field) => field.options?.length).map((field) => [field.key, field.options![0].value]),
  )
}

export default OwnAccountsCard
