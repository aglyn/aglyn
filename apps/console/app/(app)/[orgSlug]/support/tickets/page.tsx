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

import { mdiLifebuoy } from '@aglyn/shared-data-mdi'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import SupportChannelLink from '../../../../../components/support/support-channel-link.component'
import SupportMessages from '../../../../../components/support/support-messages.component'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import { docsHelp } from '../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { useOrgSlug } from '../../../../../hooks/use-org-scope'
import useSupportApi from '../../../../../hooks/use-support-api'

/**
 * Support tickets (AGL-142, split out by AGL-1158).
 *
 * Private threads between this organization and Aglyn staff. Server-gated by
 * the SUPPORT LADDER rather than a plan check (AGL-1103): a tier with no
 * first-response window has no ticket channel by definition, so Free and
 * Starter reach this page and are told where tickets start rather than being
 * offered a button the route will refuse.
 *
 * It shares its transport and org scoping with the forum (`useSupportApi`) and
 * nothing else. That is the point of the split: AGL-1157 put a body on a GET
 * in the one loader both surfaces used, and took out both at once.
 */
const SupportTickets: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { enqueueSnackbar } = useSnackbar()
  const { request, canLoad, ready, commitment, responseWindow, canOpenTickets } =
    useSupportApi()

  const [tickets, setTickets] = useState<any[]>([])
  const [thread, setThread] = useState<any | null>(null)
  const [composing, setComposing] = useState<{
    subject: string
    body: string
  } | null>(null)
  const [reply, setReply] = useState('')

  // Waits for the ORG, not just the user (AGL-1154). See `useSupportApi`:
  // asking before the scope resolves sends the request to the caller's first
  // org, which is the bug AGL-1147 fixed reappearing on every cold load.
  const refresh = useCallback(async () => {
    if (!canLoad) return
    const payload = await request('/api/support/tickets', 'GET')
    if (payload?.tickets) setTickets(payload.tickets)
  }, [canLoad, request])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const open = useCallback(
    (ticketId: string) => async () => {
      const payload = await request(
        `/api/support/tickets?ticketId=${encodeURIComponent(ticketId)}`,
        'GET',
      )
      if (payload?.ticket) setThread(payload)
      setReply('')
    },
    [request],
  )

  return (
    <>
      <DashboardLayout
        breadcrumbItems={[
          {
            children: 'Support',
            href: buildRoute(Route.MANAGE_SUPPORT, { orgSlug }),
          },
          {
            children: 'Tickets',
            href: buildRoute(Route.MANAGE_SUPPORT_TICKETS, { orgSlug }),
          },
        ]}
        header={{
          children: 'Support tickets',
          icon: { path: mdiLifebuoy.path },
        }}
        // Support is still ONE section (AGL-1158) — the nav tab lands on
        // whichever channel the tier makes primary, so this is the only way
        // to the other one.
        headerRight={<SupportChannelLink to="forum" orgSlug={orgSlug} />}
        help="supportAndCommunity"
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay
            header={'Your tickets'}
            help={docsHelp('supportAndCommunity', {
              anchor: '#support-tickets',
              excerpt:
                'Private ticket threads with the Aglyn team — from Pro upward.',
            })}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {'Direct line to the Aglyn team.'}
              </Typography>

              {/*
                What THIS org is owed (AGL-1103). Held back until `ready`:
                `org` is undefined both while the read is in flight and when
                there is no org doc, so rendering before then quotes the Free
                tier's "no commitment" to a paying customer.
              */}
              {ready && responseWindow ? (
                <Typography variant="body2">
                  <strong>{`${commitment.label} support`}</strong>
                  {` — first response within ${responseWindow}.`}
                  {commitment.namedManager
                    ? ' Your success manager is copied on every ticket.'
                    : ''}
                </Typography>
              ) : null}

              {/*
                A forum-only tier now gets a whole page saying so, rather than
                a line inside a card it shares with the forum. The route's 403
                is correct and the UI still has to anticipate it — a perfect
                error nobody renders is how AGL-1093 went wrong.
              */}
              {ready && !canOpenTickets ? (
                <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                  <Typography variant="body2">
                    {'Ticket support starts on Pro. Your plan’s support ' +
                      'channel is the community forum, which is open to every ' +
                      'plan — ask there and the Aglyn team reads it too.'}
                  </Typography>
                  <SupportChannelLink to="forum" orgSlug={orgSlug} />
                </Stack>
              ) : null}

              {ready && canOpenTickets && tickets.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {'No tickets yet.'}
                </Typography>
              ) : null}

              {tickets.map((ticket) => (
                <Stack
                  key={ticket.$id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Chip
                    size="small"
                    label={ticket.status}
                    color={ticket.status === 'open' ? 'warning' : 'default'}
                  />
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ flex: 1, minWidth: 0 }}
                  >
                    {ticket.subject}
                  </Typography>
                  <Button size="small" onClick={open(ticket.$id)}>
                    {'Open'}
                  </Button>
                </Stack>
              ))}

              {/*
                Hidden until the org is KNOWN to have a ticket channel — not
                merely until `ready` — so the button never flashes for a tier
                that cannot use it.
              */}
              {ready && canOpenTickets ? (
                <Button
                  size="small"
                  color="primary"
                  sx={{ alignSelf: 'flex-start' }}
                  onClick={() => setComposing({ subject: '', body: '' })}
                >
                  {'New ticket'}
                </Button>
              ) : null}
            </Stack>
          </CardDisplay>
        </Container>
      </DashboardLayout>

      {/* New ticket */}
      <Dialog
        open={Boolean(composing)}
        onClose={() => setComposing(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'New support ticket'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Subject"
            value={composing?.subject ?? ''}
            onChange={(event) =>
              setComposing((prev) =>
                prev ? { ...prev, subject: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="What's going on?"
            value={composing?.body ?? ''}
            onChange={(event) =>
              setComposing((prev) =>
                prev ? { ...prev, body: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={4}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setComposing(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!composing?.subject.trim() || !composing?.body.trim()}
            onClick={async () => {
              const payload = await request('/api/support/tickets', 'POST', {
                subject: composing?.subject,
                body: composing?.body,
              })
              if (!payload) return
              setComposing(null)
              enqueueSnackbar('Ticket opened — we reply by email and here', {
                variant: 'success',
                persist: false,
              })
              void refresh()
            }}
          >
            {'Open ticket'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Ticket thread */}
      <Dialog
        open={Boolean(thread)}
        onClose={() => setThread(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{thread?.ticket?.subject}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          {/*
            A ticket is a two-party conversation, so naming yourself on your
            own message is noise — `anonymizeSelf` is the one real difference
            between this thread and a forum thread.
          */}
          <SupportMessages posts={thread?.messages ?? []} anonymizeSelf />
          <TextField
            label="Reply"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            size="small"
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setThread(null)}>{'Close'}</Button>
          <Button
            disabled={!reply.trim()}
            onClick={async () => {
              const payload = await request('/api/support/tickets', 'PATCH', {
                ticketId: thread?.ticket?.$id,
                body: reply,
              })
              if (!payload) return
              setReply('')
              void open(thread?.ticket?.$id)()
              void refresh()
            }}
          >
            {'Send reply'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
SupportTickets.displayName = 'Page:SupportTickets'

export default SupportTickets
