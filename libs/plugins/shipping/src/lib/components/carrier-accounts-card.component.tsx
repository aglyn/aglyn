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

import type { PluginShippingAddress } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { SHIPPING_API_ROUTES } from '../constants/api-routes'
import type { ConnectableCarrier, ProviderCarrierAccount } from '../providers/types'
import { AddressFields } from './address-fields.component'
import { useShippingAvailability, useShippingFetch } from './shipping-api'
import type { ShippingSettingsWidgetProps } from './shipping-settings-card.component'

const CARRIERS: Array<{ id: ConnectableCarrier; label: string }> = [
  { id: 'ups', label: 'UPS' },
  { id: 'fedex', label: 'FedEx' },
]

/**
 * CARRIER ACCOUNTS (AGL-3612): the carriers labels and rates come from. By
 * default the provider's own discounted accounts; a merchant with a
 * negotiated UPS or FedEx account connects it here, and labels on it are
 * billed to them by the carrier. UPS asks the merchant to sign in at UPS,
 * which this card sends them to. Workspace-wide: every site of the
 * workspace ships with the same accounts.
 */
export function CarrierAccountsCard(props: ShippingSettingsWidgetProps) {
  const { hostId } = props
  const availability = useShippingAvailability(hostId)
  const request = useShippingFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [accounts, setAccounts] = useState<ProviderCarrierAccount[] | null>(null)
  const [canConnect, setCanConnect] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<{
    carrier: ConnectableCarrier
    accountNumber: string
    name: string
    company: string
    email: string
    phone: string
    address: PluginShippingAddress
  }>({ carrier: 'ups', accountNumber: '', name: '', company: '', email: '', phone: '', address: { country: 'US' } })

  const load = useCallback(async () => {
    try {
      const answer = await request<{ accounts: ProviderCarrierAccount[]; canConnect: boolean }>(
        SHIPPING_API_ROUTES.carrierAccounts,
        { query: { hostId } },
      )
      setAccounts(answer.accounts)
      setCanConnect(answer.canConnect)
      setError(null)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [hostId, request])

  useEffect(() => {
    if (availability.available) void load()
  }, [availability.available, load])

  const handleActive = async (account: ProviderCarrierAccount, active: boolean) => {
    try {
      await request(SHIPPING_API_ROUTES.carrierAccountsActive, {
        body: { hostId, carrierAccountId: account.id, active },
      })
      await load()
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    }
  }

  const handleConnect = async () => {
    setBusy(true)
    try {
      const answer = await request<{ authorizeUrl?: string }>(SHIPPING_API_ROUTES.carrierAccountsConnect, {
        body: {
          hostId,
          carrier: form.carrier,
          accountNumber: form.accountNumber,
          contact: { name: form.name, company: form.company, email: form.email, phone: form.phone },
          address: form.address,
          returnTo: typeof window === 'undefined' ? '' : window.location.href,
        },
      })
      setConnecting(false)
      if (answer.authorizeUrl) {
        window.location.assign(answer.authorizeUrl)
        return
      }
      enqueueSnackbar('Carrier account connected', { variant: 'success' })
      await load()
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (!availability.available) return null

  return (
    <CardDisplay
      header="Carrier accounts"
      subheader="Every site in this workspace ships with these accounts."
      help={pluginDocsHelp('shipping', {
        anchor: '#carrier-accounts',
        title: 'Carrier accounts',
        excerpt:
          'The carrier accounts your labels and checkout rates come from. Connect your own UPS or FedEx account to ship on its rates; labels on it are billed to you by the carrier.',
      })}
      HeaderProps={
        canConnect
          ? { action: <Button onClick={() => setConnecting(true)}>{'Connect your own account'}</Button> }
          : undefined
      }
      contentGutterX
      contentGutterY
    >
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Stack spacing={1}>
        {(accounts ?? []).map((account) => (
          <Stack key={account.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Switch
              checked={account.active}
              onChange={(event) => handleActive(account, event.target.checked)}
              slotProps={{ input: { 'aria-label': `Use ${account.carrierName}` } }}
            />
            <Typography sx={{ flex: 1 }}>
              {account.carrierName}
              {account.accountNumber ? ` · ${account.accountNumber}` : ''}
            </Typography>
            <Chip size="small" label={account.platformOwned ? 'Discounted rates' : 'Your account'} />
            {account.authorization !== 'connected' ? (
              <Chip
                size="small"
                color="warning"
                label={account.authorization === 'pending' ? 'Sign-in needed' : 'Reconnect needed'}
              />
            ) : null}
          </Stack>
        ))}
        {accounts && !accounts.length ? (
          <Typography variant="body2" color="text.secondary">
            {'No carrier accounts yet.'}
          </Typography>
        ) : null}
      </Stack>
      <Dialog open={connecting} onClose={() => setConnecting(false)} fullWidth maxWidth="sm">
        <DialogTitle>{'Connect your carrier account'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <TextField
              select
              label="Carrier"
              value={form.carrier}
              onChange={(event) => setForm({ ...form, carrier: event.target.value as ConnectableCarrier })}
            >
              {CARRIERS.map((carrier) => (
                <MenuItem key={carrier.id} value={carrier.id}>
                  {carrier.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Account number"
              value={form.accountNumber}
              onChange={(event) => setForm({ ...form, accountNumber: event.target.value })}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField label="Account holder" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} sx={{ flex: 1 }} />
              <TextField label="Company" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} sx={{ flex: 1 }} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField label="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} sx={{ flex: 1 }} />
              <TextField label="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} sx={{ flex: 1 }} />
            </Stack>
            <Typography variant="subtitle2">{'Billing address on the account'}</Typography>
            <AddressFields value={form.address} onChange={(address) => setForm({ ...form, address })} withName={false} />
            {form.carrier === 'ups' ? (
              <Alert severity="info">{'UPS asks you to sign in at ups.com to finish connecting.'}</Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConnecting(false)}>{'Cancel'}</Button>
          <Button variant="contained" disabled={busy || !form.accountNumber} onClick={handleConnect}>
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
CarrierAccountsCard.displayName = 'CarrierAccountsCard'

export default CarrierAccountsCard
