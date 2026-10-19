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

import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import type { DomainRegistrationView } from '../model/registration'
import { formatDay, formatMoney, useDomainsFetch } from './domains-api'

/*
 * A DOMAIN THIS SITE BOUGHT (AGL-3962): where it stands, when it renews and
 * for how much, the one thing the owner may still owe (ICANN's email check),
 * and the controls an owner of a name expects — auto-renew, renew now, and
 * the code to move it elsewhere. Every state the sweep can leave a name in
 * has a sentence here, so nothing reads as "stuck".
 */

const NO_BILLING =
  'Only a workspace member who manages billing can change this.'

function statusChip(registration: DomainRegistrationView): {
  label: string
  color: 'default' | 'info' | 'success' | 'warning' | 'error'
} {
  switch (registration.status) {
    case 'charging':
    case 'registering':
      return { label: 'Registering…', color: 'info' }
    case 'connecting':
      return { label: 'Connecting to your site…', color: 'info' }
    case 'expired':
      return { label: 'Expired', color: 'error' }
    case 'transferred-out':
      return { label: 'Moved to another registrar', color: 'default' }
    default:
      return registration.failure?.startsWith('connect-')
        ? { label: 'Not connected', color: 'warning' }
        : { label: 'Yours', color: 'success' }
  }
}

export interface BoughtDomainPanelProps {
  hostId: string
  registration: DomainRegistrationView
  billingPermission: boolean
  billingHref: string | null
  onChanged: () => void
}

