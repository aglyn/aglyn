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
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
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
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { useOrgSlug } from '../../../../hooks/use-org-scope'
import useOrgNavTabItems from '../../../../hooks/use-org-nav-tabs'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

function formatWhen(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : ''
}

/**
 * Support (AGL-142): ticket threads with staff and the subscriber forum,
 * both server-gated to paid plans via the /api/support routes.
 */
const ManageSupport: NextPageWithLayout<Record<string, never>> = () => {
  const orgNavTabs = useOrgNavTabItems()
  const orgSlug = useOrgSlug()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const request = useCallback(
    async (
      path: string,
      method: string,
      body?: Record<string, unknown>,
    ): Promise<any | null> => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(path, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          enqueueSnackbar(payload?.error ?? 'Request failed', {
            variant: 'warning',
            persist: false,
          })
          return null
        }
        return payload
      } catch {
        enqueueSnackbar('An error has occurred', { variant: 'error' })
        return null
      }
    },
    [user, enqueueSnackbar],
  )

  // --- Tickets ------------------------------------------------------------
  const [tickets, setTickets] = useState<any[]>([])
  const [ticketThread, setTicketThread] = useState<any | null>(null)
  const [newTicket, setNewTicket] = useState<{
    subject: string
    body: string
  } | null>(null)
  const [reply, setReply] = useState('')

  const refreshTickets = useCallback(async () => {
    if (!user) return
    const payload = await request('/api/support/tickets', 'GET')
    if (payload?.tickets) setTickets(payload.tickets)
  }, [user, request])
  useEffect(() => {
    void refreshTickets()
  }, [refreshTickets])

  const openTicket = useCallback(
    (ticketId: string) => async () => {
      const payload = await request(
        `/api/support/tickets?ticketId=${encodeURIComponent(ticketId)}`,
        'GET',
      )
      if (payload?.ticket) setTicketThread(payload)
      setReply('')
    },
    [request],
  )

  // --- Forum --------------------------------------------------------------
  const [forum, setForum] = useState<{
    categories: string[]
    threads: any[]
  } | null>(null)
  const [category, setCategory] = useState('')
  const [forumThread, setForumThread] = useState<any | null>(null)
  const [newThread, setNewThread] = useState<{
    title: string
    body: string
    category: string
  } | null>(null)
  const [forumReply, setForumReply] = useState('')

  const refreshForum = useCallback(async () => {
    if (!user) return
    const payload = await request(
      `/api/support/forum${category ? `?category=${category}` : ''}`,
      'GET',
    )
    if (payload?.threads) setForum(payload)
  }, [user, category, request])
  useEffect(() => {
    void refreshForum()
  }, [refreshForum])

  const openThread = useCallback(
    (threadId: string) => async () => {
      const payload = await request(
        `/api/support/forum?threadId=${encodeURIComponent(threadId)}`,
        'GET',
      )
      if (payload?.thread) setForumThread(payload)
      setForumReply('')
    },
    [request],
  )

  return (
    <>
      <NextPageTitle screen={'Support'} />
      <DashboardLayout
        navTabItems={orgNavTabs}
        activeTab={buildRoute(Route.MANAGE_SUPPORT, { orgSlug })}
        breadcrumbItems={[
          { children: 'Support', href: buildRoute(Route.MANAGE_SUPPORT, { orgSlug }) },
        ]}
        header={{
          children: 'Support',
          icon: { path: mdiLifebuoy.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12, md: 6 },
                children: (
                  <CardDisplay
                    header={'Support tickets'}
                    help={docsHelp('billing', {
                      anchor: '#tiers--entitlements',
                      excerpt:
                        'Private ticket threads with the Aglyn team — ' +
                        'included with every paid plan.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Stack spacing={1}>
                      <Typography variant="body2" color="text.secondary">
                        {'Direct line to the Aglyn team — included with ' +
                          'every paid plan.'}
                      </Typography>
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
                            color={
                              ticket.status === 'open' ? 'warning' : 'default'
                            }
                          />
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ flex: 1, minWidth: 0 }}
                          >
                            {ticket.subject}
                          </Typography>
                          <Button size="small" onClick={openTicket(ticket.$id)}>
                            {'Open'}
                          </Button>
                        </Stack>
                      ))}
                      <Button
                        size="small"
                        color="secondary"
                        sx={{ alignSelf: 'flex-start' }}
                        onClick={() => setNewTicket({ subject: '', body: '' })}
                      >
                        {'New ticket'}
                      </Button>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 6 },
                children: (
                  <CardDisplay
                    header={'Community forum'}
                    help={docsHelp('billing', {
                      anchor: '#tiers--entitlements',
                      excerpt:
                        'The subscriber forum — ask questions and share ' +
                        'tips with other Aglyn builders on paid plans.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Stack spacing={1}>
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ flexWrap: 'wrap', rowGap: 1 }}
                      >
                        {(forum?.categories ?? []).map((value) => (
                          <Chip
                            key={value}
                            size="small"
                            label={value}
                            color={
                              category === value ? 'secondary' : 'default'
                            }
                            variant={
                              category === value ? 'filled' : 'outlined'
                            }
                            onClick={() =>
                              setCategory((prev) =>
                                prev === value ? '' : value,
                              )
                            }
                          />
                        ))}
                      </Stack>
                      {(forum?.threads ?? []).map((thread) => (
                        <Stack
                          key={thread.$id}
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center' }}
                        >
                          <Stack sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" noWrap>
                              {thread.title}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              noWrap
                            >
                              {`${thread.category} · ${thread.authorName}` +
                                ` · ${thread.replyCount ?? 0} repl` +
                                `${(thread.replyCount ?? 0) === 1 ? 'y' : 'ies'}`}
                            </Typography>
                          </Stack>
                          <Button
                            size="small"
                            onClick={openThread(thread.$id)}
                          >
                            {'Read'}
                          </Button>
                        </Stack>
                      ))}
                      <Button
                        size="small"
                        color="secondary"
                        sx={{ alignSelf: 'flex-start' }}
                        onClick={() =>
                          setNewThread({
                            title: '',
                            body: '',
                            category: category || 'General',
                          })
                        }
                      >
                        {'Start a thread'}
                      </Button>
                    </Stack>
                  </CardDisplay>
                ),
              },
            ]}
          />
        </Container>
      </DashboardLayout>

      {/* New ticket */}
      <Dialog
        open={Boolean(newTicket)}
        onClose={() => setNewTicket(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'New support ticket'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Subject"
            value={newTicket?.subject ?? ''}
            onChange={(event) =>
              setNewTicket((prev) =>
                prev ? { ...prev, subject: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="What's going on?"
            value={newTicket?.body ?? ''}
            onChange={(event) =>
              setNewTicket((prev) =>
                prev ? { ...prev, body: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={4}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewTicket(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!newTicket?.subject.trim() || !newTicket?.body.trim()}
            onClick={async () => {
              const payload = await request('/api/support/tickets', 'POST', {
                subject: newTicket?.subject,
                body: newTicket?.body,
              })
              if (!payload) return
              setNewTicket(null)
              enqueueSnackbar('Ticket opened — we reply by email and here', {
                variant: 'success',
                persist: false,
              })
              void refreshTickets()
            }}
          >
            {'Open ticket'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Ticket thread */}
      <Dialog
        open={Boolean(ticketThread)}
        onClose={() => setTicketThread(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{ticketThread?.ticket?.subject}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          {(ticketThread?.messages ?? []).map((message: any) => (
            <Stack key={message.$id} spacing={0.25}>
              <Typography variant="caption" color="text.secondary">
                {(message.staff ? 'Aglyn staff' : 'You') +
                  ` · ${formatWhen(message.createdAt)}`}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {message.body}
              </Typography>
            </Stack>
          ))}
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
          <Button onClick={() => setTicketThread(null)}>{'Close'}</Button>
          <Button
            disabled={!reply.trim()}
            onClick={async () => {
              const payload = await request('/api/support/tickets', 'PATCH', {
                ticketId: ticketThread?.ticket?.$id,
                body: reply,
              })
              if (!payload) return
              setReply('')
              void openTicket(ticketThread?.ticket?.$id)()
              void refreshTickets()
            }}
          >
            {'Send reply'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* New forum thread */}
      <Dialog
        open={Boolean(newThread)}
        onClose={() => setNewThread(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Start a thread'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Title"
            value={newThread?.title ?? ''}
            onChange={(event) =>
              setNewThread((prev) =>
                prev ? { ...prev, title: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ flexWrap: 'wrap', rowGap: 1 }}
          >
            {(forum?.categories ?? []).map((value) => (
              <Chip
                key={value}
                size="small"
                label={value}
                color={
                  newThread?.category === value ? 'secondary' : 'default'
                }
                variant={
                  newThread?.category === value ? 'filled' : 'outlined'
                }
                onClick={() =>
                  setNewThread((prev) =>
                    prev ? { ...prev, category: value } : prev,
                  )
                }
              />
            ))}
          </Stack>
          <TextField
            label="Post"
            value={newThread?.body ?? ''}
            onChange={(event) =>
              setNewThread((prev) =>
                prev ? { ...prev, body: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={4}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewThread(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!newThread?.title.trim() || !newThread?.body.trim()}
            onClick={async () => {
              const payload = await request('/api/support/forum', 'POST', {
                title: newThread?.title,
                body: newThread?.body,
                category: newThread?.category,
              })
              if (!payload) return
              setNewThread(null)
              void refreshForum()
            }}
          >
            {'Post thread'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Forum thread */}
      <Dialog
        open={Boolean(forumThread)}
        onClose={() => setForumThread(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{forumThread?.thread?.title}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <Stack spacing={0.25}>
            <Typography variant="caption" color="text.secondary">
              {forumThread?.thread?.authorName}
              {forumThread?.thread?.staff ? ' · Aglyn staff' : ''}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {forumThread?.thread?.body}
            </Typography>
          </Stack>
          {(forumThread?.replies ?? []).map((item: any) => (
            <Stack key={item.$id} spacing={0.25}>
              <Typography variant="caption" color="text.secondary">
                {item.authorName +
                  (item.staff ? ' · Aglyn staff' : '') +
                  ` · ${formatWhen(item.createdAt)}`}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {item.body}
              </Typography>
            </Stack>
          ))}
          <TextField
            label="Reply"
            value={forumReply}
            onChange={(event) => setForumReply(event.target.value)}
            size="small"
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForumThread(null)}>{'Close'}</Button>
          <Button
            disabled={!forumReply.trim()}
            onClick={async () => {
              const payload = await request('/api/support/forum', 'PATCH', {
                threadId: forumThread?.thread?.$id,
                body: forumReply,
              })
              if (!payload) return
              setForumReply('')
              void openThread(forumThread?.thread?.$id)()
              void refreshForum()
            }}
          >
            {'Reply'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
ManageSupport.displayName = 'Page:ManageSupport'

export default ManageSupport
