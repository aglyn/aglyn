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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { OUTREACH_MANUAL_REPLY_BODY_MAX } from '../engine/manual-reply'
import type { OutreachEnrollmentReplyResponse, OutreachEnrollmentThreadResponse } from '../model/outreach-api'
import type { OutreachEnrollment } from '../model/outreach.types'
import { formatOutreachTime, OutreachLoading } from './outreach-ui'
import type { OutreachApi } from './use-outreach-api'

/**
 * ANSWER A PERSON WHO WROTE BACK (AGL-4020): a replied enrollment's
 * "Reply in thread", on the Enrollments tab, the person's page, and the CRM
 * record of the person.
 *
 * The dialog reads the thread the moment it opens — what the person wrote,
 * kept on the enrollment or read from the mailbox when it was synced before
 * replies were kept — and says where the answer goes: from the enrollment's
 * own mailbox, to the person, `Re:` their subject. The member writes plain
 * text; Send puts it in the same thread in both mailboxes, with their message
 * quoted beneath — and, on a sequence that tracks clicks, the links they
 * wrote as the same short links a step's carry (AGL-4022). Whatever still refuses — the do-not-contact list, a paused
 * or disconnected mailbox — is said before anything is typed, and Send waits.
 *
 * The answer's key is minted once per open: sending again after a lost
 * answer from the server is the same answer, which the route recognises
 * rather than sending twice.
 */

export interface OutreachReplyDialogProps {
  /** The enrollment to answer, or `null` while closed. */
  enrollment: OutreachEnrollment | null
  api: Pick<OutreachApi, 'readEnrollmentThread' | 'replyToEnrollment'>
  /** The mailbox's zone, for the times shown. */
  timeZone?: string | null
  onClose(): void
  /** After the answer went. */
  onSent?(answer: OutreachEnrollmentReplyResponse): void
}