export function BoughtDomainPanel(props: BoughtDomainPanelProps) {
  const { hostId, registration, billingPermission, billingHref, onChanged } = props
  const request = useDomainsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [authCode, setAuthCode] = useState<string | null>(null)
  const [transferError, setTransferError] = useState<string | null>(null)
  const chip = statusChip(registration)
  const active = registration.status === 'active'
  const notConnected = active && Boolean(registration.failure?.startsWith('connect-'))

  const act = async (
    route: (typeof DOMAINS_API_ROUTES)[keyof typeof DOMAINS_API_ROUTES],
    body: Record<string, unknown>,
    done: string,
  ) => {
    setBusy(true)
    try {
      await request(route, { body: { hostId, domain: registration.domain, ...body } })
      enqueueSnackbar(done, { variant: 'success', persist: false })
    } catch (caught) {
      enqueueSnackbar((caught as Error).message, { variant: 'error', allowDuplicate: true })
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const showTransferCode = async () => {
    setBusy(true)
    setTransferError(null)
    try {
      const answer = await request<{ authCode: string }>(DOMAINS_API_ROUTES.transferOut, {
        body: { hostId, domain: registration.domain },
      })
      setAuthCode(answer.authCode)
    } catch (caught) {
      setTransferError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const renewLine = registration.expiresAtMs
    ? registration.autoRenew
      ? `Renews on ${formatDay(registration.expiresAtMs)} for ${formatMoney(registration.renewalCents)} a year.`
      : `Expires on ${formatDay(registration.expiresAtMs)}. Auto-renew is off.`
    : null

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6" component="p">
          {registration.domain}
        </Typography>
        <Chip size="small" label={chip.label} color={chip.color} />
      </Stack>
      {registration.registrantEmail ? (
        <Typography variant="body2" color="text.secondary">
          {`Registered to ${registration.registrantEmail}.`}
          {renewLine ? ` ${renewLine}` : ''}
        </Typography>
      ) : null}

      {registration.status === 'registering' || registration.status === 'charging' ? (
        <Alert severity="info">
          {'The registrar is registering it. This usually takes under a minute; you can leave this page.'}
        </Alert>
      ) : null}
      {registration.status === 'connecting' ? (
        <Alert severity="info">
          {'It is registered and being connected to this site, with its security certificate. This usually takes a few minutes.'}
        </Alert>
      ) : null}
      {registration.verifyByMs ? (
        <Alert severity="warning">
          {`Confirm the email the registrar sent to ${registration.verificationEmail ?? registration.registrantEmail} by ${formatDay(registration.verifyByMs)}. ICANN requires it, and an unconfirmed domain can be suspended. Check your spam folder if you can’t find it.`}
        </Alert>
      ) : null}
      {registration.renewalFailing ? (
        <Alert
          severity="error"
          action={
            billingHref ? (
              <Button color="inherit" size="small" href={billingHref}>
                {'Update card'}
              </Button>
            ) : undefined
          }
        >
          {'The renewal couldn’t be charged to the card on file. Update the card, then renew now, or we’ll try again automatically.'}
        </Alert>
      ) : null}
      {notConnected ? (
        <Alert
          severity="warning"
          action={
            <Button
              color="inherit"
              size="small"
              disabled={busy}
              onClick={() => void act(DOMAINS_API_ROUTES.reconnect, {}, `${registration.domain} is connecting`)}
            >
              {'Connect it'}
            </Button>
          }
        >
          {`${registration.domain} is yours but isn’t connected to this site.`}
        </Alert>
      ) : null}
      {registration.status === 'expired' ? (
        <Alert severity="error">
          {'It expired and the site is back on its free address. For a short while after expiring, a domain can usually still be renewed.'}
        </Alert>
      ) : null}
      {registration.status === 'transferred-out' ? (
        <Alert severity="info">
          {'It now belongs to another registrar, where you manage and renew it.'}
        </Alert>
      ) : null}

      {active || registration.status === 'expired' ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
          {active ? (
            <BlockedControl blocked={!billingPermission} reason={NO_BILLING}>
              <FormControlLabel
                control={
                  <Switch
                    checked={registration.autoRenew}
                    disabled={busy || !billingPermission}
                    onChange={(event) =>
                      void act(
                        DOMAINS_API_ROUTES.autoRenew,
                        { autoRenew: event.target.checked },
                        event.target.checked ? 'Auto-renew is on' : 'Auto-renew is off',
                      )
                    }
                  />
                }
                label="Auto-renew"
              />
            </BlockedControl>
          ) : null}
          {registration.renewalFailing || registration.status === 'expired' ? (
            <BlockedControl blocked={!billingPermission} reason={NO_BILLING}>
              <Button
                variant="contained"
                size="small"
                disabled={busy}
                onClick={() =>
                  void act(DOMAINS_API_ROUTES.renewNow, {}, `${registration.domain} is renewing`)
                }
              >
                {`Renew now for ${formatMoney(registration.renewalCents)}`}
              </Button>
            </BlockedControl>
          ) : null}
          {active ? (
            <BlockedControl blocked={!billingPermission} reason={NO_BILLING}>
              <Button
                size="small"
                disabled={busy}
                onClick={() => {
                  setAuthCode(null)
                  setTransferError(null)
                  setTransferOpen(true)
                }}
              >
                {'Move to another registrar'}
              </Button>
            </BlockedControl>
          ) : null}
        </Stack>
      ) : null}

      <Dialog open={transferOpen} onClose={() => setTransferOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{`Move ${registration.domain} to another registrar`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2">
              {'Start the transfer at the registrar you are moving to; it will ask for the transfer code below. Moving is free here, and the domain stays yours throughout.'}
            </Typography>
            <Typography variant="body2">
              {'To keep this site working at the domain, keep its DNS records pointing here at your new registrar. Without them, the site goes back to its free address.'}
            </Typography>
            {authCode ? (
              <TextField
                label="Transfer code"
                value={authCode}
                slotProps={{ htmlInput: { readOnly: true } }}
                helperText="Your workspace’s owners are emailed whenever this code is shown."
              />
            ) : null}
            {transferError ? <Alert severity="warning">{transferError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTransferOpen(false)}>{'Close'}</Button>
          {authCode ? (
            <Button
              variant="contained"
              onClick={() => {
                void navigator.clipboard?.writeText(authCode)
                enqueueSnackbar('Transfer code copied', { variant: 'success', persist: false })
              }}
            >
              {'Copy code'}
            </Button>
          ) : (
            <Button variant="contained" disabled={busy} onClick={() => void showTransferCode()}>
              {'Show transfer code'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
