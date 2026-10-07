'use client'

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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import { TAX_ENGINES_API_ROUTES } from '../constants/api-routes'
import {
  TAX_ENGINE_PROVIDER_LABELS,
  type TaxEngineAddress,
  type TaxEngineConnectionView,
  type TaxEngineEnvironment,
  type TaxEngineProviderId,
} from '../model/tax-engines'
import { TaxExemptionsSection } from './tax-exemptions-section.component'
import { useTaxEngineConnection, useTaxEnginesFetch } from './tax-engines-api'

/**
 * What commerce's `commerceSettings` zone hands a widget, restated here
 * because a plugin never imports another (AGL-3631): the site. This widget
 * writes none of the store's settings.
 */
export interface TaxEngineCardProps {
  hostId: string
  orgId?: string
}

interface ConnectForm {
  provider: TaxEngineProviderId
  environment: TaxEngineEnvironment
  accountId: string
  companyCode: string
  secret: string
}

const EMPTY_FORM: ConnectForm = {
  provider: 'avalara',
  environment: 'sandbox',
  accountId: '',
  companyCode: '',
  secret: '',
}

/**
 * The connected tax service (AGL-3631): the merchant's own Avalara AvaTax or
 * TaxJar account, the address the store ships or sells from, a default tax
 * code, whether paid orders are recorded there, and the customers who are
 * exempt. Drawn inside the store's Taxes card, and nowhere when the
 * deployment or the site cannot hold a connection.
 */
export function TaxEngineCard(props: TaxEngineCardProps) {
  const { hostId } = props
  const state = useTaxEngineConnection(hostId)
  if (state.loading || !state.available) return null
  return state.connection ? (
    <ConnectedCard hostId={hostId} connection={state.connection} onChange={state.replace} />
  ) : (
    <ConnectCard hostId={hostId} onConnected={state.replace} />
  )
}

function ResponsibilityNote() {
  return (
    <Alert severity="info">
      {`${PLATFORM_BRAND_NAME} asks your tax service for the tax on each sale and records your ` +
        'paid orders and refunds there. You remain responsible for registering where you owe ' +
        'tax, filing your returns and paying the tax you collect — the tax service and your ' +
        'own advisor are where those decisions are made.'}
    </Alert>
  )
}

