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
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Card, CircularProgress, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  parseConnectReturnFragment,
  type OutreachConnectReturnError,
  type OutreachMailboxAvailability,
} from '../mailboxes/mailbox-api'
import type { OutreachMailbox, OutreachMailboxProvider } from '../model/outreach.types'
import { OutreachLinkDomainsCard } from './link-domains-card'
import { MailboxCard } from './mailbox-card'
import { useOutreachMailboxApi } from './use-outreach-mailbox-api'
import { useOutreachMailboxes } from './use-outreach-mailboxes'

export interface OutreachMailboxesSectionProps {
  /** The organization the hub is mounted under; `null` until the shell knows it. */
  orgId: string | null
  /** Sends the browser to the provider's consent screen. A test seam; the page's own location by default. */
  navigate?: (url: string) => void
}

const leavePage = (url: string) => window.location.assign(url)

/** The connect buttons' accessible names, spelled once for the specs. */
export const CONNECT_WITH_GOOGLE_LABEL = 'Connect with Google'
export const CONNECT_WITH_MICROSOFT_LABEL = 'Connect with Microsoft'

/** What the provider's redirect back said, in the words the panel shows. */
function returnErrorMessage(reason: OutreachConnectReturnError, provider: OutreachMailboxProvider): string {
  const name = provider === 'microsoft' ? 'Microsoft' : 'Google'
  if (reason === 'access_denied') return `${name} access was not granted, so no mailbox was connected.`
  if (reason === 'expired') return 'The connection took too long. Connect the mailbox again.'
  return `${name} could not complete the connection. Connect the mailbox again.`
}

/** Whether a provider's mailboxes can be connected, from an availability answer. */
function providerReady(availability: Availability, provider: OutreachMailboxProvider): boolean {
  if (availability.status !== 'ready') return false
  // An answer with no `providers` is from a deployment that connects Google only.
  return availability.providers ? availability.providers[provider] === true : provider === 'google' && availability.configured
}

type Availability =
  | { status: 'loading' }
  | ({ status: 'ready' } & OutreachMailboxAvailability)
  | { status: 'error'; message: string }

type Returned =
  | { status: 'completing' }
  | { status: 'connected'; email: string; created: boolean; confirmedAliases: string[] }
  | { status: 'failed'; message: string }

/** Takes a connect's return fragment out of the address bar without a history entry. */
function stripFragment(): void {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch {
    // A restricted document: the connect still finishes.
  }
}

/** The browser's IANA timezone, for a new mailbox's sending window. */
function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

/**
 * The Mailboxes section (AGL-2978): the organization's connected Google and
 * Microsoft 365 mailboxes (AGL-3489), and the connects that add one.
 *
 * A connect leaves the console for the provider's consent screen and comes back
 * here through the callback route, which puts the authorization code in this
 * page's URL fragment. The section reads the fragment once, takes it out of
 * the address bar before anything else, and finishes the connect with the
 * member's own session — the step that refuses a connect started by anyone
 * else.
 */
