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

import * as CommerceModel from '../../model'
import { commerceSitePermissionRefusal } from '../../model/plugin-permissions'
import { ReplyComposer, ReplyThread } from '@aglyn/shared-ui-jsx/components/reply-composer.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'

const SEND_REFUSAL = commerceSitePermissionRefusal('commerce.quotes.send')

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

export interface QuoteMessagesSectionProps {
  hostId: string
  quoteId: string
  quote: CommerceModel.HostOrder
  /** Holds "Send quotes and invoices to customers" (`commerce.quotes.send`): a reply emails the customer. */
  canSend: boolean
}

/**
 * The quote's conversation with its customer (AGL-4207), in the quote's
 * dialog: every reply sent from here and everything the customer wrote on
 * the quote page, oldest first, and a reply box. The same composer as the
 * Inbox's reply. A reply goes by email in the quote's own conversation in
 * the customer's mailbox, and their email answer reaches the site's contact
 * email (or the sender's), not this list: nothing here receives mail.
 */
export function QuoteMessagesSection(props: QuoteMessagesSectionProps) {
  const { hostId, quoteId, quote, canSend } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [messages, setMessages] = useState<CommerceModel.QuoteConsoleMessage[]>([])
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const attempt = useRef('')
  const refused = CommerceModel.quoteReplyRefusal({ channel: 'quote', quote: quote.quote })
  const to = CommerceModel.quoteReplyRecipient(quote)

  const post = useCallback(
    async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
      const response = await authorizedFetch(user, '/api/commerce/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ hostId, quoteId, ...body }),
      })
      return { ok: response.ok, payload: (await response.json().catch(() => ({}))) as Record<string, any> }
    },
    [user, hostId, quoteId],
  )

  const load = useCallback(async () => {
    if (!user) return
    try {
      const { ok, payload } = await post({ action: 'messages' })
      if (!ok) return void setLoadError(String(payload['error'] ?? 'The messages could not be loaded.'))
      setLoadError('')
      setMessages(Array.isArray(payload['messages']) ? payload['messages'] : [])
    } catch {
      setLoadError('The messages could not be loaded.')
    }
  }, [user, post])

  useEffect(() => {
    void load()
  }, [load])

  const send = useCallback(async () => {
    if (busy || !message.trim()) return
    setBusy(true)
    // One key per reply: a retry of the same press is answered from the first.
    if (!attempt.current) attempt.current = newKey()
    try {
      const { ok, payload } = await post({ action: 'reply', message: message.trim() }, { 'Idempotency-Key': attempt.current })
      attempt.current = ''
      if (!ok) {
        return void enqueueSnackbar(payload['error'] ?? 'The reply was not sent', { variant: 'warning', allowDuplicate: true })
      }
      setMessage('')
      enqueueSnackbar(`Reply sent to ${payload['to'] ?? to}`, { variant: 'success', persist: false })
      await load()
    } catch {
      enqueueSnackbar('The reply was not sent', { variant: 'warning', allowDuplicate: true })
    } finally {
      setBusy(false)
    }
  }, [busy, message, post, enqueueSnackbar, to, load])

  return (
    <Stack spacing={1.5} data-quote-messages="">
      <Stack spacing={0.5}>
        <Typography variant="subtitle2">{'Messages'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {'Write to your customer about this quote. They can answer by email or on the quote page; what they write on the page shows here, and you’re notified of it.'}
        </Typography>
      </Stack>
      {loadError ? <Alert severity="warning">{loadError}</Alert> : null}
      <ReplyThread
        title="Conversation"
        messages={messages.map((entry) => ({ ...entry }))}
      />
      {refused ? (
        <Alert severity="info">{CommerceModel.quoteReplyRefusalMessage(refused)}</Alert>
      ) : (
        <ReplyComposer
          to={to}
          message={message}
          onMessageChange={setMessage}
          messageMax={CommerceModel.QUOTE_MESSAGE_MAX}
          messagePlaceholder="Write your reply."
          note={
            canSend
              ? 'Sent from your site in the same email conversation as the quote. When your customer replies by email, it goes to your site’s contact email (or yours, if the site has none), not here.'
              : SEND_REFUSAL
          }
          busy={busy}
          canSend={canSend}
          onSend={() => void send()}
        />
      )}
    </Stack>
  )
}
QuoteMessagesSection.displayName = 'QuoteMessagesSection'

export default QuoteMessagesSection
