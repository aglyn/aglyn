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
  Alert,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffListPaginationControls from '../../../../components/staff-list-pagination.component'
import StaffOnly from '../../../../components/staff-only.component'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { docsHelp } from '../../../../constants/docs-links'
import { useStaffListQuery } from '../../../../hooks/use-staff-list-query'
import {
  SUPPORT_TICKET_FILTER_FIELDS,
  SUPPORT_TICKET_FILTER_HEADERS,
  SUPPORT_TICKET_FILTER_OPTIONS,
} from '../../../../utils/support-ticket-list-query'

interface StaffTicket {
  $id: string
  orgId: string | null
  subject: string
  status: 'open' | 'closed'
  createdAt: number | null
  updatedAt: number | null
}

interface StaffMessage {
  $id: string
  authorEmail: string | null
  staff: boolean
  body: string
  createdAt: number | null
}

type StatusFilter = 'open' | 'closed' | 'all'

/** The status chip as the clause the route puts on its query; `all` is none. */
const statusClauses = (filter: StatusFilter): ListFilterClause[] =>
  filter === 'all' ? [] : [{ field: 'status', op: 'equals', value: filter, label: filter }]

/** The staff queue is the tickets route's `view=queue` list. */
const QUEUE_PARAMS: Readonly<Record<string, string>> = { view: 'queue' }
const NO_WORDS: readonly string[] = []

function formatWhen(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : ''
}

/**
 * Staff support queue (AGL-849): the operator side of the subscriber
 * `MANAGE_SUPPORT_TICKETS` page (its own surface since AGL-1158; it used to
 * be half of `MANAGE_SUPPORT`). `/api/support/tickets` already returns every org's
 * ticket to a `staff` claim and threads a `staff: true` reply — this page is
 * the surface that was missing. Open/close and reply drive the same PATCH the
 * subscriber uses; a reply reopens a closed ticket unless it is also closed.
 *
 * The Open / Closed / All chips are a Status clause the route puts on its
 * Firestore query, and the queue pages by a cursor (AGL-3321): a ticket past
 * the first page is reached by paging, never missed because a window of the
 * newest tickets ended before it. The open count is its own count query.
 */
