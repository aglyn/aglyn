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

import { buildRoute, pluginDocsHelp, Route } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Avatar, Box, Button, Stack, Typography } from '@mui/material'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import {
  relativeTime,
  senderHue,
  submissionSender,
} from '../model/submission-presenter'

/**
 * Rows on the card, plus one so it can say the inbox holds more.
 *
 * The extra document is never rendered — it is what turns "there may be
 * more" into a fact, the same probe the console's paged lists use.
 */
const PREVIEW_ROWS = 3

/**
 * The inbox at a glance: who wrote in, how long ago, and how many are
 * unread.
 *
 * A dashboard is where a site owner looks first, and a form submission is
 * the one thing on it that is waiting for a REPLY — until now it was two
 * clicks away with nothing on the dashboard saying it had arrived.
 *
 * Renders nothing until the site has a submission, the same rule the other
 * capability glances follow: an empty card about forms on a site with no
 * form is an advertisement, not a summary.
 *
 * `orderBy('createdAt', 'desc')` is checked against the writer rather than
 * assumed — an `orderBy` drops documents missing the field, which on a
 * newest-first list is invisible. `apps/tenant/app/api/forms/submit/route.ts`
 * is the only path that creates one and stamps `createdAt: serverTimestamp()`
 * on every add, the v1 API only reads and deletes, and `formSubmissions` is
 * absent from `IMPORTABLE_FIELDS`, so no restore can mint one without it.
 */
export function InboxGlanceCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const { orgSlug, host } = useParams<{ orgSlug: string; host: string }>()
  const { data: submissionDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'formSubmissions'),
        orderBy('createdAt', 'desc'),
        limit(PREVIEW_ROWS + 1),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )

  const submissions = submissionDocs ?? []
  if (!submissions.length) return null
  const rows = submissions.slice(0, PREVIEW_ROWS)
  const unread = rows.filter((submission: any) => !submission.read).length

  return (
    <CardDisplay
      header={'Inbox'}
      help={pluginDocsHelp('forms', {
        anchor: '#the-inbox',
        excerpt:
          'The newest form submissions on this site — the Inbox has the ' +
          'full list, the reader, and the routing each one took.',
      })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            component={AppLink as any}
            {...({ componentVariant: 'naked', nativeButton: false } as any)}
            href={buildRoute(Route.HOST_INBOX, { orgSlug, host })}
            size="small"
            color="primary"
          >
            {'Open inbox'}
          </Button>
        ),
      }}
    >
      <Stack spacing={1}>
        {rows.map((submission: any) => {
          const sender = submissionSender(submission.fields)
          const hue = senderHue(sender.label)
          return (
            <Stack
              key={submission.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              {/*
                The unread DOT, as the Inbox itself draws it — same fact, same
                shape, so a reader recognizes the row when they open it.
               */}
              <Box
                aria-label={submission.read ? undefined : 'Unread'}
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: submission.read ? 'transparent' : 'primary.main',
                  flexShrink: 0,
                }}
              />
              <Avatar
                sx={{
                  width: 28,
                  height: 28,
                  typography: 'caption',
                  bgcolor: `hsl(${hue} 55% 45%)`,
                }}
              >
                {sender.initials}
              </Avatar>
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {sender.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {submission.formName ?? 'Form'}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" noWrap>
                {relativeTime(submission.createdAt?.toDate?.().getTime())}
              </Typography>
            </Stack>
          )
        })}
        {/*
          What the card is NOT showing. `submissions` holds the probe row, so
          a fourth document is a fact rather than an inference from a full
          page — and the unread count is stated over the rows on screen, not
          over the collection, because counting the collection is a read this
          card has no reason to pay for.
         */}
        <Typography variant="caption" color="text.secondary">
          {[
            unread ? `${unread} unread here` : null,
            submissions.length > PREVIEW_ROWS ? 'more in the Inbox' : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'All caught up'}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
InboxGlanceCard.displayName = 'InboxGlanceCard'

export default InboxGlanceCard
