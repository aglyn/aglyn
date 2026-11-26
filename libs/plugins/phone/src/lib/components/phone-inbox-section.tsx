'use client'

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

import { siteLiveUrlForSlug } from '@aglyn/aglyn/app-utils/site-live-url'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PHONE_MAX_BODY_CHARS } from '../constants/usage'
import { fillPhoneTemplate, formatPhoneForDisplay } from '../model/phone-rules'
import type { PhoneCall, PhoneMessage, PhoneThread } from '../model/phone.types'
import type { PhoneSectionProps } from './phone-console-page'
import { describePhoneCall, formatPhoneTime } from './phone-format'

/** How often an open inbox asks for new texts. */
const POLL_MS = 15_000

/**
 * The Inbox (AGL-4251): every conversation with the business number on the
 * left, the open one on the right, and the composer with saved replies under
 * it. Refreshes itself while open.
 */
export function PhoneInboxSection({ api, status, sites, basePath }: PhoneSectionProps) {
  const { enqueueSnackbar } = useSnackbar()
  const [threads, setThreads] = useState<PhoneThread[] | null>(null)
  const [archived, setArchived] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [open, setOpen] = useState<{ thread: PhoneThread; messages: PhoneMessage[]; calls: PhoneCall[] } | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const number = status.numbers[0] ?? null

  const loadThreads = useCallback(async () => {
    try {
      setThreads(await api.threads({ archived }))
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error' })
      setThreads([])
    }
  }, [api, archived, enqueueSnackbar])

  const loadOpen = useCallback(
    async (threadId: string) => {
      try {
        setOpen(await api.thread(threadId))
      } catch (error) {
        enqueueSnackbar((error as Error).message, { variant: 'error' })
      }
    },
    [api, enqueueSnackbar],
  )

  useEffect(() => {
    void loadThreads()
    const timer = setInterval(() => {
      void loadThreads()
      if (openId) void loadOpen(openId)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [loadThreads, loadOpen, openId])

  useEffect(() => {
    if (openId) void loadOpen(openId)
    else setOpen(null)
  }, [openId, loadOpen])

  const site = useMemo(() => sites.find((one) => one.id === number?.hostId) ?? null, [sites, number])

  if (!number) {
    return (
      <Alert
        severity="info"
        action={
          <Button size="small" href={`${basePath}/setup`}>
            Set up
          </Button>
        }
      >
        Choose your business number on Setup, and the texts it receives will show here.
      </Alert>
    )
  }

  return (
    <Stack spacing={2}>
      {status.compliance?.status !== 'approved' ? (
        <Alert severity="warning">
          {'US carriers block texts from a number that is not registered. Register '}
          {formatPhoneForDisplay(number.e164)}
          {' for texting on Setup; calls work in the meantime.'}
        </Alert>
      ) : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 340px) 1fr' } }}>
        <CardDisplay
          header="Conversations"
          subheader={formatPhoneForDisplay(number.e164)}
          HeaderProps={{
            action: (
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => setArchived((value) => !value)}>
                  {archived ? 'Inbox' : 'Archived'}
                </Button>
                <Button size="small" variant="contained" onClick={() => setComposeOpen(true)}>
                  New text
                </Button>
              </Stack>
            ),
          }}
          disableContentWrapper
        >
          {threads === null ? (
            <Stack sx={{ alignItems: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : threads.length ? (
            <List dense disablePadding aria-label="Conversations">
              {threads.map((thread) => (
                <ListItemButton key={thread.id} selected={thread.id === openId} onClick={() => setOpenId(thread.id)}>
                  <ListItemText
                    primary={
                      <Stack sx={{ alignItems: 'center', justifyContent: 'space-between' }} direction="row" spacing={1}>
                        <Typography sx={{ fontWeight: thread.unread ? 700 : 500 }} variant="body2" noWrap>
                          {thread.contact?.name || formatPhoneForDisplay(thread.theirs)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {formatPhoneTime(thread.lastMessageAtMs)}
                        </Typography>
                      </Stack>
                    }
                    secondary={
                      <Stack sx={{ alignItems: 'center' }} direction="row" spacing={1}>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
                          {thread.lastDirection === 'outbound' ? 'You: ' : ''}
                          {thread.lastMessagePreview}
                        </Typography>
                        {thread.unread ? <Badge color="primary" badgeContent={thread.unread} /> : null}
                      </Stack>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              {archived ? 'No archived conversations.' : 'No texts yet. When a customer texts your number, it shows here.'}
            </Typography>
          )}
        </CardDisplay>
        {open ? (
          <PhoneConversation
            key={open.thread.id}
            api={api}
            conversation={open}
            templates={status.settings.templates}
            links={{
              siteLink: (site && siteLiveUrlForSlug(site, '/')) || null,
              businessName: site?.name ?? null,
            }}
            onChanged={async () => {
              await loadOpen(open.thread.id)
              await loadThreads()
            }}
            onArchived={async () => {
              setOpenId(null)
              await loadThreads()
            }}
          />
        ) : (
          <CardDisplay header="Conversation" contentGutterX contentGutterY>
            <Typography variant="body2" color="text.secondary">
              Pick a conversation to read it and reply.
            </Typography>
          </CardDisplay>
        )}
      </Box>
      <PhoneNewTextDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSend={async (to, body) => {
          const sent = await api.send({ to, body, numberId: number.id })
          setComposeOpen(false)
          await loadThreads()
          setOpenId(sent.thread.id)
        }}
      />
    </Stack>
  )
}

function PhoneConversation(props: {
  api: PhoneSectionProps['api']
  conversation: { thread: PhoneThread; messages: PhoneMessage[]; calls: PhoneCall[] }
  templates: PhoneSectionProps['status']['settings']['templates']
  links: { siteLink: string | null; businessName: string | null }
  onChanged(): Promise<void>
  onArchived(): Promise<void>
}) {
  const { api, conversation, templates, links, onChanged, onArchived } = props
  const { thread } = conversation
  const { enqueueSnackbar } = useSnackbar()
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [conversation.messages.length])

  const timeline = useMemo(
    () =>
      [
        ...conversation.messages.map((message) => ({ atMs: message.atMs, message })),
        ...conversation.calls.map((call) => ({ atMs: call.startedAtMs, call })),
      ].sort((a, b) => a.atMs - b.atMs),
    [conversation],
  )

  const send = async () => {
    if (!body.trim()) return
    setSending(true)
    try {
      await api.send({ threadId: thread.id, body })
      setBody('')
      await onChanged()
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error' })
    } finally {
      setSending(false)
    }
  }

  return (
    <CardDisplay
      header={thread.contact?.name || formatPhoneForDisplay(thread.theirs)}
      subheader={thread.contact?.name ? formatPhoneForDisplay(thread.theirs) : undefined}
      HeaderProps={{
        action: (
          <Button
            size="small"
            onClick={async () => {
              await api.archiveThread(thread.id, !thread.archived)
              await onArchived()
            }}
          >
            {thread.archived ? 'Move to inbox' : 'Archive'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <Stack spacing={1} sx={{ maxHeight: 460, overflowY: 'auto', pr: 1 }} aria-label="Messages">
          {timeline.map((entry) =>
            'message' in entry && entry.message ? (
              <Box
                key={`m-${entry.message.id}`}
                sx={{
                  alignSelf: entry.message.direction === 'outbound' ? 'flex-end' : 'flex-start',
                  maxWidth: '80%',
                  bgcolor: entry.message.direction === 'outbound' ? 'primary.main' : 'action.hover',
                  color: entry.message.direction === 'outbound' ? 'primary.contrastText' : 'text.primary',
                  borderRadius: 2,
                  px: 1.5,
                  py: 1,
                }}
              >
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {entry.message.body}
                </Typography>
                {(entry.message.mediaUrls ?? []).map((url, index) => (
                  <Typography key={url} variant="caption" component="div">
                    <a href={url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                      Picture {index + 1}
                    </a>
                  </Typography>
                ))}
                <Typography variant="caption" sx={{ opacity: 0.8 }} component="div">
                  {formatPhoneTime(entry.message.atMs)}
                  {entry.message.direction === 'outbound'
                    ? ` · ${entry.message.byName ?? ''} ${statusWord(entry.message.status)}`.replace(/\s+/g, ' ')
                    : ''}
                </Typography>
              </Box>
            ) : 'call' in entry && entry.call ? (
              <Chip
                key={`c-${entry.call.id}`}
                size="small"
                variant="outlined"
                sx={{ alignSelf: 'center' }}
                label={`${describePhoneCall(entry.call)} · ${formatPhoneTime(entry.call.startedAtMs)}`}
              />
            ) : null,
          )}
          <div ref={endRef} />
        </Stack>
        {thread.optedOut ? (
          <Alert severity="info">This person texted STOP. You can text them again after they text START.</Alert>
        ) : (
          <Stack spacing={1}>
            <TextField
              label="Message"
              multiline
              minRows={2}
              value={body}
              onChange={(event) => setBody(event.target.value.slice(0, PHONE_MAX_BODY_CHARS))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send()
              }}
            />
            <Stack sx={{ justifyContent: 'space-between' }} direction="row" spacing={1}>
              <Button size="small" onClick={(event) => setMenu(event.currentTarget)} disabled={!templates.length}>
                Saved replies
              </Button>
              <Button variant="contained" onClick={() => void send()} disabled={sending || !body.trim()}>
                Send
              </Button>
            </Stack>
            <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
              {templates.map((template) => (
                <MenuItem
                  key={template.id}
                  onClick={() => {
                    setBody((current) => [current.trim(), fillPhoneTemplate(template.body, links)].filter(Boolean).join(' '))
                    setMenu(null)
                  }}
                >
                  {template.label}
                </MenuItem>
              ))}
            </Menu>
          </Stack>
        )}
      </Stack>
    </CardDisplay>
  )
}

function statusWord(status: PhoneMessage['status']): string {
  switch (status) {
    case 'delivered':
      return 'Delivered'
    case 'failed':
    case 'undelivered':
      return 'Not delivered'
    case 'queued':
      return 'Sending'
    default:
      return 'Sent'
  }
}

function PhoneNewTextDialog(props: { open: boolean; onClose(): void; onSend(to: string, body: string): Promise<void> }) {
  const { enqueueSnackbar } = useSnackbar()
  const [to, setTo] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>New text</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="To" placeholder="(830) 555-0142" value={to} onChange={(event) => setTo(event.target.value)} />
          <TextField
            label="Message"
            multiline
            minRows={3}
            value={body}
            onChange={(event) => setBody(event.target.value.slice(0, PHONE_MAX_BODY_CHARS))}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={busy || !to.trim() || !body.trim()}
          onClick={async () => {
            setBusy(true)
            try {
              await props.onSend(to, body)
              setTo('')
              setBody('')
            } catch (error) {
              enqueueSnackbar((error as Error).message, { variant: 'error' })
            } finally {
              setBusy(false)
            }
          }}
        >
          Send
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default PhoneInboxSection
