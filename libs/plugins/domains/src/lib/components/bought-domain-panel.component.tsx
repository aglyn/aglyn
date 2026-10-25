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
import { ConnectSiteDialog, type ConnectableSite } from './connect-site-dialog.component'
import { DnsRecordsSection } from './dns-records-section.component'
import { formatDay, formatMoney, isWorkspaceScope, useDomainsFetch, type DomainsScope } from './domains-api'
import { RegistrantContactSection } from './registrant-contact-section.component'

/*
 * A DOMAIN THIS SITE BOUGHT (AGL-3962): where it stands, when it renews and
 * for how much, the one thing the owner may still owe (ICANN's email check),
 * and the controls an owner of a name expects — auto-renew, renew now, and
 * the code to move it elsewhere. Every state the sweep can leave a name in
 * has a sentence here, so nothing reads as "stuck".
 *
 * One panel on both pages (AGL-4040). On a site's Custom Domain page it
 * manages the names bought for that site; on the workspace's Domains page it
 * also connects a name to any site or disconnects it, and holds the
 * registrant contact and the DNS records.
 */

/**
 * What is left after a move onto a site that did not finish (AGL-4040): the
 * sweep put things back, or could not, and says which domain to reconnect.
 */
export function swapNotice(registration: Pick<DomainRegistrationView, 'domain' | 'failure'>): string | null {
  const failure = registration.failure ?? ''
  if (failure === 'swap-timed-out') {
    return `Connecting ${registration.domain} to a site didn’t finish, so it was undone and the site kept its own domain. Try connecting it again.`
  }
  if (failure.startsWith('swap-undo-failed:')) {
    const left = failure.slice('swap-undo-failed:'.length)
    return left === registration.domain
      ? `Connecting ${registration.domain} to a site didn’t finish, and it couldn’t be put back on the site it served. Connect it to a site again.`
      : `Connecting ${registration.domain} to a site didn’t finish, and ${left} couldn’t be put back on that site, so it is on its free address. Connect ${left} to it again.`
  }
  return null
}

/** Where a transfer in stands, by the registrar's state, in a sentence. */
export function transferStateSentence(state: string | null): string {
  switch (state) {
    case 'pending_unlock':
    case 'pending_registry_unlock':
      return 'Waiting for the domain to be unlocked. If it is still locked at your current registrar, unlock it there.'
    case 'pending_new_auth_code':
      return 'The registrar asked for a new transfer code. Contact support with the domain name.'
    case 'pending_transfer':
    case 'submitting_transfer':
    case 'pending_insert':
      return 'Your current registrar has the request. It usually releases the domain within five days, sometimes after emailing you to approve it.'
    default:
      return 'The transfer has started. It can take up to about a week.'
  }
}

const NO_BILLING =
  'Only a workspace member who manages billing can change this.'