const AdminSupport: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const request = useCallback(
    async (
      path: string,
      method: string,
      body?: Record<string, unknown>,
    ): Promise<any | null> => {
      try {
        const response = await authorizedFetch(user, path, {
          method,
          headers: { 'Content-Type': 'application/json' },
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

  const [filter, setFilter] = useState<StatusFilter>('open')
  const [openCount, setOpenCount] = useState(0)
  const [thread, setThread] = useState<{
    ticket: StaffTicket
    messages: StaffMessage[]
  } | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const clauses = useMemo(() => statusClauses(filter), [filter])
  const onQueueError = useCallback(
    (error: unknown) =>
      enqueueSnackbar(
        error instanceof Error && error.message
          ? error.message
          : 'Reading the support queue failed',
        { variant: 'warning', persist: false },
      ),
    [enqueueSnackbar],
  )
  const queue = useStaffListQuery<StaffTicket>({
    endpoint: '/api/support/tickets',
    clauses,
    search: NO_WORDS,
    params: QUEUE_PARAMS,
    onError: onQueueError,
  })
  const { refresh: refreshQueue } = queue
  const tickets = queue.rows
  const refusals = useMemo(
    () =>
      listQueryRefusals(queue.refused, {
        fields: SUPPORT_TICKET_FILTER_FIELDS,
        headers: SUPPORT_TICKET_FILTER_HEADERS,
        options: SUPPORT_TICKET_FILTER_OPTIONS,
      }),
    [queue.refused],
  )

  const refresh = useCallback(async () => {
    if (!user) return
    refreshQueue()
    const payload = await request('/api/support/tickets?view=openCount', 'GET')
    if (payload) setOpenCount(Number(payload.open ?? 0))
  }, [user, request, refreshQueue])
  const signedInUid = (user as any)?.uid
  useEffect(() => {
    if (!signedInUid) return
    void request('/api/support/tickets?view=openCount', 'GET').then((payload) => {
      if (payload) setOpenCount(Number(payload.open ?? 0))
    })
    // Keyed on WHO is signed in: `request` changes identity with `useUser`'s
    // object on every render, and the count is re-read after every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInUid])

  const openTicket = useCallback(
    (ticketId: string) => async () => {
      const payload = await request(
        `/api/support/tickets?ticketId=${encodeURIComponent(ticketId)}`,
        'GET',
      )
      if (payload?.ticket) {
        setThread({ ticket: payload.ticket, messages: payload.messages ?? [] })
        setReply('')
      }
    },
    [request],
  )

  // Deep link from a staff notification (AGL-850): open the named ticket once.
  // Read via window.location rather than useSearchParams, whose Suspense
  // requirement has bitten this app before (AGL-594).
  const [deepLinked, setDeepLinked] = useState(false)
  useEffect(() => {
    if (deepLinked || !user) return
    const ticketId = new URLSearchParams(window.location.search).get('ticketId')
    if (!ticketId) return
    setDeepLinked(true)
    void openTicket(ticketId)()
  }, [user, deepLinked, openTicket])

  const patchTicket = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true)
      try {
        const payload = await request('/api/support/tickets', 'PATCH', body)
        if (!payload) return false
        await refresh()
        if (thread) await openTicket(thread.ticket.$id)()
        return true
      } finally {
        setBusy(false)
      }
    },
    [request, refresh, thread, openTicket],
  )

  return (
    <>
      <DashboardLayout
        breadcrumbItems={[
          { children: 'Support', href: buildRoute(Route.ADMIN_SUPPORT) },
        ]}
        help={{ topic: 'supportQueue', anchor: '#support-queue-page' }}
        header={{
          children: 'Support tickets',
          icon: { path: mdiLifebuoy.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <StaffOnly>
            <CardDisplay
              header={
                openCount > 0
                  ? `Support tickets · ${openCount} open`
                  : 'Support tickets'
              }
              help={docsHelp('supportQueue', { anchor: '#triage' })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={0.5}>
                  {(['open', 'closed', 'all'] as StatusFilter[]).map(
                    (value) => (
                      <Chip
                        key={value}
                        size="small"
                        label={value[0].toUpperCase() + value.slice(1)}
                        color={filter === value ? 'primary' : 'default'}
                        variant={filter === value ? 'filled' : 'outlined'}
                        onClick={() => setFilter(value)}
                      />
                    ),
                  )}
                </Stack>
                <ListQueryNotices refused={refusals} notices={queue.notices} />
                {!queue.loading && !queue.failed && tickets.length === 0 ? (
                  <Alert severity="success">
                    {filter === 'open'
                      ? 'No open tickets — the queue is clear.'
                      : 'No tickets to show.'}
                  </Alert>
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
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        {ticket.subject}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        {`${ticket.orgId ?? 'no org'} · updated ${formatWhen(
                          ticket.updatedAt,
                        )}`}
                      </Typography>
                    </Stack>
                    <Button size="small" onClick={openTicket(ticket.$id)}>
                      {'Open'}
                    </Button>
                  </Stack>
                ))}
                <StaffListPaginationControls pagination={queue} />
              </Stack>
            </CardDisplay>
          </StaffOnly>
        </Container>
      </DashboardLayout>

      {/* Ticket thread */}
      <Dialog
        open={Boolean(thread)}
        onClose={() => setThread(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Stack
            useFlexGap
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              {thread?.ticket?.subject}
            </span>
            {thread ? (
              <Chip
                size="small"
                label={thread.ticket.status}
                color={
                  thread.ticket.status === 'open' ? 'warning' : 'default'
                }
              />
            ) : null}
          </Stack>
          {thread?.ticket?.orgId ? (
            <Typography variant="caption" color="text.secondary">
              {`Org: ${thread.ticket.orgId}`}
            </Typography>
          ) : null}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
          {(thread?.messages ?? []).map((message) => (
            <Stack key={message.$id} spacing={0.25}>
              <Typography variant="caption" color="text.secondary">
                {(message.staff
                  ? 'Aglyn staff'
                  : (message.authorEmail ?? 'Customer')) +
                  ` · ${formatWhen(message.createdAt)}`}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {message.body}
              </Typography>
            </Stack>
          ))}
          <TextField
            label="Reply as Aglyn staff"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            size="small"
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          <Button
            color={thread?.ticket?.status === 'open' ? 'inherit' : 'primary'}
            disabled={busy || !thread}
            onClick={() =>
              void patchTicket({
                ticketId: thread?.ticket?.$id,
                status: thread?.ticket?.status === 'open' ? 'closed' : 'open',
              })
            }
          >
            {thread?.ticket?.status === 'open' ? 'Close ticket' : 'Reopen'}
          </Button>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => setThread(null)}>{'Done'}</Button>
            <Button
              variant="contained"
              color="primary"
              disabled={busy || !reply.trim()}
              onClick={async () => {
                const ok = await patchTicket({
                  ticketId: thread?.ticket?.$id,
                  body: reply,
                })
                if (ok) setReply('')
              }}
            >
              {'Send reply'}
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
    </>
  )
}
AdminSupport.displayName = 'Page:AdminSupport'

export default AdminSupport
