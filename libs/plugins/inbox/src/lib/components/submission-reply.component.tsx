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

/**
 * The reply composer, inside the submission reader.
 *
 * ## The one sentence this component exists to say
 *
 * "Replies come back to your email, not here." Nothing in this platform
 * receives mail, so a customer who answers reaches the merchant's own
 * mailbox and their answer never appears in the Inbox. A composer that
 * looked like a mail client without saying so would teach a merchant to wait
 * here for a reply that is already sitting somewhere else — which is a worse
 * outcome than not shipping the button.
 *
 * That is also why the sent replies below are labelled as what was sent
 * rather than as a conversation: this list is one-sided by construction.
 */

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { collection, doc, limit, orderBy, query } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  REPLY_BODY_MAX,
  REPLY_SUBJECT_MAX,
  defaultReplySubject,
  replyRecipient,
} from '../model/reply-policy'

/** How many past replies the panel lists. A submission answered more than a
 * handful of times is a conversation that belongs in a real mailbox. */
const SENT_REPLIES_LIMIT = 10

export interface SubmissionReplyProps {
  hostId: string
  /** The submission being read, with `$id` and `fields`. */
  submission: { $id: string; fields?: Record<string, unknown>; formName?: string }
}

export function SubmissionReply(props: SubmissionReplyProps) {
  const { hostId, submission } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  /*
   * The site's name leads the default subject, and reading it here rather
   * than on the Inbox page is what keeps it off the mount path: this
   * component exists only while a submission is open, so the read is paid
   * when a merchant asks to reply and not once per visit to the page.
   */
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
  )
  const siteName = String(host?.displayName ?? host?.subdomain ?? '')

  const recipient = useMemo(
    () => replyRecipient(submission?.fields),
    [submission?.fields],
  )
  const canReply = 'email' in recipient

  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  // Re-seeded per submission rather than once: the reader dialog keeps this
  // component mounted while the merchant moves between rows, so a subject
  // computed on first mount would carry the previous sender's site into the
  // next reply.
  useEffect(() => {
    setSubject(defaultReplySubject(siteName, submission?.formName))
    setMessage('')
  }, [siteName, submission?.$id, submission?.formName])

  const { data: sentReplies } = useFirestoreCollection<any>(
    () =>
      submission?.$id
        ? query(
            collection(
              firestore,
              'hosts',
              hostId,
              'formSubmissions',
              submission.$id,
              'replies',
            ),
            orderBy('sentAtMs', 'desc'),
            limit(SENT_REPLIES_LIMIT),
          )
        : null,
    [firestore, hostId, submission?.$id],
    { idField: '$id' },
  )

  const handleSend = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/inbox/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          submissionId: submission.$id,
          subject: subject.trim(),
          message: message.trim(),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'The reply was not sent', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
      setMessage('')
      enqueueSnackbar(`Reply sent to ${payload?.to ?? 'the sender'}`, {
        variant: 'success',
        persist: false,
      })
    } catch {
      enqueueSnackbar('The reply was not sent', {
        variant: 'warning',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, user, hostId, submission?.$id, subject, message, enqueueSnackbar])

  if (!canReply) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        {'This submission has no email field, so there is nobody to reply to.'}
      </Alert>
    )
  }

  return (
    <CardDisplay title="Reply" sx={{ mt: 2 }}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {`To ${(recipient as { email: string }).email}`}
        </Typography>
        <TextField
          label="Subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value.slice(0, REPLY_SUBJECT_MAX))}
          fullWidth
          size="small"
        />
        <TextField
          label="Message"
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, REPLY_BODY_MAX))}
          fullWidth
          multiline
          minRows={4}
          placeholder="Write your reply. The original message is quoted underneath it."
        />
        {/*
          The boundary, stated where the decision is made rather than in a
          docs page nobody opens mid-task. Both halves matter: the address the
          message LEAVES from is the platform's, because per-org sending
          domains do not exist yet, and the address an answer COMES BACK to is
          the merchant's own, which is the only reason the first half is
          tolerable.
         */}
        <Alert severity="info">
          {`Sent from your site's name at this platform's address, with replies ` +
            `directed to ${user?.email ?? 'your account email'}. Answers arrive ` +
            'in your email, not in this Inbox.'}
        </Alert>
        <Box>
          <Button
            variant="contained"
            disabled={busy || !subject.trim() || !message.trim()}
            onClick={handleSend}
          >
            {busy ? 'Sending…' : 'Send reply'}
          </Button>
        </Box>
        {sentReplies?.length ? (
          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary">
              {'Replies sent'}
            </Typography>
            {sentReplies.map((reply: any) => (
              <Stack key={reply.$id} spacing={0.25}>
                <Typography variant="caption" color="text.secondary">
                  {`${new Date(reply.sentAtMs).toLocaleString()} · to ${reply.to}`}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {reply.message}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
SubmissionReply.displayName = 'SubmissionReply'

export default SubmissionReply
