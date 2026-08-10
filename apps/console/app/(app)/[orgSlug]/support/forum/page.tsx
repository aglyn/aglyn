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

import { mdiForumOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
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
import SupportChannelLink from '../../../../../components/support/support-channel-link.component'
import SupportMessages from '../../../../../components/support/support-messages.component'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import { docsHelp } from '../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { useOrgSlug } from '../../../../../hooks/use-org-scope'
import useSupportApi from '../../../../../hooks/use-support-api'

/**
 * The community forum (AGL-142, split out by AGL-1158).
 *
 * Open to EVERY tier including Free (AGL-1103) — a tier with no ticket
 * commitment whose forum was also shut would have no support channel at all.
 * That is why this is a page and no longer half of one: for a Free or Starter
 * workspace the forum is the whole support offering, and it used to render as
 * the smaller half of a screen dominated by a ticket card they cannot use.
 *
 * The gate is enforced server-side in `/api/support/forum` against the same
 * ladder — `forumThreads` is absent from the Firestore rules by design, so
 * every read and write passes that route. Nothing here is access control.
 */
const SupportForum: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { request, canLoad } = useSupportApi()

  const [forum, setForum] = useState<{
    categories: string[]
    threads: any[]
  } | null>(null)
  const [category, setCategory] = useState('')
  const [thread, setThread] = useState<any | null>(null)
  const [composing, setComposing] = useState<{
    title: string
    body: string
    category: string
  } | null>(null)
  const [reply, setReply] = useState('')

  // The same `canLoad` gate as the tickets loader (AGL-1154) — this route
  // takes the org the same way, so it has the same first-org window.
  const refresh = useCallback(async () => {
    if (!canLoad) return
    const payload = await request(
      `/api/support/forum${category ? `?category=${encodeURIComponent(category)}` : ''}`,
      'GET',
    )
    if (payload?.threads) setForum(payload)
  }, [canLoad, category, request])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const open = useCallback(
    (threadId: string) => async () => {
      const payload = await request(
        `/api/support/forum?threadId=${encodeURIComponent(threadId)}`,
        'GET',
      )
      if (payload?.thread) setThread(payload)
      setReply('')
    },
    [request],
  )

  const categories = forum?.categories ?? []
  const threads = forum?.threads ?? []

  return (
    <>
      <DashboardLayout
        breadcrumbItems={[
          {
            children: 'Support',
            href: buildRoute(Route.MANAGE_SUPPORT, { orgSlug }),
          },
          {
            children: 'Forum',
            href: buildRoute(Route.MANAGE_SUPPORT_FORUM, { orgSlug }),
          },
        ]}
        header={{
          children: 'Community forum',
          icon: { path: mdiForumOutline.path },
        }}
        // Support stays ONE section (AGL-1158) — the nav tab lands on whichever
        // channel the tier makes primary, so this is the only way to the other.
        headerRight={<SupportChannelLink to="tickets" orgSlug={orgSlug} />}
        help="supportAndCommunity"
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay
            header={'Threads'}
            help={docsHelp('supportAndCommunity', {
              anchor: '#community-forum',
              excerpt:
                'The subscriber forum — ask questions and share tips with ' +
                'other Aglyn builders.',
            })}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {'Ask other Aglyn builders — on every plan, including Free. ' +
                  'Aglyn staff read along and reply here too.'}
              </Typography>

              <Stack
                direction="row"
                spacing={0.5}
                sx={{ flexWrap: 'wrap', rowGap: 1 }}
              >
                {categories.map((value) => (
                  <Chip
                    key={value}
                    size="small"
                    label={value}
                    color={category === value ? 'secondary' : 'default'}
                    variant={category === value ? 'filled' : 'outlined'}
                    onClick={() =>
                      setCategory((prev) => (prev === value ? '' : value))
                    }
                  />
                ))}
              </Stack>

              {/*
                An empty FILTER and an empty forum are different answers, and
                a page that says "no threads" to someone who just clicked a
                category reads as broken rather than as filtered.
              */}
              {threads.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {category
                    ? `No threads in ${category} yet — start the first one.`
                    : 'No threads yet — start the first one.'}
                </Typography>
              ) : null}

              {threads.map((item) => (
                <Stack
                  key={item.$id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {item.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {`${item.category} · ${item.authorName}` +
                        ` · ${item.replyCount ?? 0} repl` +
                        `${(item.replyCount ?? 0) === 1 ? 'y' : 'ies'}`}
                    </Typography>
                  </Stack>
                  <Button size="small" onClick={open(item.$id)}>
                    {'Read'}
                  </Button>
                </Stack>
              ))}

              <Button
                size="small"
                color="primary"
                sx={{ alignSelf: 'flex-start' }}
                onClick={() =>
                  setComposing({
                    title: '',
                    body: '',
                    category: category || 'General',
                  })
                }
              >
                {'Start a thread'}
              </Button>
            </Stack>
          </CardDisplay>
        </Container>
      </DashboardLayout>

      {/* New thread */}
      <Dialog
        open={Boolean(composing)}
        onClose={() => setComposing(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Start a thread'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Title"
            value={composing?.title ?? ''}
            onChange={(event) =>
              setComposing((prev) =>
                prev ? { ...prev, title: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ flexWrap: 'wrap', rowGap: 1 }}
          >
            {categories.map((value) => (
              <Chip
                key={value}
                size="small"
                label={value}
                color={composing?.category === value ? 'secondary' : 'default'}
                variant={composing?.category === value ? 'filled' : 'outlined'}
                onClick={() =>
                  setComposing((prev) =>
                    prev ? { ...prev, category: value } : prev,
                  )
                }
              />
            ))}
          </Stack>
          <TextField
            label="Post"
            value={composing?.body ?? ''}
            onChange={(event) =>
              setComposing((prev) =>
                prev ? { ...prev, body: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={4}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setComposing(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!composing?.title.trim() || !composing?.body.trim()}
            onClick={async () => {
              const payload = await request('/api/support/forum', 'POST', {
                title: composing?.title,
                body: composing?.body,
                category: composing?.category,
              })
              if (!payload) return
              setComposing(null)
              void refresh()
            }}
          >
            {'Post thread'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Thread */}
      <Dialog
        open={Boolean(thread)}
        onClose={() => setThread(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{thread?.thread?.title}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          {/*
            The opening post and its replies are the same object, so they
            render through the same list — the forum used to badge staff on
            replies but not on the opening post, purely because they were two
            hand-written blocks.
          */}
          <SupportMessages
            posts={[
              ...(thread?.thread ? [thread.thread] : []),
              ...(thread?.replies ?? []),
            ]}
          />
          <TextField
            label="Reply"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            size="small"
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setThread(null)}>{'Close'}</Button>
          <Button
            disabled={!reply.trim()}
            onClick={async () => {
              const payload = await request('/api/support/forum', 'PATCH', {
                threadId: thread?.thread?.$id,
                body: reply,
              })
              if (!payload) return
              setReply('')
              void open(thread?.thread?.$id)()
              void refresh()
            }}
          >
            {'Reply'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
SupportForum.displayName = 'Page:SupportForum'

export default SupportForum
