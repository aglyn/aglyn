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
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

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
        const idToken = await (
          user as { getIdToken?: () => Promise<string> }
        )?.getIdToken?.()
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

  const [tickets, setTickets] = useState<StaffTicket[]>([])
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>('open')
  const [thread, setThread] = useState<{
    ticket: StaffTicket
    messages: StaffMessage[]
  } | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) return
    const payload = await request('/api/support/tickets', 'GET')
    if (payload?.tickets) setTickets(payload.tickets)
    setLoaded(true)
  }, [user, request])
  useEffect(() => {
    void refresh()
  }, [refresh])

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

  const visible = tickets.filter((ticket) =>
    filter === 'all' ? true : ticket.status === filter,
  )
  const openCount = tickets.filter((ticket) => ticket.status === 'open').length

  return (
    <>
      <DashboardLayout
        breadcrumbItems={[
          { children: 'Support', href: buildRoute(Route.ADMIN_SUPPORT) },
        ]}
        help="supportQueue"
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
                {loaded && visible.length === 0 ? (
                  <Alert severity="success">
                    {filter === 'open'
                      ? 'No open tickets — the queue is clear.'
                      : 'No tickets to show.'}
                  </Alert>
                ) : null}
                {visible.map((ticket) => (
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
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
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
