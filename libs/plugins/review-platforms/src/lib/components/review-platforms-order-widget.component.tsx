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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { StatusChip, type StatusTone } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { REVIEW_PLATFORMS_API_ROUTES } from '../constants/api-routes'
import { REVIEW_PLATFORM_LABELS, REVIEW_PLATFORMS } from '../constants/bundle-common'
import {
  INVITATION_SKIP_LABELS,
  type InvitationView,
  type ReviewPlatformsOrderView,
} from '../model/review-platforms-settings'
import { useReviewPlatformsFetch } from './review-platforms-api'

/** What `orderDetail` hands a widget: the site and the order. */
export interface ReviewPlatformsOrderWidgetProps {
  hostId: string
  order: { id: string }
}

const STATUS: Record<InvitationView['status'], { label: string; tone: StatusTone }> = {
  sent: { label: 'Invited', tone: 'success' },
  sending: { label: 'Inviting', tone: 'info' },
  skipped: { label: 'Not invited', tone: 'neutral' },
  failed: { label: 'Needs attention', tone: 'error' },
}

function detail(entry: InvitationView): string {
  const when = entry.atMs ? new Date(entry.atMs).toLocaleString() : ''
  if (entry.status === 'skipped') return entry.reason ? INVITATION_SKIP_LABELS[entry.reason] : ''
  if (entry.status === 'failed') return entry.error ?? ''
  const via = entry.via === 'bcc' ? 'by a copy of the order email' : 'through the API'
  return [via, when].filter(Boolean).join(' · ')
}

/**
 * REVIEW INVITATIONS on an order (AGL-3699): whether Trustpilot or Yotpo
 * was asked to invite this order's buyer, or why not. Draws nothing for an
 * order neither service was asked about.
 */
export function ReviewPlatformsOrderWidget(props: ReviewPlatformsOrderWidgetProps) {
  const { hostId, order } = props
  const request = useReviewPlatformsFetch()
  const [view, setView] = useState<ReviewPlatformsOrderView | null>(null)

  useEffect(() => {
    if (!hostId || !order?.id) return
    let live = true
    request<{ order: ReviewPlatformsOrderView }>(REVIEW_PLATFORMS_API_ROUTES.order, { query: { hostId, recordId: order.id } })
      .then((answer) => live && setView(answer.order))
      .catch(() => live && setView(null))
    return () => {
      live = false
    }
  }, [hostId, order?.id, request])

  if (!view) return null
  const rows = REVIEW_PLATFORMS.flatMap((platform) => {
    const entry = view[platform]
    return entry ? [{ platform, entry }] : []
  })
  if (!rows.length) return null
  return (
    <CardDisplay
      header="Review invitations"
      help={pluginDocsHelp('reviewPlatforms', {
        anchor: '#on-the-order',
        excerpt: 'Whether Trustpilot or Yotpo was asked to invite this order’s customer to review, or why not.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        {rows.map(({ platform, entry }) => (
          <Stack key={platform} spacing={0.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle2">{REVIEW_PLATFORM_LABELS[platform]}</Typography>
              <StatusChip {...STATUS[entry.status]} data-testid={`review-platforms-${platform}-invitation`} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {detail(entry)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </CardDisplay>
  )
}

export default ReviewPlatformsOrderWidget
