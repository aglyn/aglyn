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

import { overlayStatus } from '../model'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Stack, Typography } from '@mui/material'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { ceilingedWindow } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { campaignSendsQuery } from './campaign-queries'
import {
  readSendFigures,
  readSiteExperimentFigures,
  readSiteOverlayFigures,
} from './marketing-aggregates'
import { useMarketingOrgId } from './marketing-org-mount'
import { useOneShotRead } from './use-one-shot-reads'

export interface HostMarketingSummaryCardProps {
  hostId: string
}

/**
 * How many overlays the live count reads.
 *
 * "Live" is the one figure here a server aggregate cannot answer — it needs
 * `enabled` and the schedule window checked against the clock — so it is
 * counted over a read of the overlays themselves, ordered and ceilinged the
 * way the Overlays section reads them, with a probe that says when the site
 * has more.
 */
export const LIVE_OVERLAY_CEILING = 50

/** A figure as the row prints it: a dash for one the server did not answer. */
const figure = (value: number | null | undefined): string =>
  value == null ? '—' : value.toLocaleString()

/**
 * Marketing at a glance (wave v8): one row of numbers across the
 * channels this page manages — live overlays and their lifetime
 * engagement, campaign sends/opens/clicks, and experiment states — so
 * the hub answers "is anything running and is it working" without
 * opening each card.
 *
 * Every total is a server aggregate over the whole collection (see
 * `marketing-aggregates.ts`), read once rather than listened to: the
 * overlays' counters move on every impression, and a listener over them
 * would re-deliver a document per impression while the page stays open.
 */
export function HostMarketingSummaryCard(props: HostMarketingSummaryCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { orgId } = useMarketingOrgId(hostId)

  const overlayFigures = useOneShotRead(
    () => readSiteOverlayFigures(firestore, hostId),
    [firestore, hostId],
  )
  const live = useOneShotRead(
    () =>
      getDocs(
        query(
          collection(firestore, 'hosts', hostId, 'overlays'),
          // Ordered for the reason the Overlays section gives: `name` is on
          // every overlay its only creator writes, and an unordered `limit`
          // is an arbitrary window rather than the first N of anything.
          orderBy('name'),
          limit(LIVE_OVERLAY_CEILING + 1),
        ),
      ).then((snapshot) => {
        const { rows, truncated } = ceilingedWindow(
          snapshot.docs.map((entry) => entry.data() as Record<string, any>),
          LIVE_OVERLAY_CEILING,
        )
        const nowMs = Date.now()
        return {
          count: rows.filter(
            (overlay) => !overlay.deletedAt && overlayStatus(overlay, nowMs) === 'live',
          ).length,
          truncated,
        }
      }),
    [firestore, hostId],
  )
  // The org's sends, narrowed to the ones this site sent.
  const sendFigures = useOneShotRead(() => {
    const sends = campaignSendsQuery(firestore, orgId, hostId)
    return sends ? readSendFigures(sends) : null
  }, [firestore, orgId, hostId])
  const experimentFigures = useOneShotRead(
    () => readSiteExperimentFigures(firestore, hostId),
    [firestore, hostId],
  )

  const sends = sendFigures.value
  const tests = experimentFigures.value
  const metrics: Array<{ label: string; value: string; note?: string }> = [
    {
      label: 'Live overlays',
      value: live.value ? figure(live.value.count) : '—',
      note: live.value?.truncated
        ? `of the first ${LIVE_OVERLAY_CEILING} by name`
        : undefined,
    },
    { label: 'Overlay views', value: figure(overlayFigures.value?.views) },
    { label: 'Overlay clicks', value: figure(overlayFigures.value?.clicks) },
    { label: 'Emails sent', value: figure(sends?.sent) },
    {
      label: 'Opens / clicks',
      value: `${figure(sends?.opens)} / ${figure(sends?.clicks)}`,
    },
    ...(sends?.scheduled
      ? [{ label: 'Scheduled sends', value: figure(sends.scheduled) }]
      : []),
    {
      label: 'Experiments',
      value: `${figure(tests?.running)} running · ${figure(tests?.decided)} decided`,
    },
  ]

  return (
    <CardDisplay
      header={'At a glance'}
      help={pluginDocsHelp('marketingOverlays', {
        anchor: '#engagement-stats',
      })}
      contentGutterX
      contentGutterY
    >
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
            {metric.note ? (
              <Typography variant="caption" color="text.secondary">
                {metric.note}
              </Typography>
            ) : null}
          </Stack>
        ))}
      </Stack>
    </CardDisplay>
  )
}
HostMarketingSummaryCard.displayName = 'HostMarketingSummaryCard'

export default HostMarketingSummaryCard
