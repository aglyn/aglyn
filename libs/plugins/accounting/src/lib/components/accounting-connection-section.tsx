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

import { pluginDocsHelp, type PluginDocsAnchor } from '@aglyn/aglyn/app-utils/docs-help'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ROLE_CLASSIFICATIONS, ROLE_LABELS } from '../model/accounting-mapping'
import {
  ACCOUNTING_ACCOUNT_ROLES,
  ACCOUNTING_BASE_TAX_KEYS,
  ACCOUNTING_PROVIDERS,
  ACCOUNTING_PROVIDER_LABELS,
  accountingProviderName,
  parseAccountingConnectFragment,
  type AccountingAccountRole,
  type AccountingConnectionView,
  type AccountingMapping,
  type AccountingOptionsResponse,
  type AccountingProviderId,
  type AccountingStatusResponse,
} from '../model/accounting.types'
import { AccountingRouteError, useAccountingApi, type AccountingApi } from './use-accounting-api'

export interface AccountingConnectionSectionProps {
  orgId: string | null
  /** Test seam: the API; the routes by default. */
  api?: AccountingApi
  /** Test seam: sends the browser to the consent screen. */
  navigate?: (url: string) => void
}

/** A heading both ledger guides carry, so either can be opened at it. */
export type AccountingDocsAnchor = PluginDocsAnchor<'connectQuickbooksOnline'> &
  PluginDocsAnchor<'connectXero'>

/**
 * The help affordance for an Accounting card: the guide for the ledger the
 * workspace is connected to, at one of the headings the two guides share.
 * With no connection yet the QuickBooks Online guide stands in, since the two
 * walk through the same steps.
 */
export function accountingDocsHelp(
  provider: AccountingProviderId | null | undefined,
  anchor: AccountingDocsAnchor,
  excerpt: string,
): ReturnType<typeof pluginDocsHelp> {
  return provider === 'xero'
    ? pluginDocsHelp('connectXero', { anchor, excerpt })
    : pluginDocsHelp('connectQuickbooksOnline', { anchor, excerpt })
}

/** The connect buttons' names, spelled once for the specs. */
export const connectLabel = (provider: AccountingProviderId) =>
  provider === 'codat' ? 'Connect other accounting software' : `Connect ${ACCOUNTING_PROVIDER_LABELS[provider]}`

/**
 * A connection's card title: the provider and the company, or — through
 * Codat — the company and the software it keeps its books in.
 */
export function connectionTitle(connection: Pick<AccountingConnectionView, 'provider' | 'tenantName'>): string {
  const label = ACCOUNTING_PROVIDER_LABELS[connection.provider]
  if (connection.provider === 'codat') return connection.tenantName || label
  return connection.tenantName ? `${label} — ${connection.tenantName}` : label
}

const ROLE_HELP: Readonly<Record<AccountingAccountRole, string>> = {
  income: 'Where item sales are recorded.',
  shippingIncome: 'Where shipping you charge is recorded. Sales income when left empty.',
  clearing:
    'A bank account that stands for your Stripe balance. Every sale is paid into it and every payout leaves it, so it returns to zero with each payout.',
  feeExpense: `Where the ${PLATFORM_BRAND_NAME} fee on each sale is recorded as an expense.`,
  payoutBank: 'The bank account Stripe pays out to.',
  taxLiability: 'Where sales tax collected is recorded by the daily summary.',
}

const taxKeyLabel = (key: string) =>
  key === 'taxed' ? 'Orders with sales tax' : key === 'untaxed' ? 'Orders without sales tax' : `Tax rate ${key}`

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const leavePage = (url: string) => window.location.assign(url)

type Load = { status: 'loading' } | { status: 'error'; message: string; refused: boolean } | { status: 'ready'; data: AccountingStatusResponse }

/**
 * The Connection section of the Accounting page (AGL-3614): connect a
 * ledger, finish a connect the provider sent back, pick a Xero
 * organization, choose the accounts and tax codes, and disconnect.
 */
