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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  CONTRACT_RATE_LABELS,
  type ContractRateVerdict,
} from '@aglyn/aglyn/app-utils/full-use-cost'
import type {
  ContractNumericRateKey,
  ResolvedContractRates,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { OrgContractTerms } from '@aglyn/aglyn/foundation'
import { docsHelp } from '../constants/docs-links'

/** What `/api/admin/enterprise-contract` answers to `get`. */
interface ContractState {
  stored: OrgContractTerms | null
  rates: ResolvedContractRates
  defaults: ResolvedContractRates
  additionKeys: ContractNumericRateKey[]
  usageKeys: ContractNumericRateKey[]
  active: boolean
  usageCeilingMonthlyUsd: number | null
  baseMonthlyUsd: number | null
  contracted: Record<string, number | null>
  check: ContractRateVerdict
}

/** How each contracted band reads to staff. */
const CONTRACTED_LABELS: Record<string, string> = {
  hostLimit: 'Sites',
  managersPerOrg: 'Team seats',
  membersPerHost: 'Collaborators per site',
  datasetsPerOrg: 'Datasets',
  posRegisters: 'POS registers',
  storagePerHostMb: 'Media storage per site (MB)',
  bandwidthGb: 'Bandwidth (GB)',
  dataStorageMbPerOrg: 'Stored data (MB)',
  apiRequestsPerMonth: 'API requests a month',
  emailSendsPerMonth: 'Marketing email a month',
  contactsPerHost: 'CRM records per site',
  actionRunsPerMonth: 'Action runs a month',
}

const amount = (value: number | null): string =>
  value === null
    ? 'Unlimited'
    : Number.isFinite(value)
      ? value.toLocaleString()
      : 'Unlimited'

export interface StaffOrgContractCardProps {
  orgId: string
}

/**
 * A Custom contract's rate card (AGL-4233): what its additions and its usage
 * past the contract sell at, the contracted amounts they sit on top of, and
 * whether usage bills automatically up to a monthly ceiling. Empty fields are
 * the public Pro rates; a rate under cost + 30% at full use is refused by the
 * route with the figures, which this card shows.
 */
export default function StaffOrgContractCard({ orgId }: StaffOrgContractCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<ContractState | null>(null)
  const [rates, setRates] = useState<Record<string, string>>({})
  const [usageBilling, setUsageBilling] = useState(true)
  const [ceiling, setCeiling] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  const call = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await authorizedFetch(user, '/api/admin/enterprise-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, ...payload }),
      })
      return { ok: response.ok, body: await response.json().catch(() => ({})) }
    },
    [orgId, user],
  )

  const load = useCallback(async () => {
    const { ok, body } = await call({ action: 'get' })
    if (!ok) return
    const next = body as ContractState
    setState(next)
    const negotiated = (next.stored?.rates ?? {}) as Record<string, number | null>
    setRates(
      Object.fromEntries(
        [...next.additionKeys, ...next.usageKeys].map((key) => [
          key,
          key in negotiated ? (negotiated[key] === null ? '' : String(negotiated[key])) : '',
        ]),
      ),
    )
    setUsageBilling(next.stored ? next.stored.usageBilling === true : true)
    setCeiling(
      next.stored?.usageCeilingMonthlyUsd != null
        ? String(next.stored.usageCeilingMonthlyUsd)
        : '',
    )
  }, [call])

  useEffect(() => {
    if (user) void load()
  }, [load, user])

  const save = async () => {
    if (busy) return
    setBusy(true)
    setRefusal(null)
    try {
      const { ok, body } = await call({
        action: 'set',
        contract: {
          rates: Object.fromEntries(
            Object.entries(rates).filter(([, value]) => value.trim() !== ''),
          ),
          usageBilling,
          usageCeilingMonthlyUsd: ceiling.trim() === '' ? null : ceiling,
        },
      })
      if (!ok) {
        setRefusal(String(body?.error ?? 'The rate card was not saved'))
        return
      }
      enqueueSnackbar('Contract rates saved', { variant: 'success' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { ok, body } = await call({ action: 'remove' })
      if (!ok) {
        enqueueSnackbar(String(body?.error ?? 'Not removed'), { variant: 'warning' })
        return
      }
      enqueueSnackbar('Rate card removed', { variant: 'success' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const rateField = (key: ContractNumericRateKey) => (
    <TextField
      key={key}
      size="small"
      type="number"
      label={CONTRACT_RATE_LABELS[key]}
      value={rates[key] ?? ''}
      placeholder={
        state?.defaults[key] == null ? 'Not sold' : `$${state.defaults[key]} (Pro)`
      }
      helperText={
        state && state.rates[key] !== state.defaults[key]
          ? `Negotiated: ${state.rates[key] === null ? 'not sold' : `$${state.rates[key]}`}`
          : 'Pro rate'
      }
      slotProps={{ inputLabel: { shrink: true } }}
      onChange={(event) =>
        setRates((current) => ({ ...current, [key]: event.target.value }))
      }
    />
  )

  return (
    <CardDisplay
      header={'Contract rates'}
      help={docsHelp('staffConsole', { anchor: '#contract-rates' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        {!state ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading the rate card…'}
          </Typography>
        ) : (
          <>
            <Alert severity={state.stored ? (state.active ? 'success' : 'info') : 'info'}>
              {state.stored
                ? state.active
                  ? 'This Custom contract sells its additions and bills usage at the rates below.'
                  : 'A rate card is saved. It applies once this workspace is on Custom with a live subscription.'
                : 'No rate card. This workspace sells no add-ons and refuses usage past its bands. ' +
                  'Save one to let the customer add capacity themselves.'}
            </Alert>
            <Typography variant="subtitle2">{'Contracted amounts'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {Object.entries(state.contracted)
                .map(([key, value]) => `${CONTRACTED_LABELS[key] ?? key}: ${amount(value)}`)
                .join(' · ')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {'Change the contracted amounts with the entitlement overrides on this page.'}
            </Typography>
            <Typography variant="subtitle2">{'Additions'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {'Leave a field empty for the public Pro rate.'}
            </Typography>
            <Stack spacing={1.5}>{state.additionKeys.map(rateField)}</Stack>
            <Typography variant="subtitle2">{'Usage past the contract'}</Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={usageBilling}
                  onChange={(event) => setUsageBilling(event.target.checked)}
                />
              }
              label="Bill usage past the contract automatically"
            />
            {state.stored?.usageBillingFrom ? (
              <Typography variant="caption" color="text.secondary">
                {`Usage billing applies from ${state.stored.usageBillingFrom}.`}
              </Typography>
            ) : usageBilling ? (
              <Typography variant="caption" color="text.secondary">
                {'Turning it on starts billing next calendar month.'}
              </Typography>
            ) : null}
            <TextField
              size="small"
              type="number"
              label="Monthly ceiling on usage billing (USD)"
              value={ceiling}
              placeholder={
                state.baseMonthlyUsd ? `$${state.baseMonthlyUsd} (the base price)` : ''
              }
              helperText={
                'At the ceiling, usage stops billing and the hard caps apply until the month turns. ' +
                'Staff get an alert.'
              }
              slotProps={{ inputLabel: { shrink: true } }}
              onChange={(event) => setCeiling(event.target.value)}
            />
            {state.stored?.ceilingReachedMonth ? (
              <Alert severity="warning">
                {`The ceiling was reached in ${state.stored.ceilingReachedMonth}. Saving clears it.`}
              </Alert>
            ) : null}
            <Stack spacing={1.5}>{state.usageKeys.map(rateField)}</Stack>
            {!state.check.ok ? (
              <Alert severity="error">
                {'Under the contract floor (cost + 30% at full use): ' +
                  state.check.failures.map((check) => CONTRACT_RATE_LABELS[check.key]).join(', ')}
              </Alert>
            ) : null}
            {refusal ? <Alert severity="error">{refusal}</Alert> : null}
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? 'Saving…' : 'Save rate card'}
              </Button>
              {state.stored ? (
                <Button size="small" disabled={busy} onClick={() => void remove()}>
                  {'Remove rate card'}
                </Button>
              ) : null}
            </Stack>
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}
