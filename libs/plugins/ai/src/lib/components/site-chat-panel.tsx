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

import type { SiteChatCard, SiteChatProposal } from '@aglyn/aglyn/plugin-manager/plugin-site-chat-tools'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import SvgIcon from '@mui/material/SvgIcon'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  SITE_CHAT_HISTORY_ROUTE,
  SITE_CHAT_MESSAGE_MAX,
  SITE_CHAT_ROUTE,
  type SiteChatEvent,
  type SiteChatSlice,
  type SiteChatSource,
  type SiteChatTurn,
} from '../model/site-chat'

const CLOSE_ICON =
  'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z'
const SEND_ICON = 'M2,21L23,12L2,3V10L17,12L2,14V21Z'

interface PanelMessage extends Omit<SiteChatTurn, 'at'> {
  id: string
  handOff?: string
  failed?: boolean
}

let counter = 0
const nextId = () => `m${(counter += 1)}`

/** A site path, and nothing else, is a link the panel will draw. */
export function isSitePath(href: string): boolean {
  return /^\/(?!\/)[^\s]*$/.test(href)
}

/**
 * Answer text as the visitor sees it: paragraphs, and Markdown links drawn
 * only when they point at a path of this site. Anything else is its text.
 */
export function renderSiteChatText(text: string): ReactNode {
  const paragraphs = text.split(/\n{2,}/)
  return paragraphs.map((paragraph, index) => {
    const parts: ReactNode[] = []
    const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g
    let last = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(paragraph))) {
      if (match.index > last) parts.push(paragraph.slice(last, match.index))
      if (match[3]) parts.push(<strong key={`b${match.index}`}>{match[3]}</strong>)
      else if (isSitePath(match[2])) {
        parts.push(
          <Link key={`l${match.index}`} href={match[2]} underline="always">
            {match[1]}
          </Link>,
        )
      } else parts.push(match[1])
      last = match.index + match[0].length
    }
    if (last < paragraph.length) parts.push(paragraph.slice(last))
    return (
      <Typography key={index} variant="body2" component="p" sx={{ m: 0, mt: index ? 1 : 0, whiteSpace: 'pre-line' }}>
        {parts.map((part, at) => (
          <Fragment key={at}>{part}</Fragment>
        ))}
      </Typography>
    )
  })
}

/** The events of one streamed answer, as they arrive. */
export async function readSiteChatStream(
  response: Response,
  onEvent: (event: SiteChatEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const line = frame.split('\n').find((entry) => entry.startsWith('data: '))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice(6)) as SiteChatEvent)
      } catch {
        // A frame that is not an event is skipped.
      }
    }
  }
}

function CardView({ card }: { card: SiteChatCard }) {
  return (
    <Paper
      variant="outlined"
      {...(card.url && isSitePath(card.url) ? { component: 'a' as const, href: card.url } : {})}
      sx={{ display: 'flex', gap: 1.5, p: 1, textDecoration: 'none', color: 'inherit', borderRadius: 2 }}
    >
      {card.imageUrl ? (
        <Box
          component="img"
          src={card.imageUrl}
          alt=""
          loading="lazy"
          sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1.5, flexShrink: 0 }}
        />
      ) : null}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" noWrap>
          {card.title}
        </Typography>
        {card.price ? (
          <Typography variant="body2">
            {card.price}{' '}
            {card.compareAtPrice ? (
              <Box component="s" sx={{ color: 'text.secondary' }}>
                {card.compareAtPrice}
              </Box>
            ) : null}
          </Typography>
        ) : null}
        {card.caption ? (
          <Typography variant="caption" color="text.secondary">
            {card.caption}
          </Typography>
        ) : null}
      </Box>
    </Paper>
  )
}

type ProposalState = 'ready' | 'sending' | 'done' | 'failed'

