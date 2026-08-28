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

import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import type { StaffEmailDeliveryRow } from './staff-user-email-history-card.component'

/** The message body, as `/api/admin/emails/message` returns it. */
interface StaffEmailMessage {
  provider: string
  providerMessageId: string
  to: string[]
  cc: string[]
  bcc: string[]
  from: string | null
  replyTo: string[] | null
  subject: string | null
  html: string | null
  text: string | null
  sentAt: number | null
  status: string | null
}

const STATUS_ORDER = [
  'sent',
  'delivered',
  'delayed',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'failed',
] as const

const STATUS_LABELS: Record<string, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  delayed: 'Delayed',
  opened: 'Opened',
  clicked: 'Clicked',
  bounced: 'Bounced',
  complained: 'Spam complaint',
  failed: 'Failed',
}

function formatWhen(ms: number | null | undefined): string {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return '—'
  }
}

/** A label/value line, so every fact in the header reads the same way. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline' }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: 96, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Stack>
  )
}

export interface StaffEmailMessageDialogProps {
  /** The log row that was clicked, or null when nothing is open. */
  row: StaffEmailDeliveryRow | null
  onClose: () => void
}

/**
 * ONE MESSAGE, OPENED.
 *
 * The table answers "what did we send and what happened to it". This answers
 * the follow-up a staffer always has next — *what did it actually say, and
 * which link did they follow* — which otherwise still meant signing into the
 * sending provider, which is the whole thing this feature exists to stop.
 *
 * ## Two sources, and the split is not arbitrary
 *
 *  - **The row** (already loaded) carries the timeline, the counts and the
 *    clicked links. Those come from live delivery events; the provider's own
 *    single-message endpoint does not return them at all.
 *  - **The body** is fetched when this opens. The log deliberately does not
 *    keep message bodies — that would be an unbounded copy of every email we
 *    have ever sent, reset links included, duplicating what the provider
 *    already holds.
 *
 * ## The preview is a sandboxed frame, not `dangerouslySetInnerHTML`
 *
 * This renders mail as it was sent, and a template is authorable by staff and
 * carries merge values that came from a customer. Injected into the console's
 * own document it would run with the operator's session — the worst place in
 * the product to render untrusted markup.
 *
 * `srcDoc` with an EMPTY `sandbox` gives the frame a unique opaque origin and
 * withholds every capability at once: no scripts, no forms, no same-origin
 * access, no top-level navigation. That is stronger than sanitising, because
 * it does not depend on the sanitiser's list being complete — and it costs
 * nothing here, since an email body is static markup by construction. Links
 * inside it are inert, which is correct: a staffer must not be able to burn a
 * customer's single-use reset link by clicking it out of curiosity.
 */
