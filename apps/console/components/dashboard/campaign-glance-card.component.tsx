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

import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Stack, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../../constants/docs-links'
import { buildRoute, Route } from '../../constants/route-links'
import { useHostSubdomain } from '../../components/host-id-provider'
import { useOrgSlug } from '../../hooks/use-org-scope'
import useFirestoreCollection from '../../hooks/use-firestore-collection'

/**
 * Last campaign at a glance (AGL-353): sent/opens/clicks for the most
 * recent send. Hidden until the host has sent a campaign.
 */
export function CampaignGlanceCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const { data: campaignDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'campaigns'), limit(30)),
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
      help={docsHelp('emailCampaigns', {
        anchor: '#opens--clicks',
        excerpt:
          'Sent, opens, and clicks for your most recent campaign — open ' +
          'Marketing for the full history.',
      })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            component={AppLink as any}
            {...({ componentVariant: 'naked' } as any)}
            href={buildRoute(Route.HOST_MARKETING, { orgSlug,  host })}
            size="small"
            color="secondary"
          >
            {'Marketing'}
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
            <Typography variant="h6">
              {lastSent.stats?.sent ?? 0}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {'Sent'}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="h6">
              {lastSent.stats?.opens ?? 0}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {'Opens'}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="h6">
              {lastSent.stats?.clicks ?? 0}
            </Typography>
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
