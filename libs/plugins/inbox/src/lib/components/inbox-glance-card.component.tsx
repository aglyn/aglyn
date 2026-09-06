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
  buildRoute,
  CRM_LEAD_OPEN_STATUSES,
  CRM_LEAD_STATUSES,
  pluginDocsHelp,
  Route,
} from '@aglyn/aglyn'
// The CRM's route builder by its leaf path, not the plugin barrel: the
// barrel is the CRM's site entry point, and a dashboard card named there
// would ship to every published page.
import { crmRoutes } from '@aglyn/plugins-crm/model/crm-routes'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Avatar, Box, Button, Stack, Typography } from '@mui/material'
import {
  collection,
  getCountFromServer,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { useCrmHubPath } from './use-crm-hub-path'
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

  /*
   * How many leads are waiting to be worked (AGL-2622), so the dashboard
   * says where the Inbox's captures went and the CRM's Leads list is one
   * click from here. Two server-side counts rather than a window: a lead
   * nobody has touched carries no status field at all — it is `new` by
   * absence, the rule `crmLeadStatus` reads — and Firestore can neither
   * count an absent field nor exclude the closed statuses without dropping
   * the unstamped rows too. So the open count is every lead less the ones
   * closed by a stamped status, and both counts are aggregations that cost
   * one read per thousand index entries, not one per lead. `null` until
   * they land, and left null on a refused read so the line is withheld
   * rather than drawn as zero.
   */
  const crmHubPath = useCrmHubPath()
  const [openLeads, setOpenLeads] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    const leads = collection(firestore, 'hosts', hostId, 'leads')
    const closedStatuses = CRM_LEAD_STATUSES.filter(
      (status) => !CRM_LEAD_OPEN_STATUSES.includes(status),
    )
    void Promise.all([
      getCountFromServer(query(leads)),
      getCountFromServer(query(leads, where('status', 'in', closedStatuses))),
    ])
      .then(([all, closed]) => {
        if (!active) return
        setOpenLeads(Math.max(0, all.data().count - closed.data().count))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [firestore, hostId])

  const submissions = submissionDocs ?? []
  if (!submissions.length && !openLeads) return null
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
        {/*
          Where the captures went (AGL-2622): the leads still to be worked,
          and the CRM's Leads list where they are. Text alone until the
          route params settle, so the line never links to nowhere.
         */}
        {openLeads ? (
          <Typography variant="caption" color="text.secondary">
            {`${openLeads.toLocaleString()} open lead${openLeads === 1 ? '' : 's'} · `}
            {crmHubPath ? (
              <AppLink href={crmRoutes(crmHubPath).section('leads')}>
                {'Work them in the CRM'}
              </AppLink>
            ) : (
              'in the CRM'
            )}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
InboxGlanceCard.displayName = 'InboxGlanceCard'

export default InboxGlanceCard