export function OutreachMailboxesSection(props: OutreachMailboxesSectionProps) {
  const { orgId, navigate = leavePage } = props
  const { data: user } = useUser()
  // Effects key on the uid, never on the account object: a fresh object for
  // the same person must not re-run a connect's completion or a fetch.
  const uid = user?.uid ?? null
  const api = useOutreachMailboxApi(orgId)
  const listed = useOutreachMailboxes(orgId)
  const { enqueueSnackbar } = useSnackbar()
  const [availability, setAvailability] = useState<Availability>({ status: 'loading' })
  const [returned, setReturned] = useState<Returned | null>(null)
  const [connecting, setConnecting] = useState(false)
  const returnHandled = useRef(false)

  // The connect's return: read once per mount, before availability, so the
  // code leaves the address bar as early as the page can take it.
  useEffect(() => {
    if (returnHandled.current || !orgId || !uid) return
    const fragment = parseConnectReturnFragment(window.location.hash)
    returnHandled.current = true
    if (!fragment) return
    stripFragment()
    if (fragment.kind === 'error') {
      setReturned({ status: 'failed', message: returnErrorMessage(fragment.reason, fragment.provider ?? 'google') })
      return
    }
    setReturned({ status: 'completing' })
    api
      .complete({ code: fragment.code, state: fragment.state, timezone: browserTimezone() })
      .then((done) =>
        setReturned({
          status: 'connected',
          email: done.mailbox.email,
          created: done.created,
          confirmedAliases: done.confirmedAliases,
        }),
      )
      .catch((error: Error) => setReturned({ status: 'failed', message: error.message }))
  }, [api, orgId, uid])

  useEffect(() => {
    if (!orgId || !uid) return undefined
    let current = true
    setAvailability({ status: 'loading' })
    api
      .availability()
      .then((answer) => current && setAvailability({ status: 'ready', ...answer }))
      .catch((error: Error) => current && setAvailability({ status: 'error', message: error.message }))
    return () => {
      current = false
    }
  }, [api, orgId, uid])

  const connect = useCallback(
    async (provider: OutreachMailboxProvider, loginHint?: string) => {
      setConnecting(true)
      try {
        navigate(await api.connect({ provider, ...(loginHint ? { loginHint } : {}) }))
      } catch (error) {
        setConnecting(false)
        enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
      }
    },
    [api, enqueueSnackbar, navigate],
  )

  const googleReady = providerReady(availability, 'google')
  const microsoftReady = providerReady(availability, 'microsoft')
  const configured = googleReady || microsoftReady
  const canManageAll = availability.status === 'ready' && availability.canManageAll
  const connectButtons = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
      <Button variant="contained" disabled={!googleReady || connecting} onClick={() => void connect('google')}>
        {CONNECT_WITH_GOOGLE_LABEL}
      </Button>
      <Button variant="outlined" disabled={!microsoftReady || connecting} onClick={() => void connect('microsoft')}>
        {CONNECT_WITH_MICROSOFT_LABEL}
      </Button>
    </Stack>
  )
  const reconnect = (mailbox: OutreachMailbox) =>
    mailbox.provider === 'microsoft' ? connect('microsoft', mailbox.email) : connect('google')
  const unconfigured = (['google', 'microsoft'] as const).filter((provider) => !providerReady(availability, provider))
  const mine = listed.mailboxes.filter((mailbox) => mailbox.connectedByUid === uid)
  const others = listed.mailboxes.filter((mailbox) => mailbox.connectedByUid !== uid)

  return (
    <Stack spacing={2}>
      <CardDisplay
        header="Mailboxes"
        help={pluginDocsHelp('sequences', { anchor: '#connect-a-mailbox' })}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: listed.mailboxes.length ? connectButtons : undefined }}
      >
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {'A sequence sends from your own Google or Microsoft 365 mailbox, so a message sits in your ' +
              'Sent mail and a reply comes back to your inbox. Each member connects their own.'}
          </Typography>
          {availability.status === 'ready' && unconfigured.length ? (
            <Alert severity="info">
              {unconfigured.length === 2
                ? 'Connecting a mailbox is not configured on this deployment.'
                : unconfigured[0] === 'microsoft'
                  ? 'Connecting a Microsoft 365 mailbox is not configured on this deployment.'
                  : 'Connecting a Google mailbox is not configured on this deployment.'}
            </Alert>
          ) : null}
          {availability.status === 'error' ? <Alert severity="error">{availability.message}</Alert> : null}
          {returned?.status === 'completing' ? (
            <Alert severity="info" icon={<CircularProgress size={18} />}>
              Finishing the connection…
            </Alert>
          ) : null}
          {returned?.status === 'connected' ? (
            <Alert severity="success" onClose={() => setReturned(null)}>
              {`${returned.created ? 'Connected' : 'Reconnected'} ${returned.email}.` +
                (returned.confirmedAliases.length
                  ? ` Verified ${returned.confirmedAliases.join(', ')} as your own.`
                  : '')}
            </Alert>
          ) : null}
          {returned?.status === 'failed' ? (
            <Alert severity="error" onClose={() => setReturned(null)}>
              {returned.message}
            </Alert>
          ) : null}
        </Stack>
      </CardDisplay>

      {listed.status === 'loading' ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading mailboxes…
          </Typography>
        </Stack>
      ) : null}
      {listed.status === 'error' ? (
        <Alert severity="error">The mailboxes could not be loaded. Reload the page to try again.</Alert>
      ) : null}
      {listed.status === 'ready' && !listed.mailboxes.length ? (
        <Card variant="outlined">
          <EmptyStateComponent
            label="No mailboxes connected"
            description={
              configured
                ? 'Connect your Google or Microsoft 365 mailbox to send sequences from your own address.'
                : undefined
            }
            action={configured ? connectButtons : undefined}
          />
        </Card>
      ) : null}
      {[...mine, ...others].map((mailbox) => {
        const isMine = mailbox.connectedByUid === uid
        return (
          <MailboxCard
            key={mailbox.id}
            mailbox={mailbox}
            isMine={isMine}
            canManage={isMine || canManageAll}
            api={api}
            onReconnect={() => void reconnect(mailbox)}
            reconnecting={connecting || !providerReady(availability, mailbox.provider === 'microsoft' ? 'microsoft' : 'google')}
          />
        )
      })}
      {listed.status === 'ready' && listed.mailboxes.length ? <OutreachLinkDomainsCard orgId={orgId} /> : null}
    </Stack>
  )
}
OutreachMailboxesSection.displayName = 'OutreachMailboxesSection'

export default OutreachMailboxesSection
