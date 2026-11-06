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

import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/*==========================================
 * THE REPLY COMPOSER, one for every place a business answers a customer by
 * email (AGL-4207): the Inbox's reply to a submission and a quote's reply to
 * its customer. Moved here from the Inbox so the two read and behave the
 * same; each caller keeps its own data, route and permission check, and this
 * draws only the form and the messages.
 *
 * It says where answers go (`note`), because nothing in the platform receives
 * mail: a composer that looked like a mail client without saying so would
 * teach a business to wait here for an answer that is in its own mailbox.
 *=========================================*/

export interface ReplyComposerProps {
  /** Who the reply goes to, as `To …` names it. */
  to: string
  /** The subject, when the caller lets it be typed; absent, the reply keeps its conversation's subject. */
  subject?: { value: string; onChange: (value: string) => void; max: number }
  message: string
  onMessageChange: (value: string) => void
  messageMax: number
  messagePlaceholder?: string
  /** Where answers to the reply go, said where the reply is written. */
  note: ReactNode
  busy: boolean
  onSend: () => void
  /** Off when the person reading may not send; the reason belongs in `note`. */
  canSend?: boolean
  sendLabel?: string
}

/** The form: who it's to, the subject when typed, the message, where answers go, and Send. */
export function ReplyComposer(props: ReplyComposerProps) {
  const { to, subject, message, onMessageChange, messageMax, note, busy, onSend } = props
  const canSend = props.canSend !== false
  const ready = canSend && !busy && Boolean(message.trim()) && (!subject || Boolean(subject.value.trim()))
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {`To ${to}`}
      </Typography>
      {subject ? (
        <TextField
          label="Subject"
          value={subject.value}
          onChange={(event) => subject.onChange(event.target.value.slice(0, subject.max))}
          fullWidth
          size="small"
          disabled={!canSend}
        />
      ) : null}
      <TextField
        label="Message"
        value={message}
        onChange={(event) => onMessageChange(event.target.value.slice(0, messageMax))}
        fullWidth
        multiline
        minRows={4}
        placeholder={props.messagePlaceholder}
        disabled={!canSend}
      />
      <Alert severity="info">{note}</Alert>
      <Box>
        <Button variant="contained" disabled={!ready} onClick={onSend}>
          {busy ? 'Sending…' : (props.sendLabel ?? 'Send reply')}
        </Button>
      </Box>
    </Stack>
  )
}
ReplyComposer.displayName = 'ReplyComposer'

/** One message in a reply thread. */
export interface ReplyThreadMessage {
  id: string
  atMs: number
  /** `out` for what the business sent; `in` for what the customer wrote where the business can read it. */
  direction: 'out' | 'in'
  /** Who, as the line above the message says it: `to jane@example.com`, `Jordan Lee wrote`. */
  label: string
  body: string
}

export interface ReplyThreadProps {
  title: string
  messages: ReplyThreadMessage[]
  /** Set when there are more messages than shown. */
  moreNote?: string | null
}

/** The messages, oldest or newest first as the caller orders them; an answer from the customer is set apart. */
export function ReplyThread(props: ReplyThreadProps) {
  const { title, messages } = props
  if (!messages.length) return null
  return (
    <Stack spacing={1}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      {props.moreNote ? (
        <Typography variant="caption" color="text.secondary">
          {props.moreNote}
        </Typography>
      ) : null}
      {messages.map((entry) => (
        <Stack
          key={entry.id}
          spacing={0.25}
          data-reply-direction={entry.direction}
          sx={
            entry.direction === 'in'
              ? { borderLeft: 3, borderColor: 'primary.main', pl: 1.5 }
              : { borderLeft: 3, borderColor: 'divider', pl: 1.5 }
          }
        >
          <Typography variant="caption" color="text.secondary">
            {`${new Date(entry.atMs).toLocaleString()} · ${entry.label}`}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {entry.body}
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}
ReplyThread.displayName = 'ReplyThread'

export default ReplyComposer