function statusChip(registration: DomainRegistrationView): {
  label: string
  color: 'default' | 'info' | 'success' | 'warning' | 'error'
} {
  switch (registration.status) {
    case 'charging':
    case 'registering':
      return { label: registration.origin === 'transfer-in' ? 'Starting transfer…' : 'Registering…', color: 'info' }
    case 'transferring-in':
      return { label: 'Moving here…', color: 'info' }
    case 'refunded':
      return { label: 'Not completed', color: 'default' }
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

/** What the workspace's Domains page adds: the sites to connect to. */
export interface BoughtDomainWorkspace {
  sites: readonly ConnectableSite[]
  /** Each site's current domain, by site id; '' for none. */
  siteDomains: Readonly<Record<string, string>>
  /** Whether the site the name names serves it now. */
  connected: boolean
}

export interface BoughtDomainPanelProps {
  scope: DomainsScope
  registration: DomainRegistrationView
  billingPermission: boolean
  billingHref: string | null
  onChanged: () => void
  /** Present on the workspace's Domains page. */
  workspace?: BoughtDomainWorkspace
  /** On a site's page: the Domains page, where contacts and DNS are managed. */
  domainsHref?: string | null
}

export function BoughtDomainPanel(props: BoughtDomainPanelProps) {
  const { scope, registration, billingPermission, billingHref, onChanged, workspace, domainsHref } = props
  const request = useDomainsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [authCode, setAuthCode] = useState<string | null>(null)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const atWorkspace = isWorkspaceScope(scope) && Boolean(workspace)
  const chip = workspace && registration.status === 'active' && !workspace.connected
    ? { label: 'Not connected', color: 'default' as const }
    : statusChip(registration)
  const active = registration.status === 'active'
  // On a site's page: bought for it, and not serving it.
  const notConnected = !atWorkspace && active && Boolean(registration.failure?.startsWith('connect-'))
  const siteName = (hostId: string | null) =>
    workspace?.sites.find((site) => site.id === hostId)?.name ?? 'its site'

  const act = async (
    route: (typeof DOMAINS_API_ROUTES)[keyof typeof DOMAINS_API_ROUTES],
    body: Record<string, unknown>,
    done: string,
  ) => {
    setBusy(true)
    try {
      await request(route, { body: { ...scope, domain: registration.domain, ...body } })
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
        body: { ...scope, domain: registration.domain },
      })
      setAuthCode(answer.authCode)
    } catch (caught) {
      setTransferError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const connect = async (siteId: string) => {
    setBusy(true)
    setConnectError(null)
    try {
      await request(DOMAINS_API_ROUTES.connect, {
        body: { ...scope, domain: registration.domain, siteId },
      })
      setConnectOpen(false)
      enqueueSnackbar(`${registration.domain} is connecting to ${siteName(siteId)}`, {
        variant: 'success',
        persist: false,
      })
      onChanged()
    } catch (caught) {
      setConnectError((caught as Error).message)
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

      {(registration.status === 'registering' || registration.status === 'charging') &&
      registration.origin !== 'transfer-in' ? (
        <Alert severity="info">
          {'The registrar is registering it. This usually takes under a minute; you can leave this page.'}
        </Alert>
      ) : null}
      {registration.status === 'transferring-in' ? (
        <Alert severity="info">
          {`${transferStateSentence(registration.transferStatus)} The domain keeps its current DNS until it arrives, so its website and email keep working.${registration.transferStartedAtMs ? ` Started ${formatDay(registration.transferStartedAtMs)}.` : ''}`}
        </Alert>
      ) : null}
      {registration.status === 'refunded' ? (
        <Alert severity="info">
          {registration.origin === 'transfer-in'
            ? 'The transfer didn’t complete, so the domain stayed at its current registrar. Any charge for it was refunded.'
            : 'It couldn’t be registered, so any charge for it was refunded.'}
        </Alert>
      ) : null}
      {swapNotice(registration) ? (
        <Alert severity={registration.failure?.startsWith('swap-undo-failed:') ? 'error' : 'info'}>
          {swapNotice(registration)}
        </Alert>
      ) : null}
      {atWorkspace && workspace && active && workspace.connected ? (
        <Typography variant="body2">{`Connected to ${siteName(registration.hostId)}.`}</Typography>
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
          {atWorkspace && active ? (
            <Button
              size="small"
              variant={workspace?.connected ? 'text' : 'contained'}
              disabled={busy}
              onClick={() => {
                setConnectError(null)
                setConnectOpen(true)
              }}
            >
              {workspace?.connected ? 'Move to another site' : 'Connect to a site'}
            </Button>
          ) : null}
          {atWorkspace && active && workspace?.connected ? (
            <Button size="small" color="warning" disabled={busy} onClick={() => setDisconnectOpen(true)}>
              {'Disconnect'}
            </Button>
          ) : null}
        </Stack>
      ) : null}

      {!atWorkspace && domainsHref && (active || registration.status === 'expired') ? (
        <Typography variant="body2" color="text.secondary">
          {'The registrant contact and DNS records are on the '}
          <Button size="small" href={domainsHref} sx={{ verticalAlign: 'baseline' }}>
            {'Domains page'}
          </Button>
        </Typography>
      ) : null}

      {atWorkspace && isWorkspaceScope(scope) && (active || registration.status === 'expired') ? (
        <Stack spacing={3} sx={{ pt: 1 }}>
          <RegistrantContactSection orgId={scope.orgId} domain={registration.domain} editable={active} />
          {active ? <DnsRecordsSection orgId={scope.orgId} domain={registration.domain} /> : null}
        </Stack>
      ) : null}

      {workspace ? (
        <ConnectSiteDialog
          open={connectOpen}
          domain={registration.domain}
          currentHostId={workspace.connected ? registration.hostId : null}
          sites={workspace.sites}
          siteDomains={workspace.siteDomains}
          busy={busy}
          error={connectError}
          onClose={() => setConnectOpen(false)}
          onConnect={(siteId) => void connect(siteId)}
        />
      ) : null}
      <Dialog open={disconnectOpen} onClose={busy ? undefined : () => setDisconnectOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{`Disconnect ${registration.domain}?`}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {`${siteName(registration.hostId)} goes back to its free address. ${registration.domain} stays in your workspace, registered to you, and can be connected again at any time.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnectOpen(false)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="warning"
            disabled={busy}
            onClick={() => {
              setDisconnectOpen(false)
              void act(DOMAINS_API_ROUTES.disconnect, {}, `${registration.domain} is disconnected`)
            }}
          >
            {'Disconnect'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={transferOpen} onClose={() => setTransferOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{`Move ${registration.domain} to another registrar`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2">
              {'Start the transfer at the registrar you are moving to; it will ask for the transfer code below. Moving is free here, and the domain stays yours throughout. The domain registry decides when a domain may move: one registered or moved in the last 60 days usually has to wait, and the registrar tells us the date.'}
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