/** A fresh key for one press, for a door that refuses a repeated attempt. */
function attemptKey(): string {
  try {
    return window.crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/** Where a door's answer may send the visitor: this site, or a checkout it named. */
function nextUrl(answer: { url?: unknown }, fallback?: string): string | null {
  const url = typeof answer.url === 'string' ? answer.url : ''
  if (url && (isSitePath(url) || /^https:\/\//.test(url))) return url
  return fallback ?? null
}

function ProposalView({ proposal }: { proposal: SiteChatProposal }) {
  const [state, setState] = useState<ProposalState>('ready')
  const [error, setError] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const fields = proposal.fields ?? []
  const missing = fields.some((field) => field.required && !String(values[field.name] ?? '').trim())
  const confirm = async () => {
    setState('sending')
    setError('')
    try {
      const path = proposal.request.path.replace(/^\/?api\//, '')
      // The VISITOR's request, from their browser, with their own cookies:
      // the chat proposed it, and only this press sends it.
      const response = await fetch(`/api/${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(proposal.idempotent ? { 'Idempotency-Key': attemptKey() } : {}),
        },
        body: JSON.stringify({ ...proposal.request.body, ...values }),
      })
      const answer = (await response.json().catch(() => ({}))) as { error?: string; url?: string }
      if (!response.ok) {
        setState('failed')
        setError(answer.error ?? 'That did not go through. Try again, or use the page.')
        return
      }
      setState('done')
      if (proposal.afterEvent && /^[a-z][a-z0-9:-]{2,60}$/.test(proposal.afterEvent)) {
        window.dispatchEvent(new Event(proposal.afterEvent))
      }
      // A booking or a stay that takes payment answers its checkout: the
      // visitor pays there, as they would from the page.
      const next = nextUrl(answer)
      if (next && proposal.kind !== 'add-to-cart') window.location.assign(next)
    } catch {
      setState('failed')
      setError('That did not go through. Try again, or use the page.')
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }} data-site-chat-proposal={proposal.kind}>
      {proposal.card ? <CardView card={proposal.card} /> : null}
      <Typography variant="subtitle2" sx={{ mt: proposal.card ? 1 : 0 }}>
        {proposal.title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {proposal.summary}
      </Typography>
      {state === 'done' ? (
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
          <Typography variant="body2" color="success.main">
            Done.
          </Typography>
          {proposal.thenUrl ? (
            <Button size="small" href={proposal.thenUrl}>
              {proposal.kind === 'add-to-cart' ? 'View cart' : 'Continue'}
            </Button>
          ) : null}
        </Stack>
      ) : (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {fields.map((field) => (
            <TextField
              key={field.name}
              size="small"
              type={field.type}
              label={field.label}
              required={field.required}
              value={values[field.name] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
            />
          ))}
          <Button variant="contained" size="small" disabled={state === 'sending' || missing} onClick={confirm}>
            {proposal.confirmLabel}
          </Button>
        </Stack>
      )}
      {error ? (
        <Typography variant="caption" color="error" component="p" sx={{ mt: 0.5 }}>
          {error}
        </Typography>
      ) : null}
    </Paper>
  )
}

function HandOffForm({ hostId, prompt }: { hostId: string; prompt: string }) {
  const [email, setEmail] = useState('')
  const [question, setQuestion] = useState('')
  const [state, setState] = useState<'ready' | 'sending' | 'sent' | 'failed'>('ready')
  if (state === 'sent') {
    return (
      <Typography variant="body2" color="success.main">
        Thanks. The team will reply by email.
      </Typography>
    )
  }
  const send = async () => {
    setState('sending')
    const response = await fetch(`/api/${SITE_CHAT_ROUTE}/handoff`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId, email, question }),
    }).catch(() => null)
    setState(response?.ok ? 'sent' : 'failed')
  }
  return (
    <Stack spacing={1}>
      <Typography variant="body2">{prompt}</Typography>
      <TextField size="small" type="email" label="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField
        size="small"
        label="Your question"
        multiline
        minRows={2}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <Button
        variant="outlined"
        size="small"
        disabled={state === 'sending' || !/^\S+@\S+\.\S+$/.test(email) || !question.trim()}
        onClick={send}
      >
        Send to the team
      </Button>
      {state === 'failed' ? (
        <Typography variant="caption" color="error">
          That did not go through. Please try again.
        </Typography>
      ) : null}
    </Stack>
  )
}

function Sources({ sources }: { sources: SiteChatSource[] }) {
  if (!sources.length) return null
  return (
    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
      From:{' '}
      {sources.map((source, index) => (
        <Fragment key={source.url}>
          {index ? ', ' : ''}
          <Link href={source.url} color="inherit">
            {source.title}
          </Link>
        </Fragment>
      ))}
    </Typography>
  )
}

/**
 * The chat panel (AGL-4250), loaded on the launcher's press. A conversation
 * is the visitor's own, kept by the site under a signed session cookie, so a
 * visitor who comes back sees where they left off.
 */
export function SiteChatPanel({
  hostId,
  slice,
  onClose,
}: {
  hostId: string
  slice: SiteChatSlice
  onClose: () => void
}) {
  const [messages, setMessages] = useState<PanelMessage[]>([])
  const [memberName, setMemberName] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/${SITE_CHAT_HISTORY_ROUTE}?hostId=${encodeURIComponent(hostId)}`, { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then((answer: { turns?: SiteChatTurn[]; member?: { name?: string } | null } | null) => {
        if (cancelled || !answer) return
        if (answer.member?.name) setMemberName(answer.member.name)
        if (Array.isArray(answer.turns)) {
          setMessages(answer.turns.map((turn) => ({ ...turn, id: nextId() })))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [hostId])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  const ask = useCallback(
    async (question: string) => {
      const message = question.trim().slice(0, SITE_CHAT_MESSAGE_MAX)
      if (!message || busy) return
      setBusy(true)
      setDraft('')
      const answerId = nextId()
      setMessages((list) => [
        ...list,
        { id: nextId(), role: 'visitor', text: message },
        { id: answerId, role: 'assistant', text: '' },
      ])
      const update = (change: (message: PanelMessage) => PanelMessage) =>
        setMessages((list) => list.map((entry) => (entry.id === answerId ? change(entry) : entry)))
      try {
        const response = await fetch(`/api/${SITE_CHAT_ROUTE}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, message, path: window.location.pathname }),
        })
        if (!response.ok) {
          const answer = (await response.json().catch(() => ({}))) as { error?: string }
          update((entry) => ({ ...entry, text: answer.error ?? 'The chat is not available right now.', failed: true }))
          return
        }
        await readSiteChatStream(response, (event) => {
          if (event.type === 'delta') update((entry) => ({ ...entry, text: entry.text + event.text }))
          else if (event.type === 'cards') update((entry) => ({ ...entry, cards: event.cards }))
          else if (event.type === 'proposal') update((entry) => ({ ...entry, proposal: event.proposal }))
          else if (event.type === 'handoff') update((entry) => ({ ...entry, handOff: event.message }))
          else if (event.type === 'done') update((entry) => ({ ...entry, sources: event.sources }))
          else if (event.type === 'error') update((entry) => ({ ...entry, text: event.error, failed: true }))
        })
      } catch {
        update((entry) => ({ ...entry, text: 'The chat is not available right now.', failed: true }))
      } finally {
        setBusy(false)
      }
    },
    [busy, hostId],
  )

  const greeting = memberName ? `Hi ${memberName}! ${slice.greeting.replace(/^(hi|hello|hey)[!,.]?\s*/i, '')}` : slice.greeting
  const side = slice.position === 'left' ? { left: { xs: 0, sm: 24 } } : { right: { xs: 0, sm: 24 } }
  return (
    <Paper
      elevation={8}
      role="dialog"
      aria-label="Chat"
      data-site-chat-panel=""
      sx={(theme) => ({
        position: 'fixed',
        zIndex: theme.zIndex.modal,
        bottom: { xs: 0, sm: 24 },
        ...side,
        width: { xs: '100vw', sm: 380 },
        height: { xs: '85dvh', sm: 560 },
        maxHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: { xs: '16px 16px 0 0', sm: 3 },
        overflow: 'hidden',
      })}
    >
      <Stack
        direction="row"
        sx={{ alignItems: 'center', px: 2, py: 1.25, bgcolor: 'primary.main', color: 'primary.contrastText' }}
      >
        <Typography variant="subtitle1" sx={{ flex: 1 }}>
          Chat
        </Typography>
        <IconButton aria-label="Close chat" onClick={onClose} sx={{ color: 'inherit' }}>
          <SvgIcon>
            <path d={CLOSE_ICON} />
          </SvgIcon>
        </IconButton>
      </Stack>
      <Box ref={listRef} sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ alignSelf: 'flex-start', maxWidth: '88%', bgcolor: 'action.hover', borderRadius: 2, px: 1.5, py: 1 }}>
          <Typography variant="body2">{greeting}</Typography>
        </Box>
        {slice.openingMessage && !messages.length ? (
          <Box sx={{ alignSelf: 'flex-start', maxWidth: '88%', bgcolor: 'action.hover', borderRadius: 2, px: 1.5, py: 1 }}>
            <Typography variant="body2">{slice.openingMessage}</Typography>
          </Box>
        ) : null}
        {messages.map((message) =>
          message.role === 'visitor' ? (
            <Box
              key={message.id}
              sx={{
                alignSelf: 'flex-end',
                maxWidth: '88%',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                borderRadius: 2,
                px: 1.5,
                py: 1,
              }}
            >
              <Typography variant="body2">{message.text}</Typography>
            </Box>
          ) : (
            <Stack key={message.id} spacing={1} sx={{ alignSelf: 'flex-start', maxWidth: '92%' }}>
              <Box
                aria-live="polite"
                sx={{ bgcolor: 'action.hover', borderRadius: 2, px: 1.5, py: 1, color: message.failed ? 'error.main' : undefined }}
              >
                {message.text ? renderSiteChatText(message.text) : <Typography variant="body2">…</Typography>}
                <Sources sources={message.sources ?? []} />
              </Box>
              {(message.cards ?? []).map((card) => (
                <CardView key={card.url ?? card.title} card={card} />
              ))}
              {message.proposal ? <ProposalView proposal={message.proposal} /> : null}
              {message.handOff && slice.handOff ? <HandOffForm hostId={hostId} prompt={message.handOff} /> : null}
            </Stack>
          ),
        )}
        {!messages.length && slice.chips.length ? (
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {slice.chips.map((chip) => (
              <Chip key={chip} label={chip} variant="outlined" onClick={() => ask(chip)} />
            ))}
          </Stack>
        ) : null}
      </Box>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(draft)
        }}
        sx={{ display: 'flex', gap: 1, p: 1.5, borderTop: 1, borderColor: 'divider' }}
      >
        <TextField
          size="small"
          fullWidth
          placeholder="Ask a question"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          slotProps={{ htmlInput: { maxLength: SITE_CHAT_MESSAGE_MAX, 'aria-label': 'Your question' } }}
        />
        <IconButton type="submit" color="primary" aria-label="Send" disabled={busy || !draft.trim()}>
          <SvgIcon>
            <path d={SEND_ICON} />
          </SvgIcon>
        </IconButton>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ px: 2, pb: 1 }}>
        Answers are written by AI from this site's own pages.
      </Typography>
    </Paper>
  )
}

export default SiteChatPanel