export function AccountingConnectionSection(props: AccountingConnectionSectionProps) {
  const routesApi = useAccountingApi(props.orgId)
  const api = props.api ?? routesApi
  const navigate = props.navigate ?? leavePage
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [notice, setNotice] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const completing = useRef(false)

  const refresh = useCallback(async () => {
    try {
      setLoad({ status: 'ready', data: await api.status() })
    } catch (error) {
      setLoad({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        refused: error instanceof AccountingRouteError && error.refused,
      })
    }
  }, [api])

  // Finishing a connect the provider sent back, once, then the page's own read.
  useEffect(() => {
    if (!props.orgId) return
    const returned = typeof window === 'undefined' ? null : parseAccountingConnectFragment(window.location.hash)
    if (returned && !completing.current) {
      completing.current = true
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      if (returned.kind === 'error') {
        setNotice({
          severity: 'error',
          text:
            returned.reason === 'access_denied'
              ? 'Access was not granted, so nothing was connected.'
              : returned.reason === 'expired'
                ? 'The connection took too long. Connect again.'
                : 'The connection could not be completed. Connect again.',
        })
      } else {
        setNotice({ severity: 'info', text: 'Finishing the connection…' })
        void api
          .completeConnect({ code: returned.code, state: returned.state, realmId: returned.realmId })
          .then(({ connection }) =>
            setNotice({
              severity: 'success',
              text:
                connection.status === 'choose-tenant'
                  ? connection.provider === 'codat'
                    ? 'Connected. Choose which books to use.'
                    : 'Connected. Choose which Xero organization to use.'
                  : `Connected ${connectionTitle(connection)}. Choose your accounts below.`,
            }),
          )
          .catch((error: unknown) =>
            setNotice({ severity: 'error', text: error instanceof Error ? error.message : String(error) }),
          )
          .finally(() => void refresh())
        return
      }
    }
    void refresh()
  }, [api, props.orgId, refresh])

  const connect = async (provider: AccountingProviderId) => {
    setBusy(true)
    try {
      const { url } = await api.connect(provider)
      navigate(url)
    } catch (error) {
      setNotice({ severity: 'error', text: error instanceof Error ? error.message : String(error) })
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await api.disconnect()
      setNotice({ severity: 'success', text: 'Disconnected. Nothing more will be posted to those books.' })
      await refresh()
    } catch (error) {
      setNotice({ severity: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  if (load.status === 'loading') {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">
          Loading accounting…
        </Typography>
      </Stack>
    )
  }
  if (load.status === 'error') {
    return <Alert severity={load.refused ? 'info' : 'error'}>{load.message}</Alert>
  }

  const { data } = load
  const connection = data.connection
  const available = ACCOUNTING_PROVIDERS.filter((provider) => data.providers[provider])
  const noticeAlert = notice ? (
    <Alert severity={notice.severity} onClose={notice.severity === 'info' ? undefined : () => setNotice(null)}>
      {notice.text}
    </Alert>
  ) : null

  if (!connection) {
    // Nothing to offer on a deployment with no ledger credentials: say so
    // once, and draw no card with nothing in it.
    if (!available.length) {
      return (
        <Stack spacing={2}>
          {noticeAlert}
          <Alert severity="info">Connecting accounting software is not available yet.</Alert>
        </Stack>
      )
    }
    return (
      <Stack spacing={2}>
        {noticeAlert}
        <CardDisplay
          header="Connect your books"
          help={accountingDocsHelp(
            available.length === 1 ? available[0] : null,
            '#connect',
            'Connect your accounting software, and paid orders, refunds, fees and payouts are posted to your books, to the accounts you choose.',
          )}
          contentGutterX
          contentGutterY
          HeaderProps={{
            action: (
              <Stack direction="row" spacing={1}>
                {available.map((provider) => (
                  <Button key={provider} variant="contained" disabled={busy} onClick={() => void connect(provider)}>
                    {connectLabel(provider)}
                  </Button>
                ))}
              </Stack>
            ),
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {'Post every sale, refund, fee and payout to your accounting software as it happens, so your books ' +
              'match Stripe without typing anything in. You choose the accounts each one is posted to.'}
          </Typography>
        </CardDisplay>
      </Stack>
    )
  }

  const name = accountingProviderName(connection.provider)
  return (
    <Stack spacing={2}>
      {noticeAlert}
      <CardDisplay
        header={connectionTitle(connection)}
        help={accountingDocsHelp(
          connection.provider,
          '#disconnect',
          `The ledger this workspace posts to. Disconnecting stops posting; what was already posted stays in ${name}.`,
        )}
        contentGutterX
        contentGutterY
        HeaderProps={{
          action: (
            <Stack direction="row" spacing={1}>
              {connection.status === 'reconnect-required' && data.providers[connection.provider] ? (
                <Button variant="contained" disabled={busy} onClick={() => void connect(connection.provider)}>
                  {`Reconnect ${name}`}
                </Button>
              ) : null}
              <Button color="error" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </Stack>
          ),
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Chip
              size="small"
              color={connection.status === 'connected' ? 'success' : 'warning'}
              label={
                connection.status === 'connected'
                  ? 'Connected'
                  : connection.status === 'choose-tenant'
                    ? 'Choose an organization'
                    : 'Reconnect required'
              }
            />
            {connection.environment === 'sandbox' ? <Chip size="small" label="Sandbox company" /> : null}
            {connection.homeCurrency ? <Chip size="small" label={`Home currency ${connection.homeCurrency}`} /> : null}
          </Stack>
          {connection.connectedByEmail ? (
            <Typography variant="body2" color="text.secondary">
              {`Connected by ${connection.connectedByEmail} on ${new Date(connection.connectedAtMs).toLocaleDateString()}.`}
            </Typography>
          ) : null}
          {connection.status === 'reconnect-required' ? (
            <Alert severity="warning">
              {`${connectionTitle(connection)} no longer accepts this connection${connection.lastError ? ` (${connection.lastError})` : ''}. ` +
                'Nothing is posted until you reconnect; what is waiting will post then.'}
            </Alert>
          ) : null}
          {connection.status === 'connected' && connection.missingRoles.length ? (
            <Alert severity="info">Choose your accounts below. Nothing is posted until they are set.</Alert>
          ) : null}
        </Stack>
      </CardDisplay>
      {connection.status === 'choose-tenant' ? (
        <TenantPicker connection={connection} api={api} onPicked={refresh} />
      ) : null}
      {connection.status === 'connected' ? (
        <MappingCard connection={connection} seenTaxKeys={data.seenTaxKeys} api={api} onSaved={refresh} />
      ) : null}
    </Stack>
  )
}
AccountingConnectionSection.displayName = 'AccountingConnectionSection'

function TenantPicker(props: { connection: AccountingConnectionView; api: AccountingApi; onPicked: () => Promise<void> }) {
  const tenants = props.connection.tenants ?? []
  const codat = props.connection.provider === 'codat'
  const [picked, setPicked] = useState(tenants[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const choose = async () => {
    setBusy(true)
    setError(null)
    try {
      await props.api.selectTenant(picked)
      await props.onPicked()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }
  return (
    <CardDisplay
      header={codat ? 'Choose your books' : 'Choose a Xero organization'}
      help={
        codat
          ? pluginDocsHelp('connectQuickbooksOnline', { anchor: '#choose-your-books' })
          : pluginDocsHelp('connectXero', { anchor: '#choose-an-organization' })
      }
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button variant="contained" disabled={busy || !picked} onClick={() => void choose()}>
            {codat ? 'Use these books' : 'Use this organization'}
          </Button>
        ),
      }}
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <RadioGroup value={picked} onChange={(event) => setPicked(event.target.value)}>
          {tenants.map((tenant) => (
            <FormControlLabel key={tenant.id} value={tenant.id} control={<Radio />} label={tenant.name || tenant.id} />
          ))}
        </RadioGroup>
      </Stack>
    </CardDisplay>
  )
}

function MappingCard(props: {
  connection: AccountingConnectionView
  seenTaxKeys: string[]
  api: AccountingApi
  onSaved: () => Promise<void>
}) {
  const { connection, api } = props
  const [options, setOptions] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: AccountingOptionsResponse }
  >({ status: 'loading' })
  const [mapping, setMapping] = useState<AccountingMapping>(() => ({
    ...connection.mapping,
    timeZone: connection.missingRoles.length && connection.mapping.timeZone === 'UTC' ? browserTimeZone() : connection.mapping.timeZone,
  }))
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let live = true
    api
      .options()
      .then((data) => live && setOptions({ status: 'ready', data }))
      .catch((error: unknown) =>
        live && setOptions({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
      )
    return () => {
      live = false
    }
  }, [api])

  const roles = useMemo(
    () =>
      ACCOUNTING_ACCOUNT_ROLES.filter((role) => role !== 'taxLiability' || mapping.syncMode === 'daily-summary'),
    [mapping.syncMode],
  )
  const taxKeys = useMemo(
    () => [...new Set([...ACCOUNTING_BASE_TAX_KEYS, ...props.seenTaxKeys])],
    [props.seenTaxKeys],
  )

  const save = async () => {
    setSaving(true)
    setResult(null)
    try {
      await api.saveSettings(mapping)
      setResult({ severity: 'success', text: 'Saved. Sales from the start date on will be posted.' })
      await props.onSaved()
    } catch (error) {
      setResult({ severity: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <CardDisplay
      header="Accounts and tax"
      help={accountingDocsHelp(
        connection.provider,
        '#choose-your-accounts',
        'The accounts and tax codes sales, refunds, fees and payouts are posted to, how sales are posted, and the start date. Nothing is posted until the accounts are chosen.',
      )}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button variant="contained" disabled={saving || options.status !== 'ready'} onClick={() => void save()}>
            Save
          </Button>
        ),
      }}
    >
      {options.status === 'loading' ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Reading your chart of accounts…
          </Typography>
        </Stack>
      ) : options.status === 'error' ? (
        <Alert severity="error">{options.message}</Alert>
      ) : (
        <Stack spacing={2.5}>
          {result ? <Alert severity={result.severity}>{result.text}</Alert> : null}
          <FormControl>
            <FormLabel id="accounting-sync-mode">How sales are posted</FormLabel>
            <RadioGroup
              aria-labelledby="accounting-sync-mode"
              value={mapping.syncMode}
              onChange={(event) => setMapping({ ...mapping, syncMode: event.target.value as AccountingMapping['syncMode'] })}
            >
              <FormControlLabel value="per-order" control={<Radio />} label="One sales receipt per order" />
              <FormControlLabel value="daily-summary" control={<Radio />} label="One summary journal entry per day" />
            </RadioGroup>
          </FormControl>
          {roles.map((role) => {
            const choices = options.data.accounts.filter((account) => ROLE_CLASSIFICATIONS[role].includes(account.classification))
            return (
              <TextField
                key={role}
                select
                label={ROLE_LABELS[role]}
                helperText={ROLE_HELP[role]}
                value={mapping.accounts[role] ?? ''}
                onChange={(event) =>
                  setMapping({ ...mapping, accounts: { ...mapping.accounts, [role]: event.target.value || undefined } })
                }
              >
                <MenuItem value="">
                  <em>{role === 'shippingIncome' ? 'Same as sales income' : 'Choose an account'}</em>
                </MenuItem>
                {choices.map((account) => (
                  <MenuItem key={account.id} value={account.id}>
                    {account.code ? `${account.code} · ${account.name}` : account.name}
                  </MenuItem>
                ))}
              </TextField>
            )
          })}
          <Typography variant="subtitle2">Sales tax codes</Typography>
          {taxKeys.map((key) => (
            <TextField
              key={key}
              select
              label={taxKeyLabel(key)}
              value={mapping.taxCodes[key] ?? ''}
              onChange={(event) => {
                const next = { ...mapping.taxCodes }
                if (event.target.value) next[key] = event.target.value
                else delete next[key]
                setMapping({ ...mapping, taxCodes: next })
              }}
            >
              <MenuItem value="">
                <em>{key === 'taxed' || key === 'untaxed' ? 'Your ledger’s default' : 'Same as orders with sales tax'}</em>
              </MenuItem>
              {options.data.taxCodes.map((code) => (
                <MenuItem key={code.id} value={code.id}>
                  {code.ratePercent !== null ? `${code.name} (${code.ratePercent}%)` : code.name}
                </MenuItem>
              ))}
            </TextField>
          ))}
          <TextField
            type="date"
            label="Start date"
            helperText="Sales and payouts from this day on are posted, including ones before you connected. Leave it empty to start from the day you connected."
            value={mapping.startDate ?? ''}
            onChange={(event) => setMapping({ ...mapping, startDate: event.target.value || null })}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Time zone"
            helperText="The day each sale is dated in your books."
            value={mapping.timeZone}
            onChange={(event) => setMapping({ ...mapping, timeZone: event.target.value })}
          />
        </Stack>
      )}
    </CardDisplay>
  )
}

export default AccountingConnectionSection
