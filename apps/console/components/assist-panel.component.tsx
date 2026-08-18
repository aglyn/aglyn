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
  checkEntitlement,
  lockdownRefusalText,
  parseLockdownRefusal,
} from '@aglyn/aglyn'
import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import {
  mdiChatQuestionOutline,
  mdiClose,
  mdiSend,
  mdiThumbDownOutline,
  mdiThumbUpOutline,
} from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Drawer,
  Fab,
  IconButton,
  Link,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { usePathname } from 'next/navigation'
import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { HostIdContext } from './host-id-provider'
import useCurrentOrg from '../hooks/use-current-org'
import useOrgScope from '../hooks/use-org-scope'
import useReleaseFlags, { useReleaseFlag } from '../hooks/use-release-flags'

/**
 * Aglyn Assist (AGL-1860, phase 1 — answer + guide): the floating chat
 * helper mounted on every authenticated console page. Docs-grounded answers
 * with deep links for everyone the release flag admits; Pro+ (`aiAssist`)
 * adds page-context awareness. The panel never answers the entitlement
 * question from a loading default — capability messaging waits for
 * `useCurrentOrg().ready` (the checkQuota(undefined)=Free lesson).
 */

interface AssistDocLink {
  title: string
  url: string
}

interface AssistMessage {
  role: 'user' | 'assistant'
  text: string
  exchangeId?: string | null
  feedback?: 'up' | 'down'
  docs?: AssistDocLink[]
}

interface AssistQuotaInfo {
  period: 'day' | 'month'
  used: number
  limit: number
  remaining: number
}

const HISTORY_TURNS_SENT = 12

const storageKey = (orgId: string) => `aglyn-assist:${orgId}`

