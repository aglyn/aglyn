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
import { MailboxCard } from './mailbox-card'
import { useOutreachMailboxApi } from './use-outreach-mailbox-api'
import { useOutreachMailboxes } from './use-outreach-mailboxes'

export interface OutreachMailboxesSectionProps {
  /** The organization the hub is mounted under; `null` until the shell knows it. */
  orgId: string | null
  /** Sends the browser to Google's consent screen. A test seam; the page's own location by default. */
  navigate?: (url: string) => void
}

const leavePage = (url: string) => window.location.assign(url)

/** The connect button's accessible name, spelled once for the specs. */
export const CONNECT_WITH_GOOGLE_LABEL = 'Connect with Google'

/** What Google's redirect back said, in the words the panel shows. */
const RETURN_ERROR_MESSAGES: Record<OutreachConnectReturnError, string> = {
  access_denied: 'Google access was not granted, so no mailbox was connected.',
  expired: 'The connection took too long. Connect the mailbox again.',
  google_error: 'Google could not complete the connection. Connect the mailbox again.',
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
 * The Mailboxes section (AGL-2978): the organization's connected Google
 * mailboxes, and the connect that adds one.
 *
 * A connect leaves the console for Google's consent screen and comes back
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
      setReturned({ status: 'failed', message: RETURN_ERROR_MESSAGES[fragment.reason] })
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

  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      navigate(await api.connect())
    } catch (error) {
      setConnecting(false)
      enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
    }
  }, [api, enqueueSnackbar, navigate])

  const configured = availability.status === 'ready' && availability.configured
  const canManageAll = availability.status === 'ready' && availability.canManageAll
  const connectButton = (
    <Button variant="contained" disabled={!configured || connecting} onClick={() => void connect()}>
      {CONNECT_WITH_GOOGLE_LABEL}
    </Button>
  )
  const mine = listed.mailboxes.filter((mailbox) => mailbox.connectedByUid === uid)
  const others = listed.mailboxes.filter((mailbox) => mailbox.connectedByUid !== uid)

  return (
    <Stack spacing={2}>
      <CardDisplay
        header="Mailboxes"
        help={pluginDocsHelp('sequences', { anchor: '#connect-a-mailbox' })}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: listed.mailboxes.length ? connectButton : undefined }}
      >
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {'A sequence sends from your own Google mailbox, so a message sits in your Sent mail ' +
              'and a reply comes back to your inbox. Each member connects their own.'}
          </Typography>
          {availability.status === 'ready' && !availability.configured ? (
            <Alert severity="info">Connecting a Google mailbox is not configured on this deployment.</Alert>
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
                ? 'Connect your Google mailbox to send sequences from your own address.'
                : undefined
            }
            action={configured ? connectButton : undefined}
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
            onReconnect={() => void connect()}
            reconnecting={connecting || !configured}
          />
        )
      })}
    </Stack>
  )
}
OutreachMailboxesSection.displayName = 'OutreachMailboxesSection'

export default OutreachMailboxesSection