function ConnectCard(props: {
  hostId: string
  onConnected: (connection: TaxEngineConnectionView | null) => void
}) {
  const { hostId, onConnected } = props
  const request = useTaxEnginesFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [form, setForm] = useState<ConnectForm>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<ConnectForm>) => setForm((current) => ({ ...current, ...patch }))
  const avalara = form.provider === 'avalara'

  const handleConnect = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const answer = await request<{ connection: TaxEngineConnectionView; detail: string }>(
        TAX_ENGINES_API_ROUTES.connect,
        { body: { hostId, ...form } },
      )
      enqueueSnackbar(answer.detail, { variant: 'success', persist: false })
      onConnected(answer.connection)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [enqueueSnackbar, form, hostId, onConnected, request])

  return (
    <CardDisplay
      variant="outlined"
      header="Tax service"
      subheader="Calculate tax with your own Avalara AvaTax or TaxJar account."
      help={pluginDocsHelp('taxServices', { anchor: '#connect' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            select
            size="small"
            label="Service"
            value={form.provider}
            onChange={(event) => set({ provider: event.target.value as TaxEngineProviderId, secret: '' })}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="avalara">{TAX_ENGINE_PROVIDER_LABELS.avalara}</MenuItem>
            <MenuItem value="taxjar">{TAX_ENGINE_PROVIDER_LABELS.taxjar}</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Environment"
            value={form.environment}
            onChange={(event) => set({ environment: event.target.value as TaxEngineEnvironment })}
            helperText={form.environment === 'sandbox' ? 'Test account: nothing is filed' : 'Your live account'}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="sandbox">{'Sandbox'}</MenuItem>
            <MenuItem value="production">{'Production'}</MenuItem>
          </TextField>
        </Stack>
        {avalara ? (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              size="small"
              label="Account id"
              value={form.accountId}
              onChange={(event) => set({ accountId: event.target.value.replace(/\D/g, '') })}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="Company code"
              value={form.companyCode}
              onChange={(event) => set({ companyCode: event.target.value })}
              placeholder="DEFAULT"
              helperText="As set up in AvaTax"
              sx={{ flex: 1 }}
            />
          </Stack>
        ) : null}
        <TextField
          size="small"
          type="password"
          label={avalara ? 'License key' : 'API token'}
          value={form.secret}
          onChange={(event) => set({ secret: event.target.value })}
          autoComplete="off"
          helperText="Stored encrypted. It is never shown again."
        />
        {error ? <Alert severity="error">{error}</Alert> : null}
        <ResponsibilityNote />
        <Button
          variant="contained"
          size="small"
          disabled={busy || !form.secret.trim() || (avalara && !form.accountId)}
          onClick={handleConnect}
          sx={{ alignSelf: 'flex-start' }}
        >
          {busy ? 'Testing…' : 'Test and connect'}
        </Button>
      </Stack>
    </CardDisplay>
  )
}

function ConnectedCard(props: {
  hostId: string
  connection: TaxEngineConnectionView
  onChange: (connection: TaxEngineConnectionView | null) => void
}) {
  const { hostId, connection, onChange } = props
  const request = useTaxEnginesFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [shipFrom, setShipFrom] = useState<TaxEngineAddress>(connection.shipFrom ?? { country: 'US' })
  const [defaultTaxCode, setDefaultTaxCode] = useState(connection.defaultTaxCode ?? '')
  const [messages, setMessages] = useState<string[]>([])

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true)
      try {
        await work()
      } catch (cause) {
        enqueueSnackbar((cause as Error).message, { variant: 'error', persist: false })
      } finally {
        setBusy(false)
      }
    },
    [enqueueSnackbar],
  )

  const handleTest = () =>
    run(async () => {
      const answer = await request<{ ok: boolean; detail: string; connection: TaxEngineConnectionView }>(
        TAX_ENGINES_API_ROUTES.test,
        { body: { hostId } },
      )
      onChange(answer.connection)
      enqueueSnackbar(answer.detail, { variant: answer.ok ? 'success' : 'error', persist: false })
    })

  const handleDisconnect = () =>
    run(async () => {
      await request(TAX_ENGINES_API_ROUTES.disconnect, { body: { hostId } })
      onChange(null)
    })

  const saveSettings = (body: Record<string, unknown>, done: string) =>
    run(async () => {
      const answer = await request<{ connection: TaxEngineConnectionView; messages: string[] }>(
        TAX_ENGINES_API_ROUTES.settings,
        { body: { hostId, ...body } },
      )
      onChange(answer.connection)
      if (answer.connection.shipFrom) setShipFrom(answer.connection.shipFrom)
      setMessages(answer.messages ?? [])
      enqueueSnackbar(done, { variant: 'success', persist: false })
    })

  const field = (key: keyof TaxEngineAddress, label: string, flex = 1) => (
    <TextField
      size="small"
      label={label}
      value={shipFrom[key] ?? ''}
      onChange={(event) =>
        setShipFrom((current) => ({
          ...current,
          [key]:
            key === 'country' || key === 'region'
              ? event.target.value.toUpperCase().slice(0, key === 'country' ? 2 : 3)
              : event.target.value,
        }))
      }
      sx={{ flex }}
    />
  )

  return (
    <CardDisplay
      variant="outlined"
      header={connection.providerLabel}
      subheader={connection.environment === 'sandbox' ? 'Sandbox account' : 'Production account'}
      help={pluginDocsHelp('taxServices', { anchor: '#how-sales-are-taxed' })}
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1}>
            <Button size="small" disabled={busy} onClick={handleTest}>
              {'Test connection'}
            </Button>
            <Button size="small" color="error" disabled={busy} onClick={handleDisconnect}>
              {'Disconnect'}
            </Button>
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        {connection.lastTestOk ? null : (
          <Alert severity="error">
            {connection.lastError ?? `${connection.providerLabel} did not accept the stored credentials.`}
          </Alert>
        )}
        <Alert severity="info">
          {`Checkout and the register ask ${connection.providerLabel} for the tax on every sale ` +
            'while this store collects tax at its own rates (Taxes, above). Those rates stay as the ' +
            `fallback: when ${connection.providerLabel} does not answer within 5 seconds, the sale ` +
            'is taxed at them and the order says so.'}
        </Alert>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">{'Ship-from address'}</Typography>
            {connection.shipFrom ? (
              <Chip
                size="small"
                color={connection.shipFromValidated ? 'success' : 'default'}
                label={connection.shipFromValidated ? 'Confirmed' : 'Not confirmed'}
              />
            ) : null}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {'Where this store ships or sells from. The tax service taxes in-person sales here, ' +
              'and uses it as the origin for every other sale.'}
          </Typography>
          {field('line1', 'Street address')}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            {field('city', 'City', 2)}
            {field('region', 'State')}
            {field('postalCode', 'Postal code')}
            {field('country', 'Country')}
          </Stack>
          {messages.length > 0 ? (
            <Alert severity="warning">{messages.join(' ')}</Alert>
          ) : null}
          <Button
            size="small"
            disabled={busy}
            onClick={() => saveSettings({ shipFrom }, 'Ship-from address saved')}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Check and save address'}
          </Button>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            size="small"
            label="Default tax code"
            value={defaultTaxCode}
            onChange={(event) => setDefaultTaxCode(event.target.value.toUpperCase())}
            placeholder={connection.provider === 'avalara' ? 'P0000000' : 'None'}
            helperText="For products without a tax code of their own"
          />
          <Button
            size="small"
            disabled={busy}
            onClick={() => saveSettings({ defaultTaxCode }, 'Default tax code saved')}
          >
            {'Save code'}
          </Button>
        </Stack>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={connection.recordTransactions}
              disabled={busy}
              onChange={(event) =>
                saveSettings(
                  { recordTransactions: event.target.checked },
                  event.target.checked ? 'Paid orders will be recorded' : 'Paid orders will not be recorded',
                )
              }
            />
          }
          label={`Record paid orders and refunds in ${connection.providerLabel}`}
        />
        <ResponsibilityNote />
        <Divider />
        <TaxExemptionsSection hostId={hostId} />
      </Stack>
    </CardDisplay>
  )
}

export default TaxEngineCard
