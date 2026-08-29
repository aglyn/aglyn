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
import { Button, Stack, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'

/**
 * How many campaigns the card reads to find the last SENT one.
 *
 * A ceiling on a search, not a page: the newest send is what the card is
 * about, and a site whose thirty most recent campaigns are all drafts simply
 * has nothing to show — the card renders nothing at all in that case, which
 * is the same answer it gives a site that has never sent.
 */
const SEARCH_CEILING = 30

/**
 * Last campaign at a glance (AGL-353): sent, opens and clicks for the most
 * recent send.
 *
 * Registered by the email plugin rather than imported by the dashboard.
 * Campaigns are composed and sent from the Emails page, so a workspace with
 * the email plugin switched off has no campaigns and no page to send one
 * from — and the console still drew this card there, where it could only
 * ever be blank. The header links to the surface that owns the history for
 * the same reason: it is the one this widget's own plugin guarantees exists.
 */
export function CampaignGlanceCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const { orgSlug, host } = useParams<{ orgSlug: string; host: string }>()
  const { data: campaignDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'campaigns'),
        limit(SEARCH_CEILING),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const lastSent = useMemo(
    () =>
      [...(campaignDocs ?? [])]
        .filter((campaign: any) => campaign.status === 'sent')
        .sort(
          (a: any, b: any) =>
            (b.sentAt?.seconds ?? 0) - (a.sentAt?.seconds ?? 0),
        )[0],
    [campaignDocs],
  )

  if (!lastSent) return null

  return (
    <CardDisplay
      header={'Last campaign'}
      help={pluginDocsHelp('emailCampaigns', {
        anchor: '#opens--clicks',
        excerpt:
          'Sent, opens, and clicks for your most recent campaign — open ' +
          'Emails for the full history.',
      })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            component={AppLink as any}
            {...({ componentVariant: 'naked', nativeButton: false } as any)}
            href={buildRoute(Route.HOST_PLUGIN, {
              orgSlug,
              host,
              pluginSlug: 'emails',
            })}
            size="small"
            color="primary"
          >
            {'Emails'}
          </Button>
        ),
      }}
    >
      <Stack spacing={1}>
        <Typography variant="body2" noWrap>
          {lastSent.subject}
        </Typography>
        <Stack direction="row" spacing={3}>
          <Stack>
            <Typography variant="h6">{lastSent.stats?.sent ?? 0}</Typography>
            <Typography variant="caption" color="text.secondary">
              {'Sent'}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="h6">{lastSent.stats?.opens ?? 0}</Typography>
            <Typography variant="caption" color="text.secondary">
              {'Opens'}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="h6">{lastSent.stats?.clicks ?? 0}</Typography>
            <Typography variant="caption" color="text.secondary">
              {'Clicks'}
            </Typography>
          </Stack>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}
CampaignGlanceCard.displayName = 'CampaignGlanceCard'

export default CampaignGlanceCard