type Stage =
  | { kind: 'reading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; thread: OutreachEnrollmentThreadResponse }

/** One message of the conversation as the dialog shows it. */
interface ThreadLine {
  key: string
  atMs: number
  who: string
  subject: string
  body: string
  /** Theirs, or ours. */
  inbound: boolean
}

/**
 * The conversation, oldest first: what the person wrote, every answer a
 * member sent, and the sequence's own emails by their subject.
 */
export function outreachReplyThreadLines(
  enrollment: Pick<OutreachEnrollment, 'inboundMessages' | 'stepRecords'>,
): ThreadLine[] {
  const lines: ThreadLine[] = []
  for (const message of enrollment.inboundMessages ?? []) {
    lines.push({
      key: `in-${message.id}`,
      atMs: message.atMs,
      who: message.fromName ? `${message.fromName} <${message.from}>` : message.from,
      subject: message.subject,
      body: message.body,
      inbound: true,
    })
  }
  ;(enrollment.stepRecords ?? []).forEach((record, index) => {
    if (record?.kind === 'manual_reply') {
      lines.push({
        key: `answer-${index}`,
        atMs: record.atMs,
        who: record.from ? `You, from ${record.from}` : 'You',
        subject: record.subject ?? '',
        body: record.body ?? '',
        inbound: false,
      })
    } else if (record?.kind === 'email') {
      lines.push({
        key: `step-${index}`,
        atMs: record.atMs,
        who: 'Sequence email',
        subject: record.subject ?? '',
        body: '',
        inbound: false,
      })
    }
  })
  return lines.sort((a, b) => a.atMs - b.atMs)
}

/** A fresh key for one answer. */
function newReplyKey(): string {
  const crypto = globalThis.crypto as Crypto | undefined
  if (crypto?.randomUUID) return crypto.randomUUID()
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

export function OutreachReplyDialog(props: OutreachReplyDialogProps) {
  const { enrollment, api, timeZone } = props
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const { enqueueSnackbar } = useSnackbar()
  const [stage, setStage] = useState<Stage>({ kind: 'reading' })
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const enrollmentId = enrollment?.id ?? null
  // One key per opening: a resend after a lost answer is the same answer.
  const replyKey = useMemo(() => (enrollmentId ? newReplyKey() : ''), [enrollmentId])

  useEffect(() => {
    if (!enrollmentId) return undefined
    let cancelled = false
    setStage({ kind: 'reading' })
    setText('')
    setProblem(null)
    api.readEnrollmentThread(enrollmentId).then(
      (thread) => {
        if (!cancelled) setStage({ kind: 'ready', thread })
      },
      (error: unknown) => {
        if (!cancelled) setStage({ kind: 'failed', message: (error as Error).message })
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, enrollmentId])

  const thread = stage.kind === 'ready' ? stage.thread : null
  const draft = thread?.draft ?? null
  const lines = thread ? outreachReplyThreadLines(thread.enrollment) : []
  const name = enrollment?.contactName || enrollment?.email || ''
  const title = name ? `Reply to ${name}` : 'Reply in thread'
  const canSend = Boolean(draft) && !thread?.refusal && Boolean(text.trim()) && !sending

  const send = async () => {
    if (!enrollmentId || !draft || !canSend) return
    setSending(true)
    setProblem(null)
    try {
      const answer = await api.replyToEnrollment({ enrollmentId, body: text, answerId: draft.answerId, replyKey })
      enqueueSnackbar(
        answer.alreadySent ? `That answer had already gone to ${answer.sentTo}.` : `Answer sent to ${answer.sentTo}.`,
        { variant: 'success' },
      )
      props.onSent?.(answer)
      props.onClose()
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog
      open={Boolean(enrollment)}
      onClose={sending ? undefined : props.onClose}
      fullWidth
      maxWidth="md"
      fullScreen={narrow}
      aria-label={title}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {stage.kind === 'reading' ? <OutreachLoading label="Reading their reply…" /> : null}
          {stage.kind === 'failed' ? <Alert severity="warning">{stage.message}</Alert> : null}
          {thread && !draft ? (
            <Alert severity="info">
              Nothing they wrote could be read from the mailbox, so there is nothing to answer here yet. Their
              reply is in the mailbox that sent the sequence.
            </Alert>
          ) : null}
          {draft ? (
            <Box
              component="dl"
              sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5 }}
            >
              <Typography component="dt" variant="body2" color="text.secondary">
                From
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, wordBreak: 'break-word' }}>
                {draft.from.name ? `${draft.from.name} <${draft.from.address}>` : draft.from.address}
              </Typography>
              <Typography component="dt" variant="body2" color="text.secondary">
                To
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, wordBreak: 'break-word' }}>
                {draft.to}
              </Typography>
              <Typography component="dt" variant="body2" color="text.secondary">
                Subject
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, wordBreak: 'break-word' }}>
                {draft.subject}
              </Typography>
            </Box>
          ) : null}
          {lines.length ? (
            <Stack
              spacing={1.5}
              role="list"
              aria-label="The conversation"
              sx={{ maxHeight: 320, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
            >
              {lines.map((line) => (
                <Box
                  key={line.key}
                  role="listitem"
                  data-inbound={line.inbound}
                  sx={{ pl: 1.5, borderLeft: 2, borderColor: line.inbound ? 'info.main' : 'divider' }}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={{ xs: 0, sm: 1 }}
                    sx={{ justifyContent: 'space-between', alignItems: { sm: 'baseline' } }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-word' }}>
                      {line.who}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                      {formatOutreachTime(line.atMs, timeZone)}
                    </Typography>
                  </Stack>
                  {line.subject ? (
                    <Typography variant="caption" color="text.secondary" component="div">
                      {`Subject: ${line.subject}`}
                    </Typography>
                  ) : null}
                  {line.body ? (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.5 }}>
                      {line.body}
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Stack>
          ) : null}
          {thread?.refusal ? <Alert severity="warning">{thread.refusal.message}</Alert> : null}
          {draft && !thread?.refusal ? (
            <>
              <TextField
                label="Your answer"
                value={text}
                onChange={(event) => setText(event.target.value)}
                multiline
                minRows={6}
                fullWidth
                autoFocus
                disabled={sending}
                slotProps={{ htmlInput: { maxLength: OUTREACH_MANUAL_REPLY_BODY_MAX } }}
              />
              <DialogContentText variant="body2">
                {`Sent as plain text from ${draft.from.address}, in the same thread, with their message quoted beneath.${
                  draft.tracksLinks ? ' Links you write go out as tracked short links, as in the sequence’s emails.' : ''
                } The sequence stays where it is.`}
              </DialogContentText>
            </>
          ) : null}
          {problem ? <Alert severity="error">{problem}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={sending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void send()} disabled={!canSend}>
          {sending ? 'Sending…' : 'Send answer'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
OutreachReplyDialog.displayName = 'OutreachReplyDialog'

export default OutreachReplyDialog
