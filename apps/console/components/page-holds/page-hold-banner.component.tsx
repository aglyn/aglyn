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

import type { HeldPageTarget } from '@aglyn/shared-util-email/held-page'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { Alert, AlertTitle, Button, Chip, Stack, Typography, type SxProps, type Theme } from '@mui/material'
import { useState } from 'react'
import { buildRoute, Route } from '../../constants/route-links'
import { useOrgSlug } from '../../hooks/use-org-scope'
import RequestReviewDialog from '../settings/request-review-dialog.component'
import { holdsForTarget, pageHoldBannerCopy, type PageHold } from './page-hold-copy'
import usePageHolds from './use-page-holds'

export interface PageHoldBannerViewProps {
  holds: readonly PageHold[]
  target: HeldPageTarget
  orgSlug: string
  canRequestReview: boolean
  onRequestReview: (hold: PageHold) => void
  sx?: SxProps<Theme>
}

/**
 * The banner itself, from data (AGL-3374): one alert per hold on this page,
 * template, layout or component, saying what happened, what visitors see,
 * and three things the owner can do — View details (the notice on Holds &
 * reviews), Request a review, Contact support. There is no release: that is
 * staff's decision, and no control here can make it.
 */
export function PageHoldBannerView(props: PageHoldBannerViewProps) {
  const { holds, target, orgSlug, canRequestReview, onRequestReview, sx } = props
  const mine = holdsForTarget(holds, target)
  if (!mine.length) return null
  return (
    <Stack spacing={0} sx={sx}>
      {mine.map((hold) => {
        const copy = pageHoldBannerCopy(hold, target)
        return (
          <Alert
            key={hold.noticeId}
            severity={hold.chip.color}
            data-page-hold={hold.kind}
            sx={{ borderRadius: 0 }}
            action={
              <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
                {orgSlug ? (
                  <AppLink
                    componentVariant="button"
                    size="small"
                    variant="outlined"
                    color="inherit"
                    href={`${buildRoute(Route.ORG_SETTINGS_HOLDS, { orgSlug })}#notice-${hold.noticeId}`}
                  >
                    {'View details'}
                  </AppLink>
                ) : null}
                {hold.reviewable && canRequestReview ? (
                  <Button size="small" variant="contained" color="inherit" onClick={() => onRequestReview(hold)}>
                    {'Request a review'}
                  </Button>
                ) : null}
                {orgSlug ? (
                  <AppLink
                    componentVariant="button"
                    size="small"
                    variant="text"
                    color="inherit"
                    href={buildRoute(Route.MANAGE_SUPPORT_TICKETS, { orgSlug })}
                  >
                    {'Contact support'}
                  </AppLink>
                ) : null}
              </Stack>
            }
          >
            <AlertTitle sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip size="small" color={hold.chip.color} label={hold.chip.label} />
              <span>{copy.title}</span>
            </AlertTitle>
            {copy.lines.map((line) => (
              <Typography key={line} variant="body2">
                {line}
              </Typography>
            ))}
            {hold.reviewable && !canRequestReview ? (
              <Typography variant="caption" color="text.secondary">
                {'A workspace owner or admin can request a review.'}
              </Typography>
            ) : null}
          </Alert>
        )
      })}
    </Stack>
  )
}

/**
 * The hold banner for one console document (AGL-3374), reading the site's
 * held pages itself: the screen and template editors, the version view, and
 * the layout and component editors each render one for what they show.
 */
export default function PageHoldBanner(props: {
  hostId: string | null | undefined
  target: HeldPageTarget
  sx?: SxProps<Theme>
}) {
  const orgSlug = useOrgSlug()
  const { holds, orgId, canRequestReview, reload } = usePageHolds(props.hostId)
  const [requesting, setRequesting] = useState<PageHold | null>(null)
  return (
    <>
      <PageHoldBannerView
        holds={holds}
        target={props.target}
        orgSlug={orgSlug}
        canRequestReview={canRequestReview && Boolean(orgId)}
        onRequestReview={setRequesting}
        sx={props.sx}
      />
      <RequestReviewDialog
        noticeId={requesting?.noticeId ?? null}
        orgId={orgId ?? ''}
        title={requesting ? `About ${requesting.label}` : null}
        onClose={() => setRequesting(null)}
        onSent={reload}
      />
    </>
  )
}
