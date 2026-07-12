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

import { overlayActiveAt } from '../model'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Stack, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'

export interface HostMarketingSummaryCardProps {
  hostId: string
}

/**
 * Marketing at a glance (wave v8): one row of numbers across the
 * channels this page manages — live overlays and their lifetime
 * engagement, campaign sends/opens/clicks, and experiment states — so
 * the hub answers "is anything running and is it working" without
 * opening each card.
 */
export function HostMarketingSummaryCard(props: HostMarketingSummaryCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: overlayDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'overlays'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: campaignDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'campaigns'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: experimentDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'experiments'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const summary = useMemo(() => {
    const overlays = (overlayDocs ?? []).filter((doc: any) => !doc.deletedAt)
    const liveOverlays = overlays.filter(
      (overlay: any) =>
        overlay.enabled !== false && overlayActiveAt(overlay, Date.now()),
    ).length
    let impressions = 0
    let overlayClicks = 0
    for (const overlay of overlays) {
      impressions += Number(overlay.stats?.impressions ?? 0)
      overlayClicks += Number(overlay.stats?.clicks ?? 0)
    }
    const campaigns = (campaignDocs ?? []).filter(
      (doc: any) => !doc.deletedAt,
    )
    let sent = 0
    let opens = 0
    let emailClicks = 0
    let scheduled = 0
    for (const campaign of campaigns) {
      sent += Number(campaign.stats?.sent ?? 0)
      opens += Number(campaign.stats?.opens ?? 0)
      emailClicks += Number(campaign.stats?.clicks ?? 0)
      if (campaign.status === 'scheduled') scheduled += 1
    }
    const experiments = (experimentDocs ?? []).filter(
      (doc: any) => !doc.deletedAt,
    )
    const running = experiments.filter(
      (experiment: any) => experiment.status === 'running',
    ).length
    const decided = experiments.filter(
      (experiment: any) => experiment.winnerVariantId,
    ).length
    return {
      liveOverlays,
      impressions,
      overlayClicks,
      sent,
      opens,
      emailClicks,
      scheduled,
      running,
      decided,
    }
  }, [overlayDocs, campaignDocs, experimentDocs])

  const metrics: Array<{ label: string; value: string }> = [
    { label: 'Live overlays', value: String(summary.liveOverlays) },
    {
      label: 'Overlay views',
      value: summary.impressions.toLocaleString(),
    },
    {
      label: 'Overlay clicks',
      value: summary.overlayClicks.toLocaleString(),
    },
    { label: 'Emails sent', value: summary.sent.toLocaleString() },
    {
      label: 'Opens / clicks',
      value: `${summary.opens.toLocaleString()} / ${summary.emailClicks.toLocaleString()}`,
    },
    ...(summary.scheduled
      ? [{ label: 'Scheduled sends', value: String(summary.scheduled) }]
      : []),
    {
      label: 'Experiments',
      value: `${summary.running} running · ${summary.decided} decided`,
    },
  ]

  return (
    <CardDisplay header={'At a glance'} contentGutterX contentGutterY>
      <Stack
        direction="row"
        spacing={3}
        sx={{ flexWrap: 'wrap', rowGap: 1.5 }}
      >
        {metrics.map((metric) => (
          <Stack key={metric.label} spacing={0}>
            <Typography variant="caption" color="text.secondary">
              {metric.label}
            </Typography>
            <Typography variant="h6">{metric.value}</Typography>
          </Stack>
        ))}
      </Stack>
    </CardDisplay>
  )
}
HostMarketingSummaryCard.displayName = 'HostMarketingSummaryCard'

export default HostMarketingSummaryCard
