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

import { VISITOR_UPLOAD_HONEYPOT_FIELD } from '@aglyn/aglyn/app-utils/visitor-upload'
import { ReplyComposer, ReplyThread } from '@aglyn/shared-ui-jsx/components/reply-composer.component'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import { QUOTE_MESSAGE_MAX, type QuotePageMessage, type QuotePageView } from '../model'

/** The page's own fetch: the site's API, with the site's preview rules. */
type SiteFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface QuoteMessagesPanelProps {
  view: QuotePageView
  hostId: string
  quoteId: string
  token: string
  siteFetch: SiteFetch
  /** The link was replaced. */
  onReplaced: () => void
}

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * The customer's conversation with the business about the quote (AGL-4207),
 * on the quote page: what the business replied from the quote, what the
 * customer wrote here, and a box to write more. The business is told in
 * Aglyn and by email, and answers by email, in the same conversation as the
 * quote. The same composer as the Inbox's reply (`ReplyComposer`).
 */
export function QuoteMessagesPanel(props: QuoteMessagesPanelProps) {
  const { view, hostId, quoteId, token, siteFetch, onReplaced } = props
  const [messages, setMessages] = useState<QuotePageMessage[]>(view.messages ?? [])
  const [seenView, setSeenView] = useState(view)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  // Whatever a bot types into the hidden field, sent as typed.
  const [honeypot, setHoneypot] = useState('')
  const attempt = useRef('')
  const business = view.storeName || 'the business'
  const Business = `${business.charAt(0).toUpperCase()}${business.slice(1)}`

  // A newer view of the page (an answer, a reload) carries the conversation as it stands.
  if (seenView !== view) {
    setSeenView(view)
    setMessages(view.messages ?? [])
  }

  const send = useCallback(async () => {
    if (sending || !message.trim()) return
    setSending(true)
    setError('')
    setSent(false)
    // One key per message: a retry of the same press is answered from the first.
    if (!attempt.current) attempt.current = newKey()
    try {
      const response = await siteFetch('/api/commerce/quote-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current },
        body: JSON.stringify({ hostId, q: quoteId, t: token, message: message.trim(), [VISITOR_UPLOAD_HONEYPOT_FIELD]: honeypot }),
      })
      const payload = (await response.json().catch(() => ({}))) as Record<string, any>
      attempt.current = ''
      if (response.ok && Array.isArray(payload['messages'])) {
        setMessages(payload['messages'] as QuotePageMessage[])
        setMessage('')
        setSent(true)
        return
      }
      if (payload['replaced']) return onReplaced()
      setError(String(payload['error'] ?? 'Your message could not be sent. Try again.'))
    } catch {
      setError('Your message could not be sent. Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }, [sending, message, siteFetch, hostId, quoteId, token, honeypot, onReplaced])

  // An invoice has no conversation; a proof waiting on a sign-in keeps its conversation behind it too.
  if (view.kind !== 'quote' || (view.proofAccess && view.proofAccess !== 'open')) return null

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} data-quote-messages="">
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="h6" component="h2">
            {'Messages'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {`Questions about your ${view.proofOnly ? 'proof' : 'quote'}? Write to ${business} here.`}
          </Typography>
        </Stack>
        <ReplyThread
          title="Your conversation"
          messages={messages.map((entry) => ({
            id: entry.id,
            atMs: entry.atMs,
            // The business's words stand out on the customer's page.
            direction: entry.from === 'business' ? ('in' as const) : ('out' as const),
            label: entry.from === 'business' ? `${Business} wrote` : 'You wrote',
            body: entry.body,
          }))}
        />
        {/* Honeypot: people never see or fill this. */}
        <Box
          component="input"
          type="text"
          name={VISITOR_UPLOAD_HONEYPOT_FIELD}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={honeypot}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setHoneypot(event.target.value)}
          sx={{ position: 'absolute', left: '-100vw', width: 0, height: 0, opacity: 0 }}
        />
        <ReplyComposer
          to={Business}
          message={message}
          onMessageChange={(value) => {
            setMessage(value)
            setSent(false)
          }}
          messageMax={QUOTE_MESSAGE_MAX}
          messagePlaceholder={`Write to ${business}`}
          note={`${Business} gets your message right away and answers you by email.`}
          busy={sending}
          onSend={() => void send()}
          sendLabel="Send message"
        />
        {sent ? <Alert severity="success">{`Sent. ${Business} will get back to you.`}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
    </Paper>
  )
}

export default QuoteMessagesPanel