export function StaffEmailMessageDialog({
  row,
  onClose,
}: StaffEmailMessageDialogProps) {
  const { data: user } = useUser()
  const [message, setMessage] = useState<StaffEmailMessage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'html' | 'text'>('html')

  const messageId = row?.messageId ?? null

  /*
   * THE USER IS READ THROUGH A REF, NOT DEPENDED ON.
   *
   * `useUser()` is not contractually stable, and a hook that returns a fresh
   * object each render makes `[messageId, user]` a dependency that changes
   * every time — so the effect re-runs, its cleanup sets `active = false`, the
   * in-flight response is discarded as stale, and `setLoading(false)` is
   * skipped along with it. The dialog then spins on "Loading the message"
   * forever while re-fetching in a loop.
   *
   * A ref for the value and a BOOLEAN for the condition: the effect re-runs
   * when a message is opened or when the user first becomes available, and at
   * no other time.
   */
  const userRef = useRef(user)
  userRef.current = user
  const signedIn = Boolean(user)

  useEffect(() => {
    if (!messageId || !signedIn) return
    let active = true
    setLoading(true)
    setError(null)
    setMessage(null)
    void (async () => {
      try {
        const idToken = await (userRef.current as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/emails/message?id=${encodeURIComponent(messageId)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const payload = await response.json().catch(() => ({}))
        if (!active) return
        if (!response.ok) {
          // The endpoint's own message. "Set RESEND_READ_API_KEY" and "the
          // provider no longer holds this message" are different problems
          // with different remedies, and a generic failure hides which.
          setError(payload?.error ?? 'Could not load the message')
          return
        }
        setMessage(payload as StaffEmailMessage)
        /*
         * An EMPTY html part still opens on the HTML tab, because the notice
         * shown there — "this went out as plain text only, so no click could
         * be recorded" — is the most useful sentence in this dialog and the
         * finding this whole feature came from. Falling through to the text
         * tab hid it behind a tab nobody would click.
         *
         * `null` is different: the body could not be read at all, and there
         * is nothing to explain, so the text part (if any) is the better
         * landing.
         */
        setTab((payload as StaffEmailMessage)?.html === null ? 'text' : 'html')
      } catch {
        if (active) setError('Could not load the message')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [messageId, signedIn])

  const close = useCallback(() => {
    setMessage(null)
    setError(null)
    onClose()
  }, [onClose])

  if (!row) return null

  const timeline = STATUS_ORDER.filter((state) => row.timestamps?.[state])

  return (
    <Dialog open onClose={close} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle sx={{ pb: 1 }}>
        <Stack spacing={0.5}>
          <Typography variant="h6" component="div">
            {row.subject || 'No subject recorded'}
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            useFlexGap
          >
            <Chip
              size="small"
              label={STATUS_LABELS[row.status] ?? row.status}
              color={
                ['bounced', 'complained', 'failed'].includes(row.status)
                  ? 'error'
                  : row.status === 'delayed'
                    ? 'warning'
                    : 'success'
              }
            />
            {row.context ? (
              <Chip size="small" variant="outlined" label={row.context} />
            ) : null}
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Fact label="To" value={row.to} />
            <Fact label="From" value={message?.from} />
            <Fact
              label="Reply-to"
              value={message?.replyTo?.join(', ') ?? null}
            />
            <Fact label="Cc" value={message?.cc?.join(', ') || null} />
            <Fact label="Bcc" value={message?.bcc?.join(', ') || null} />
            <Fact label="Message id" value={row.messageId} />
            <Fact label="Provider" value={row.provider} />
            {row.hostId ? <Fact label="Site" value={row.hostId} /> : null}
            {row.campaignId ? (
              <Fact label="Campaign" value={row.campaignId} />
            ) : null}
            {row.bounceType ? (
              <Fact label="Bounce" value={row.bounceType} />
            ) : null}
            {row.detail ? <Fact label="Detail" value={row.detail} /> : null}
          </Stack>

          <Divider />

          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary">
              {'Timeline'}
            </Typography>
            {timeline.length ? (
              timeline.map((state) => (
                <Fact
                  key={state}
                  label={STATUS_LABELS[state]}
                  value={formatWhen(row.timestamps[state])}
                />
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">
                {'Only the send is recorded — this message was imported from ' +
                  'the provider’s history rather than seen live, so it carries ' +
                  'no per-state timestamps.'}
              </Typography>
            )}
            <Fact label="Opens" value={String(row.openCount)} />
            <Fact label="Clicks" value={String(row.clickCount)} />
          </Stack>

          {row.clickedLinks.length ? (
            <>
              <Divider />
              <Stack spacing={1}>
                <Typography variant="overline" color="text.secondary">
                  {'Links followed'}
                </Typography>
                {/*
                 * Real destinations the recipient reached, recorded from
                 * click events. Rendered as text and not as anchors: this is
                 * a customer's mail, and a staff screen must not offer a
                 * one-click way to follow a link that may be single-use.
                 */}
                {row.clickedLinks.map((link) => (
                  <Typography
                    key={link}
                    variant="body2"
                    sx={{ wordBreak: 'break-all', fontFamily: 'monospace' }}
                  >
                    {link}
                  </Typography>
                ))}
              </Stack>
            </>
          ) : null}

          <Divider />

          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary">
              {'Message'}
            </Typography>
            {loading ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  {'Loading the message from the provider…'}
                </Typography>
              </Stack>
            ) : error ? (
              <Alert severity="warning">{error}</Alert>
            ) : message ? (
              <>
                <Tabs
                  value={tab}
                  onChange={(_event, next) => setTab(next)}
                  sx={{ minHeight: 0 }}
                >
                  <Tab value="html" label="HTML" disabled={!message.html} />
                  <Tab value="text" label="Plain text" disabled={!message.text} />
                </Tabs>
                {tab === 'html' ? (
                  message.html ? (
                    <Box
                      component="iframe"
                      title="Message preview"
                      // Empty sandbox: opaque origin, no scripts, no forms,
                      // no navigation. See this component's docblock.
                      sandbox=""
                      srcDoc={message.html}
                      sx={{
                        width: '100%',
                        height: 420,
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        backgroundColor: '#ffffff',
                      }}
                    />
                  ) : (
                    <Alert severity="info">
                      {'This message went out as plain text only — it has no ' +
                        'HTML part, so its links were not clickable in the ' +
                        'inbox and no click could be recorded.'}
                    </Alert>
                  )
                ) : (
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 2,
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                      maxHeight: 420,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      typography: 'body2',
                      fontFamily: 'monospace',
                    }}
                  >
                    {message.text || 'No plain-text part.'}
                  </Box>
                )}
              </>
            ) : null}
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export default StaffEmailMessageDialog