function loadThread(orgId: string | undefined): AssistMessage[] {
  if (!orgId || typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(storageKey(orgId))
    const parsed = raw ? (JSON.parse(raw) as AssistMessage[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveThread(orgId: string | undefined, messages: AssistMessage[]) {
  if (!orgId || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(storageKey(orgId), JSON.stringify(messages))
  } catch {
    // Quota/full storage never breaks chat.
  }
}

/**
 * Minimal renderer for assistant text: markdown links and bare URLs become
 * links (internal root-relative paths ride AppLink, external open in a new
 * tab); everything else renders as plain text with line breaks. Phase 1 on
 * purpose — no full markdown surface inside the panel.
 */
export function renderAssistText(text: string): JSX.Element {
  const parts: Array<string | { label: string; href: string }> = []
  const pattern = /\[([^\]]+)\]\((\/[^)\s]*|https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push(text.slice(cursor, index))
    if (match[1] && match[2]) parts.push({ label: match[1], href: match[2] })
    else parts.push({ label: match[0], href: match[0] })
    cursor = index + match[0].length
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return (
    <>
      {parts.map((part, i) => {
        if (typeof part === 'string') {
          return <Fragment key={i}>{part}</Fragment>
        }
        if (part.href.startsWith('/')) {
          return (
            <AppLink key={i} componentVariant="naked" href={part.href}>
              {part.label}
            </AppLink>
          )
        }
        return (
          <Link key={i} href={part.href} target="_blank" rel="noreferrer">
            {part.label}
          </Link>
        )
      })}
    </>
  )
}

export function AssistPanelComponent() {
  const verdict = useReleaseFlag('release_assist')
  const { isStaff } = useReleaseFlags()
  const { org, orgId, ready: orgReady } = useCurrentOrg()
  const { orgSlug } = useOrgScope()
  const hostId = useContext(HostIdContext)
  const pathname = usePathname()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<AssistMessage[]>([])
  const [quota, setQuota] = useState<AssistQuotaInfo | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Thread is per-org, session-persisted; switching orgs swaps threads.
  useEffect(() => {
    setMessages(loadThread(orgId))
    setQuota(null)
  }, [orgId])

  useEffect(() => {
    saveThread(orgId, messages)
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [orgId, messages])

  const entitled = orgReady && checkEntitlement(org as never, 'aiAssist')

  const send = useCallback(async () => {
    const question = input.trim()
    if (!question || busy || !orgId) return
    setBusy(true)
    setInput('')
    const history = messages
      .slice(-HISTORY_TURNS_SENT)
      .map(({ role, text }) => ({ role, text }))
    setMessages((prior) => [
      ...prior,
      { role: 'user', text: question },
      { role: 'assistant', text: '' },
    ])
    const patchAnswer = (patch: (message: AssistMessage) => AssistMessage) => {
      setMessages((prior) => {
        const next = [...prior]
        const last = next[next.length - 1]
        if (last?.role === 'assistant') next[next.length - 1] = patch(last)
        return next
      })
    }
    // A notice must not be swallowed by a partial answer: a refusal or a
    // max_tokens cut arrives AFTER text has streamed, and substituting only
    // when the bubble is empty would leave the user staring at half an
    // answer with nothing saying why it stopped.
    const failAnswer = (notice: string) => {
      patchAnswer((message) => ({
        ...message,
        text: message.text ? `${message.text}\n\n${notice}` : notice,
      }))
    }
    try {
      const idToken = await (
        user as { getIdToken?: () => Promise<string> } | null | undefined
      )?.getIdToken?.()
      const response = await fetch('/api/assist/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId,
          question,
          history,
          // Page context rides along; the server drops it for free orgs
          // (level 2 is Pro+). Sending it is not a grant — the capability
          // decision is server-side.
          context: { route: pathname ?? '', hostId: hostId ?? '', orgSlug },
        }),
      })
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null)
        const locked = parseLockdownRefusal(response.status, payload)
        if (locked) {
          failAnswer(lockdownRefusalText(locked))
        } else if (response.status === 501) {
          failAnswer('Aglyn Assist is not configured on this deployment.')
        } else if (response.status === 429 && payload?.reason === 'quota') {
          if (payload.quota) setQuota(payload.quota as AssistQuotaInfo)
          failAnswer(String(payload?.error ?? 'Message limit reached.'))
        } else {
          failAnswer(String(payload?.error ?? 'The assistant request failed — try again.'))
        }
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: Record<string, unknown>
          try {
            event = JSON.parse(line.slice('data: '.length))
          } catch {
            continue
          }
          if (event.type === 'delta' && typeof event.text === 'string') {
            const text = event.text as string
            patchAnswer((message) => ({ ...message, text: message.text + text }))
          } else if (event.type === 'done') {
            const docs = (event.docs as AssistDocLink[] | undefined) ?? []
            patchAnswer((message) => ({
              ...message,
              exchangeId: (event.exchangeId as string | null) ?? null,
              docs,
            }))
            if (event.quota) setQuota(event.quota as AssistQuotaInfo)
            trackEvent('assistant_message_sent', {
              tier: entitled ? 'entitled' : 'free',
              grounded: docs.length > 0,
            })
          } else if (event.type === 'error') {
            failAnswer(String(event.error ?? 'The assistant stream failed.'))
          }
        }
      }
    } catch (error) {
      console.error(error)
      failAnswer('The assistant request failed — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }, [
    busy,
    entitled,
    hostId,
    input,
    messages,
    orgId,
    orgSlug,
    pathname,
    user,
  ])

  const sendFeedback = useCallback(
    async (index: number, feedback: 'up' | 'down') => {
      const message = messages[index]
      if (!message?.exchangeId || !orgId) return
      setMessages((prior) =>
        prior.map((entry, i) => (i === index ? { ...entry, feedback } : entry)),
      )
      trackEvent('assistant_feedback', { feedback })
      try {
        const idToken = await (
          user as { getIdToken?: () => Promise<string> } | null | undefined
        )?.getIdToken?.()
        await fetch('/api/assist/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            orgId,
            exchangeId: message.exchangeId,
            feedback,
          }),
        })
      } catch {
        enqueueSnackbar('Feedback could not be recorded', {
          variant: 'warning',
          persist: false,
        })
      }
    },
    [enqueueSnackbar, messages, orgId, user],
  )

  // A released-off feature does not exist (staff preview excepted) — and
  // without an org there is nothing to meter or record against.
  if (!verdict.visible || !orgId) return null

  return (
    <>
      {!open && (
        <Tooltip title="Aglyn Assist" placement="left">
          <Fab
            color="primary"
            size="medium"
            aria-label="Open Aglyn Assist"
            onClick={() => setOpen(true)}
            sx={{
              position: 'fixed',
              right: 20,
              bottom: 20,
              zIndex: (theme) => theme.zIndex.drawer - 1,
            }}
          >
            <MdiIcon path={mdiChatQuestionOutline.path} />
          </Fab>
        </Tooltip>
      )}
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        slotProps={{
          paper: {
            sx: { width: { xs: '100%', sm: 420 }, display: 'flex' },
          },
        }}
      >
        <Stack sx={{ height: '100%' }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              px: 2,
              py: 1.5,
              borderBottom: 1,
              borderColor: 'divider',
              alignItems: 'center',
            }}
          >
            <MdiIcon path={mdiChatQuestionOutline.path} />
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              Aglyn Assist
            </Typography>
            {verdict.staffPreview && (
              <Chip size="small" color="warning" label="Staff preview" />
            )}
            <IconButton
              aria-label="Close Aglyn Assist"
              onClick={() => setOpen(false)}
            >
              <MdiIcon path={mdiClose.path} />
            </IconButton>
          </Stack>

          <Box ref={scrollRef} sx={{ flexGrow: 1, overflowY: 'auto', p: 2 }}>
            {!messages.length && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Ask anything about using Aglyn — building your site,
                publishing, domains, commerce, billing. Answers link the docs
                and the console page to use.
                {orgReady && !entitled && !isStaff && (
                  <>
                    {' '}
                    Free workspaces get a limited number of messages a day;
                    Pro adds page-aware guidance.
                  </>
                )}
              </Alert>
            )}
            <Stack spacing={1.5}>
              {messages.map((message, index) => (
                <Box
                  key={index}
                  sx={{
                    alignSelf:
                      message.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '90%',
                    borderRadius: 2,
                    px: 1.5,
                    py: 1,
                    bgcolor:
                      message.role === 'user'
                        ? 'primary.main'
                        : 'action.hover',
                    color:
                      message.role === 'user'
                        ? 'primary.contrastText'
                        : 'text.primary',
                  }}
                >
                  <Typography
                    variant="body2"
                    component="div"
                    sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {message.role === 'assistant' ? (
                      message.text ? (
                        renderAssistText(message.text)
                      ) : (
                        <CircularProgress size={14} />
                      )
                    ) : (
                      message.text
                    )}
                  </Typography>
                  {message.role === 'assistant' && message.exchangeId && (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      <IconButton
                        size="small"
                        aria-label="Helpful answer"
                        color={message.feedback === 'up' ? 'primary' : 'default'}
                        disabled={Boolean(message.feedback)}
                        onClick={() => void sendFeedback(index, 'up')}
                      >
                        <MdiIcon
                          path={mdiThumbUpOutline.path}
                          sx={{ fontSize: 16 }}
                        />
                      </IconButton>
                      <IconButton
                        size="small"
                        aria-label="Unhelpful answer"
                        color={message.feedback === 'down' ? 'primary' : 'default'}
                        disabled={Boolean(message.feedback)}
                        onClick={() => void sendFeedback(index, 'down')}
                      >
                        <MdiIcon
                          path={mdiThumbDownOutline.path}
                          sx={{ fontSize: 16 }}
                        />
                      </IconButton>
                    </Stack>
                  )}
                </Box>
              ))}
            </Stack>
          </Box>

          <Stack
            spacing={1}
            sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}
          >
            {quota && quota.period === 'day' && (
              <Typography variant="caption" color="text.secondary">
                {quota.remaining} of {quota.limit} free messages left today
                {orgSlug ? (
                  <>
                    {' — '}
                    <AppLink
                      componentVariant="naked"
                      href={`/${orgSlug}/billing`}
                    >
                      upgrade for more
                    </AppLink>
                  </>
                ) : null}
              </Typography>
            )}
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'flex-end' }}
            >
              <TextField
                fullWidth
                multiline
                maxRows={4}
                size="small"
                placeholder="How do I…"
                value={input}
                disabled={busy}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <IconButton
                color="primary"
                aria-label="Send message"
                disabled={busy || !input.trim()}
                onClick={() => void send()}
              >
                {busy ? (
                  <CircularProgress size={20} />
                ) : (
                  <MdiIcon path={mdiSend.path} />
                )}
              </IconButton>
            </Stack>
          </Stack>
        </Stack>
      </Drawer>
    </>
  )
}

export default AssistPanelComponent
